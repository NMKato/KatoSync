// NMKato Solutions — KatoSync 4.0 Trust Gate 8.
// Native, immutable verified acceptance history distinct from pending receipts.
// No user/LLM/Tauri write command. Only the live KATOOS issuer+CI+Git path
// in external_checks can initiate the transaction.
// This private persistence is not yet an authority for the production UI:
// owner revocation and scope must be revalidated before showing any percentage.
use super::{receipt_hash, scope_policy, SignedAcceptanceReceipt};
use crate::memory_fabric::{mvp_progress::MvpProgress, validate_project_id, MemoryStore};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

pub(in crate::memory_fabric) const SCHEMA_V6: &str = r#"
CREATE TABLE IF NOT EXISTS acceptance_verified_receipts (
  verified_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  plan_journal_sequence INTEGER NOT NULL CHECK(plan_journal_sequence>0),
  scope_digest TEXT NOT NULL CHECK(length(scope_digest)=64),
  pending_receipt_hash TEXT NOT NULL UNIQUE REFERENCES acceptance_pending_receipts(receipt_hash) ON DELETE RESTRICT,
  previous_verified_hash TEXT,
  head_sha TEXT NOT NULL CHECK(length(head_sha) IN (40,64)),
  accepted_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  accepted_feature_ids_json TEXT NOT NULL,
  accepted_weight INTEGER NOT NULL CHECK(accepted_weight>0),
  total_weight INTEGER NOT NULL CHECK(total_weight>0),
  verified_percent INTEGER NOT NULL CHECK(verified_percent BETWEEN 0 AND 100),
  verified_ci_jobs INTEGER NOT NULL CHECK(verified_ci_jobs BETWEEN 1 AND 12),
  owner_key_id TEXT NOT NULL,
  issuer_key_id TEXT NOT NULL,
  authority_state TEXT NOT NULL DEFAULT 'qa_external_verified'
    CHECK(authority_state='qa_external_verified'),
  UNIQUE(project_id,plan_journal_sequence,head_sha),
  CHECK(accepted_weight<=total_weight),
  CHECK(verified_percent=(100*accepted_weight/total_weight)),
  CHECK(previous_verified_hash IS NULL OR length(previous_verified_hash)=64)
) STRICT;
CREATE INDEX IF NOT EXISTS acceptance_verified_project_chain
  ON acceptance_verified_receipts(project_id,plan_journal_sequence,verified_id);
CREATE TRIGGER IF NOT EXISTS acceptance_verified_no_update
  BEFORE UPDATE ON acceptance_verified_receipts
  BEGIN SELECT RAISE(ABORT,'verified_append_only'); END;
CREATE TRIGGER IF NOT EXISTS acceptance_verified_no_delete
  BEFORE DELETE ON acceptance_verified_receipts
  BEGIN SELECT RAISE(ABORT,'verified_append_only'); END;
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VerifiedAcceptanceCheckpoint {
    pub(super) project_id: String,
    pub(super) plan_journal_sequence: i64,
    pub(super) scope_digest: String,
    pub(super) head_sha: String,
    pub(super) receipt_hash: String,
    pub(super) verified_percent: u8,
    pub(super) accepted_features: Vec<String>,
    pub(super) checked_ci_jobs: usize,
    pub(super) accepted_at: String,
    pub(super) verified_at: String,
    pub(super) status: &'static str,
}

fn weighted_coverage(
    progress: &MvpProgress,
    receipt: &SignedAcceptanceReceipt,
) -> Result<(u32, u32, u8), String> {
    scope_policy::audit_pending_feature_scope(progress, receipt)?;
    let all: BTreeMap<&str, _> = progress
        .tasks
        .iter()
        .filter(|t| t.lane == "mvp")
        .map(|t| (t.feature_id.as_str(), t.weight as u32))
        .collect();
    let mut accepted = BTreeSet::new();
    let mut weight = 0u32;
    for id in &receipt.accepted_feature_ids {
        if !accepted.insert(id.as_str()) {
            return Err("ACCEPTANCE_DUPLICATE_FEATURE".into());
        }
        let entry = all.get(id.as_str()).ok_or("ACCEPTANCE_UNKNOWN_FEATURE")?;
        weight = weight
            .checked_add(*entry)
            .ok_or("ACCEPTANCE_WEIGHT_OVERFLOW")?;
    }
    let total = progress.total_weight;
    if total == 0 || weight == 0 || weight > total {
        return Err("ACCEPTANCE_WEIGHT_INVALID".into());
    }
    Ok((weight, total, (100 * weight / total) as u8))
}

impl MemoryStore {
    /// An internal QA-only promotion. The caller is the native live
    /// corroboration path *after* online KATOOS grant checks and exact
    /// CI/workflow/Git ancestry; it must supply the receipt actually read
    /// from this same native database, not an arbitrary WebView payload.
    /// This does not enable the UI to infer current authorized progress.
    #[allow(dead_code)]
    pub(super) fn append_qa_verified_acceptance(
        &mut self,
        receipt: &SignedAcceptanceReceipt,
        progress: &MvpProgress,
        checked_receipt_hash: &str,
        verified_ci_jobs: usize,
        issuer_key_id: &str,
    ) -> Result<VerifiedAcceptanceCheckpoint, String> {
        if !cfg!(feature = "katoos-auth-qa") {
            return Err("ACCEPTANCE_QA_ONLY".into());
        }
        if checked_receipt_hash != receipt.hash
            || receipt_hash(receipt) != receipt.hash
            || verified_ci_jobs == 0
            || verified_ci_jobs > 12
            || verified_ci_jobs != receipt.ci.len()
            || issuer_key_id.len() != 64
            || !issuer_key_id.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("ACCEPTANCE_EVIDENCE_MISMATCH".into());
        }
        let id = validate_project_id(&receipt.project_id)?;
        let (weight, total, percentage) = weighted_coverage(progress, receipt)?;
        let verified_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let accepted_at = DateTime::parse_from_rfc3339(&receipt.accepted_at)
            .map_err(|_| "ACCEPTANCE_TIME_INVALID")?;
        if accepted_at.timestamp_millis() > Utc::now().timestamp_millis() + 60_000 {
            return Err("ACCEPTANCE_TIME_INVALID".into());
        }
        let ids_json = serde_json::to_string(&receipt.accepted_feature_ids)
            .map_err(|_| "ACCEPTANCE_INVALID_FEATURES")?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "ACCEPTANCE_DB_LOCKED")?;
        // Revalidate that the pending input was not replaced while external
        // GitHub requests were in flight. The pending log is append-only.
        let last_pending: Option<(String, String)> = tx
            .query_row(
                "SELECT receipt_hash,payload_json FROM acceptance_pending_receipts
             WHERE project_id=?1 AND plan_journal_sequence=?2
             ORDER BY receipt_id DESC LIMIT 1",
                params![id, receipt.plan_journal_sequence],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|_| "ACCEPTANCE_DB_READ_FAILED")?;
        let (hash, json) = last_pending.ok_or("ACCEPTANCE_PENDING_NOT_FOUND")?;
        if hash != receipt.hash
            || serde_json::from_str::<SignedAcceptanceReceipt>(&json)
                .map_err(|_| "ACCEPTANCE_STORED_RECEIPT_INVALID")?
                .hash
                != receipt.hash
        {
            return Err("ACCEPTANCE_PENDING_MOVED".into());
        }
        let prev:Option<(String,String,String,String,i64,String)>=tx.query_row(
            "SELECT pending_receipt_hash,scope_digest,accepted_at,head_sha,verified_percent,accepted_feature_ids_json
             FROM acceptance_verified_receipts
             WHERE project_id=?1 AND plan_journal_sequence=?2
             ORDER BY verified_id DESC LIMIT 1",
            params![id,receipt.plan_journal_sequence],
            |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))
        ).optional().map_err(|_|"ACCEPTANCE_DB_READ_FAILED")?;
        let previous = prev.as_ref().map(|p| p.0.clone());
        if receipt.previous_hash != previous
            || prev.as_ref().is_some_and(|p| {
                p.1 != receipt.scope_digest
                    || p.2 >= receipt.accepted_at
                    || p.3.eq_ignore_ascii_case(&receipt.head_sha)
                    || p.4 > percentage as i64
            })
        {
            return Err("ACCEPTANCE_VERIFIED_CHAIN_CHANGED".into());
        }
        if let Some(p) = &prev {
            let features: Vec<String> =
                serde_json::from_str(&p.5).map_err(|_| "ACCEPTANCE_VERIFIED_HISTORY_INVALID")?;
            let next: BTreeSet<_> = receipt.accepted_feature_ids.iter().collect();
            if features.iter().any(|id| !next.contains(id)) {
                return Err("ACCEPTANCE_FEATURE_REGRESSION".into());
            }
        }
        tx.execute(
            "INSERT INTO acceptance_verified_receipts (
             project_id,plan_journal_sequence,scope_digest,pending_receipt_hash,
             previous_verified_hash,head_sha,accepted_at,verified_at,
             accepted_feature_ids_json,accepted_weight,total_weight,
             verified_percent,verified_ci_jobs,owner_key_id,issuer_key_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                id,
                receipt.plan_journal_sequence,
                receipt.scope_digest,
                receipt.hash,
                receipt.previous_hash,
                receipt.head_sha,
                receipt.accepted_at,
                verified_at,
                ids_json,
                weight as i64,
                total as i64,
                percentage as i64,
                verified_ci_jobs as i64,
                receipt.owner.signer_key_id,
                issuer_key_id
            ],
        )
        .map_err(|_| "ACCEPTANCE_VERIFIED_REPLAY_OR_DB_CONFLICT")?;
        tx.commit()
            .map_err(|_| "ACCEPTANCE_VERIFIED_COMMIT_FAILED")?;
        Ok(VerifiedAcceptanceCheckpoint {
            project_id: id.to_owned(),
            plan_journal_sequence: receipt.plan_journal_sequence,
            scope_digest: receipt.scope_digest.clone(),
            head_sha: receipt.head_sha.clone(),
            receipt_hash: receipt.hash.clone(),
            verified_percent: percentage,
            accepted_features: receipt.accepted_feature_ids.clone(),
            checked_ci_jobs: verified_ci_jobs,
            accepted_at: receipt.accepted_at.clone(),
            verified_at,
            status: "qa_verified_ledger_not_production_release",
        })
    }

    /// Read-only counts are diagnostic; counts NEVER yield a verified
    /// percentage. Releasing a percentage requires fresh owner revocation
    /// checks plus independently verified GitHub/CI and scope at read time.
    #[allow(dead_code)]
    pub(super) fn qa_verified_receipt_count(&self, project_id: &str) -> Result<i64, String> {
        let id = validate_project_id(project_id)?;
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM acceptance_verified_receipts WHERE project_id=?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| "ACCEPTANCE_VERIFIED_DB_READ_FAILED".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_fabric::{IngestBatch, ProjectIdentity};
    fn project(store: &mut MemoryStore) {
        store
            .ingest(IngestBatch {
                identity: ProjectIdentity {
                    project_id: "project-a".into(),
                    name: "QA".into(),
                    repo_identity: None,
                    root_fingerprint: "qa-root".into(),
                },
                git_head: Some("a".repeat(40)),
                git_branch: Some("main".into()),
                indexed_at: "2026-11-05T09:00:00Z".into(),
                sources: vec![],
            })
            .unwrap();
    }
    #[test]
    fn verified_schema_default_is_empty_immutable_and_separate_from_pending() {
        let mut store = MemoryStore::open_in_memory().unwrap();
        project(&mut store);
        assert_eq!(store.qa_verified_receipt_count("project-a").unwrap(), 0);
        assert_eq!(store.pending_acceptance_count("project-a").unwrap(), 0);
        assert!(store
            .conn
            .execute(
                "INSERT INTO acceptance_verified_receipts
             (project_id,plan_journal_sequence,scope_digest,pending_receipt_hash,
              head_sha,accepted_at,verified_at,accepted_feature_ids_json,
              accepted_weight,total_weight,verified_percent,verified_ci_jobs,
              owner_key_id,issuer_key_id)
             VALUES ('project-a',1,?1,?2,?3,?4,?4,'[\"a\"]',1,5,20,1,'owner',?1)",
                params![
                    "a".repeat(64),
                    "b".repeat(64),
                    "c".repeat(40),
                    "2026-11-05T09:00:00.000Z"
                ]
            )
            .is_err()); // no pending receipt FK
        assert_eq!(store.qa_verified_receipt_count("project-a").unwrap(), 0);
    }
    #[test]
    fn scoped_weighted_percent_uses_exact_mvp_tasks_and_can_round_to_zero() {
        use crate::memory_fabric::mvp_progress::{MvpTaskProgress, RequiredCiCheck};
        let tasks: Vec<MvpTaskProgress> = (0..24)
            .map(|i| MvpTaskProgress {
                feature_id: format!("feat-{i:02}"),
                title: format!("Task {i}"),
                lane: "mvp".into(),
                weight: if i == 0 { 1 } else { 5 },
                acceptance_criteria: "Exact owner-reviewed acceptance criteria".into(),
                ci_checks: vec![RequiredCiCheck {
                    workflow: "CI".into(),
                    job: "unit".into(),
                }],
                reported_status: "claimed_done",
                status_journal_sequence: None,
                verified: false,
                test_claim: "none",
                test_name: None,
                test_journal_sequence: None,
            })
            .collect();
        let progress = MvpProgress {
            project_id: "project-a".into(),
            plan_journal_sequence: Some(10),
            plan_status: "imported_unverified",
            mvp_task_count: 24,
            side_task_count: 0,
            total_weight: 116,
            reported_done_weight: 0,
            reported_percent: None,
            tests_claimed_pass: 0,
            tests_claimed_fail: 0,
            tests_outdated: 0,
            verified_percent: None,
            tasks,
        };
        let scope = scope_policy::digest_for_progress(&progress).unwrap();
        let receipt = SignedAcceptanceReceipt {
            schema_version: "katosync.feature-acceptance/v1".into(),
            project_id: "project-a".into(),
            plan_journal_sequence: 10,
            scope_digest: scope,
            head_sha: "a".repeat(40),
            accepted_at: "2026-11-05T09:00:00.000Z".into(),
            accepted_feature_ids: vec!["feat-00".into()],
            ci: vec![super::super::CiReceipt {
                workflow: "CI".into(),
                job: "unit".into(),
                run_id: 17,
                head_sha: "a".repeat(40),
            }],
            owner: super::super::OwnerApproval {
                decision_id: "not-yet-issued".into(),
                signer_key_id: "not-verified".into(),
                signature: "none".into(),
            },
            previous_hash: None,
            hash: "f".repeat(64),
        };
        // 1 weight out of 116 is 0.86%. A signed accepted feature must not
        // fail just because display percentage rounds down to zero.
        assert_eq!(weighted_coverage(&progress, &receipt).unwrap(), (1, 116, 0));
        let mut missing_ci = receipt.clone();
        missing_ci.ci.clear();
        assert!(weighted_coverage(&progress, &missing_ci).is_err());
        let mut foreign = receipt.clone();
        foreign.accepted_feature_ids = vec!["missing-feature".into()];
        assert!(weighted_coverage(&progress, &foreign).is_err());
    }
    #[test]
    fn v5_to_v6_adds_verified_ledger_without_erasing_existing_project() {
        let path = std::env::temp_dir().join(format!(
            "katosync-gate8-{}-{}.db",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        {
            let mut store = MemoryStore::open(&path).unwrap();
            project(&mut store);
            store
                .conn
                .execute_batch(
                    "DROP TRIGGER acceptance_verified_no_update;
                 DROP TRIGGER acceptance_verified_no_delete;
                 DROP TABLE acceptance_verified_receipts;
                 PRAGMA user_version=5;",
                )
                .unwrap();
            let version: i64 = store
                .conn
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .unwrap();
            assert_eq!(version, 5);
        }
        let old = MemoryStore::open_read_only(&path).unwrap().unwrap();
        assert_eq!(old.snapshot("project-a").unwrap().name, "QA");
        drop(old);
        let restored = MemoryStore::open(&path).unwrap();
        let version: i64 = restored
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 6);
        assert_eq!(restored.snapshot("project-a").unwrap().name, "QA");
        assert_eq!(restored.qa_verified_receipt_count("project-a").unwrap(), 0);
        drop(restored);
        std::fs::remove_file(&path).unwrap();
    }
    #[test]
    fn verified_rows_are_uneditable_even_for_direct_local_sql() {
        let mut store = MemoryStore::open_in_memory().unwrap();
        project(&mut store);
        // Fake pending records are possible in a unit test connection but
        // cannot cross the real private verifier+issuer+CI promotion boundary.
        store
            .conn
            .execute(
                "INSERT INTO acceptance_pending_receipts (
                 project_id,plan_journal_sequence,scope_digest,head_sha,
                 accepted_at,owner_decision_id,receipt_hash,previous_hash,payload_json
             ) VALUES ('project-a',1,?1,?2,?3,'decision-qa',?4,NULL,'{}')",
                params![
                    "a".repeat(64),
                    "b".repeat(40),
                    "2026-11-05T09:00:00.000Z",
                    "c".repeat(64)
                ],
            )
            .unwrap();
        store
            .conn
            .execute(
                "INSERT INTO acceptance_verified_receipts (
                 project_id,plan_journal_sequence,scope_digest,pending_receipt_hash,
                 head_sha,accepted_at,verified_at,accepted_feature_ids_json,
                 accepted_weight,total_weight,verified_percent,verified_ci_jobs,
                 owner_key_id,issuer_key_id
             ) VALUES ('project-a',1,?1,?2,?3,?4,?4,'[\"a\"]',1,5,20,1,'owner',?1)",
                params![
                    "a".repeat(64),
                    "c".repeat(64),
                    "b".repeat(40),
                    "2026-11-05T09:00:00.000Z"
                ],
            )
            .unwrap();
        assert_eq!(store.qa_verified_receipt_count("project-a").unwrap(), 1);
        assert!(store
            .conn
            .execute(
                "UPDATE acceptance_verified_receipts SET verified_percent=100",
                []
            )
            .is_err());
        assert!(store
            .conn
            .execute("DELETE FROM acceptance_verified_receipts", [])
            .is_err());
        // SQL presence is never enough to surface an actual verified %.
        assert_eq!(
            store
                .project_mvp_progress("project-a", &"b".repeat(40))
                .unwrap()
                .verified_percent,
            None
        );
    }
    #[test]
    fn no_qa_verified_promotion_from_a_fake_client_receipt_or_non_qa_build() {
        let mut store = MemoryStore::open_in_memory().unwrap();
        project(&mut store);
        let progress = MvpProgress {
            project_id: "project-a".into(),
            plan_journal_sequence: Some(1),
            plan_status: "missing_explicit_mvp_scope",
            mvp_task_count: 0,
            side_task_count: 0,
            total_weight: 0,
            reported_done_weight: 0,
            reported_percent: None,
            tests_claimed_pass: 0,
            tests_claimed_fail: 0,
            tests_outdated: 0,
            verified_percent: None,
            tasks: vec![],
        };
        let receipt = SignedAcceptanceReceipt {
            schema_version: "katosync.feature-acceptance/v1".into(),
            project_id: "project-a".into(),
            plan_journal_sequence: 1,
            scope_digest: "a".repeat(64),
            head_sha: "b".repeat(40),
            accepted_at: "2026-11-05T09:00:00.000Z".into(),
            accepted_feature_ids: vec!["a".into()],
            ci: vec![],
            owner: super::super::OwnerApproval {
                decision_id: "not-real".into(),
                signer_key_id: "self".into(),
                signature: "none".into(),
            },
            previous_hash: None,
            hash: "c".repeat(64),
        };
        assert!(store
            .append_qa_verified_acceptance(&receipt, &progress, &receipt.hash, 1, &"d".repeat(64))
            .is_err());
        assert_eq!(store.qa_verified_receipt_count("project-a").unwrap(), 0);
    }
}
