// NMKato Solutions — KatoSync 4.0: signed, append-only PENDING acceptance receipts.
mod external_checks;
mod owner_authority;
mod reviewer_attestation;
pub(crate) use reviewer_attestation::verify_gate10_native_review;
mod scope_policy;
pub(super) mod verified_ledger;
// NEVER treat this table as approved features. GitHub CI and ancestry are not yet
// independently verified here. There is intentionally NO Tauri write/approval IPC.
use super::{store::MemoryStore, validate_project_id};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

pub(super) const SCHEMA_V5: &str = r#"
CREATE TABLE acceptance_pending_receipts (
  receipt_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE RESTRICT,
  plan_journal_sequence INTEGER NOT NULL CHECK(plan_journal_sequence > 0),
  scope_digest TEXT NOT NULL CHECK(length(scope_digest)=64),
  head_sha TEXT NOT NULL CHECK(length(head_sha) IN (40,64)),
  accepted_at TEXT NOT NULL,
  owner_decision_id TEXT NOT NULL UNIQUE,
  receipt_hash TEXT NOT NULL UNIQUE CHECK(length(receipt_hash)=64),
  previous_hash TEXT,
  payload_json TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'pending_external_checks'
    CHECK(review_state='pending_external_checks'),
  UNIQUE(project_id, plan_journal_sequence, head_sha)
) STRICT;
CREATE INDEX acceptance_pending_project_history
  ON acceptance_pending_receipts(project_id,plan_journal_sequence,receipt_id);
CREATE TRIGGER acceptance_pending_no_update
  BEFORE UPDATE ON acceptance_pending_receipts
  BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER acceptance_pending_no_delete
  BEFORE DELETE ON acceptance_pending_receipts
  BEGIN SELECT RAISE(ABORT,'append_only'); END;
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CiReceipt {
    workflow: String,
    job: String,
    run_id: u64,
    head_sha: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OwnerApproval {
    decision_id: String,
    signer_key_id: String,
    signature: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SignedAcceptanceReceipt {
    schema_version: String,
    project_id: String,
    plan_journal_sequence: i64,
    scope_digest: String,
    head_sha: String,
    accepted_at: String,
    accepted_feature_ids: Vec<String>,
    ci: Vec<CiReceipt>,
    owner: OwnerApproval,
    previous_hash: Option<String>,
    hash: String,
}
fn is_sha(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn is_digest(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn bounded(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.trim() == s
}
fn sha256_hex(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

/// Exactly mirrors TS acceptanceOwnerSigningPayload40, with the \n delimiter.
/// The owner signs this fixed data, NOT a browser-supplied "ownerApproved" flag.
fn signing_bytes(r: &SignedAcceptanceReceipt) -> Vec<u8> {
    let checks: Vec<_> =
        r.ci.iter()
            .map(|c| serde_json::json!([c.workflow, c.job, c.run_id, c.head_sha]))
            .collect();
    let fields = serde_json::json!([
        r.schema_version,
        r.project_id,
        r.plan_journal_sequence,
        r.scope_digest,
        r.head_sha,
        r.accepted_at,
        r.accepted_feature_ids,
        checks,
        r.owner.decision_id,
        r.owner.signer_key_id,
        r.previous_hash
    ]);
    [
        b"KatoSync feature-acceptance v1\n".as_slice(),
        fields.to_string().as_bytes(),
    ]
    .concat()
}
/// Exactly mirrors TS acceptanceReceiptDigest40.
fn receipt_hash(r: &SignedAcceptanceReceipt) -> String {
    let checks: Vec<_> =
        r.ci.iter()
            .map(|c| serde_json::json!([c.workflow, c.job, c.run_id, c.head_sha]))
            .collect();
    let fields = serde_json::json!([
        r.schema_version,
        r.project_id,
        r.plan_journal_sequence,
        r.scope_digest,
        r.head_sha,
        r.accepted_at,
        r.accepted_feature_ids,
        checks,
        [
            r.owner.decision_id.clone(),
            r.owner.signer_key_id.clone(),
            r.owner.signature.clone()
        ],
        r.previous_hash
    ]);
    sha256_hex(fields.to_string().as_bytes())
}
fn validate_owner_signed(r: &SignedAcceptanceReceipt, pinned: &VerifyingKey) -> Result<(), String> {
    validate_project_id(&r.project_id)?;
    if r.schema_version != "katosync.feature-acceptance/v1"
        || r.plan_journal_sequence <= 0
        || !is_digest(&r.scope_digest)
        || !is_sha(&r.head_sha)
        || !is_digest(&r.hash)
        || !bounded(&r.owner.decision_id, 160)
        || !bounded(&r.owner.signer_key_id, 160)
        || r.accepted_feature_ids.is_empty()
        || r.accepted_feature_ids.len() > 24
        || r.ci.is_empty()
        || r.ci.len() > 120
        || r.previous_hash.as_ref().is_some_and(|h| !is_digest(h))
    {
        return Err("ACCEPTANCE_INVALID_ENVELOPE".into());
    }
    let at = DateTime::parse_from_rfc3339(&r.accepted_at).map_err(|_| "ACCEPTANCE_INVALID_TIME")?;
    if at.to_rfc3339_opts(SecondsFormat::Millis, true) != r.accepted_at
        || at.timestamp_millis()
            > Utc::now().timestamp_millis() + Duration::minutes(1).num_milliseconds()
    {
        return Err("ACCEPTANCE_INVALID_TIME".into());
    }
    if r.accepted_feature_ids.iter().any(|f| !bounded(f, 100))
        || r.accepted_feature_ids.windows(2).any(|w| w[0] >= w[1])
    {
        return Err("ACCEPTANCE_INVALID_FEATURES".into());
    }
    let mut checks = BTreeSet::new();
    for c in &r.ci {
        if !bounded(&c.workflow, 120)
            || !bounded(&c.job, 120)
            || c.run_id == 0
            || !c.head_sha.eq_ignore_ascii_case(&r.head_sha)
            || !checks.insert((&c.workflow, &c.job))
        {
            return Err("ACCEPTANCE_INVALID_CI_METADATA".into());
        }
    }
    if receipt_hash(r) != r.hash.to_ascii_lowercase() {
        return Err("ACCEPTANCE_DIGEST_MISMATCH".into());
    }
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(&r.owner.signature)
        .map_err(|_| "ACCEPTANCE_INVALID_SIGNATURE")?;
    let signature =
        Signature::from_slice(&signature_bytes).map_err(|_| "ACCEPTANCE_INVALID_SIGNATURE")?;
    pinned
        .verify_strict(&signing_bytes(r), &signature)
        .map_err(|_| "ACCEPTANCE_UNTRUSTED_OWNER_SIGNATURE".to_string())
}
impl MemoryStore {
    /// Stages an owner-signed receipt only. Caller MUST supply an independently
    /// pinned owner key, never a key from the receipt or a WebView.
    /// No result of this method may count as a verified feature.
    #[allow(dead_code)]
    pub(super) fn stage_owner_signed_acceptance(
        &mut self,
        receipt: &SignedAcceptanceReceipt,
        pinned_owner_key: &VerifyingKey,
    ) -> Result<(), String> {
        validate_owner_signed(receipt, pinned_owner_key)?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| "ACCEPTANCE_DB_LOCKED")?;
        let previous: Option<(String, String, String, String)> = tx
            .query_row(
                "SELECT receipt_hash,scope_digest,accepted_at,payload_json
             FROM acceptance_pending_receipts
             WHERE project_id=?1 AND plan_journal_sequence=?2
             ORDER BY receipt_id DESC LIMIT 1",
                params![receipt.project_id, receipt.plan_journal_sequence],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()
            .map_err(|_| "ACCEPTANCE_DB_READ_FAILED")?;
        if let Some((last_hash, last_scope, last_at, last_json)) = previous {
            if receipt.previous_hash.as_deref() != Some(last_hash.as_str())
                || last_scope != receipt.scope_digest
                || last_at >= receipt.accepted_at
            {
                return Err("ACCEPTANCE_CHAIN_OR_SCOPE_CHANGED".into());
            }
            let last: SignedAcceptanceReceipt = serde_json::from_str(&last_json)
                .map_err(|_| "ACCEPTANCE_STORED_RECEIPT_CORRUPT")?;
            if receipt_hash(&last) != last_hash {
                return Err("ACCEPTANCE_STORED_RECEIPT_CORRUPT".into());
            }
            let next: BTreeSet<_> = receipt.accepted_feature_ids.iter().collect();
            if last
                .accepted_feature_ids
                .iter()
                .any(|id| !next.contains(id))
            {
                return Err("ACCEPTANCE_FEATURE_REGRESSION".into());
            }
        } else if receipt.previous_hash.is_some() {
            return Err("ACCEPTANCE_CHAIN_OR_SCOPE_CHANGED".into());
        }
        let count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM acceptance_pending_receipts WHERE project_id=?1
             AND plan_journal_sequence=?2",
                params![receipt.project_id, receipt.plan_journal_sequence],
                |row| row.get(0),
            )
            .map_err(|_| "ACCEPTANCE_DB_READ_FAILED")?;
        if count >= 512 {
            return Err("ACCEPTANCE_RECEIPT_LIMIT".into());
        }
        let payload = serde_json::to_string(receipt).map_err(|_| "ACCEPTANCE_INVALID_ENVELOPE")?;
        tx.execute(
            "INSERT INTO acceptance_pending_receipts (
             project_id,plan_journal_sequence,scope_digest,head_sha,accepted_at,
             owner_decision_id,receipt_hash,previous_hash,payload_json
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                receipt.project_id,
                receipt.plan_journal_sequence,
                receipt.scope_digest,
                receipt.head_sha,
                receipt.accepted_at,
                receipt.owner.decision_id,
                receipt.hash,
                receipt.previous_hash,
                payload
            ],
        )
        .map_err(|_| "ACCEPTANCE_REPLAY_OR_DB_CONFLICT")?;
        tx.commit().map_err(|_| "ACCEPTANCE_DB_COMMIT_FAILED")?;
        Ok(())
    }
    /// Read-only operator status. PENDING receipts have ZERO authority to
    /// change verifiedPercent, regardless of signatures or CI fields.
    #[allow(dead_code)]
    pub(super) fn pending_acceptance_count(&self, project_id: &str) -> Result<i64, String> {
        let id = validate_project_id(project_id)?;
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM acceptance_pending_receipts WHERE project_id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|_| "ACCEPTANCE_DB_READ_FAILED".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_fabric::{IngestBatch, ProjectIdentity};
    use ed25519_dalek::{Signer, SigningKey};

    fn project(store: &mut MemoryStore, id: &str) {
        store
            .ingest(IngestBatch {
                identity: ProjectIdentity {
                    project_id: id.into(),
                    name: "QA".into(),
                    repo_identity: None,
                    root_fingerprint: "immutable-qa-root".into(),
                },
                git_head: Some("a".repeat(40)),
                git_branch: Some("main".into()),
                indexed_at: "2026-11-04T12:00:00Z".into(),
                sources: vec![],
            })
            .unwrap();
    }
    fn signed(
        key: &SigningKey,
        head: char,
        ids: &[&str],
        prev: Option<String>,
    ) -> SignedAcceptanceReceipt {
        let mut r = SignedAcceptanceReceipt {
            schema_version: "katosync.feature-acceptance/v1".into(),
            project_id: "alpha".into(),
            plan_journal_sequence: 42,
            scope_digest: "f".repeat(64),
            head_sha: head.to_string().repeat(40),
            accepted_at: "2026-11-04T12:00:00.000Z".into(),
            accepted_feature_ids: ids.iter().map(|v| v.to_string()).collect(),
            ci: vec![CiReceipt {
                workflow: "CI".into(),
                job: "qa".into(),
                run_id: 42,
                head_sha: head.to_string().repeat(40),
            }],
            owner: OwnerApproval {
                decision_id: format!("approval-{head}"),
                signer_key_id: "owner-keychain-pinned".into(),
                signature: String::new(),
            },
            previous_hash: prev,
            hash: String::new(),
        };
        r.owner.signature = URL_SAFE_NO_PAD.encode(key.sign(&signing_bytes(&r)).to_bytes());
        r.hash = receipt_hash(&r);
        r
    }
    #[test]
    fn typescript_rust_receipt_hash_and_owner_domain_separator_match() {
        // Fixed vector from native Node TypeScript WebCrypto, not Rust itself.
        let r = SignedAcceptanceReceipt {
            schema_version: "katosync.feature-acceptance/v1".into(),
            project_id: "project-a".into(),
            plan_journal_sequence: 17,
            scope_digest: "ff4e2eded09670c7d20ea1d61f020dd2c36b914c5de2916980c5176eefcf4f7d".into(),
            head_sha: "a".repeat(40),
            accepted_at: "2026-11-04T12:00:00.000Z".into(),
            accepted_feature_ids: vec!["feat-a".into()],
            ci: vec![
                CiReceipt {
                    workflow: "CI".into(),
                    job: "test Linux".into(),
                    run_id: 17,
                    head_sha: "a".repeat(40),
                },
                CiReceipt {
                    workflow: "CI".into(),
                    job: "test macOS".into(),
                    run_id: 18,
                    head_sha: "a".repeat(40),
                },
            ],
            owner: OwnerApproval {
                decision_id: "owner-decision-1".into(),
                signer_key_id: "pinned-1".into(),
                signature: "qa-sig-placeholder".into(),
            },
            previous_hash: None,
            hash: String::new(),
        };
        assert_eq!(
            receipt_hash(&r),
            "73748b81107e4ea7ad8ccc98309d144216a6b248f35234922c81d060f61ae0bc"
        );
        let message = signing_bytes(&r);
        assert_eq!(message.len(), 397);
        assert_eq!(
            format!("{:x}", Sha256::digest(message)),
            "b449465a3ce1a183067cccc4dc9e27d364e0372485bcb6360cb80d78a24599b5"
        );
    }
    #[test]
    fn cryptographic_owner_signature_not_flag_and_pending_never_verified() {
        let mut store = MemoryStore::open_in_memory().unwrap();
        project(&mut store, "alpha");
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let first = signed(&key, 'a', &["one"], None);
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert!(store
            .stage_owner_signed_acceptance(&first, &other.verifying_key())
            .is_err());
        assert_eq!(store.pending_acceptance_count("alpha").unwrap(), 0);
        store
            .stage_owner_signed_acceptance(&first, &key.verifying_key())
            .unwrap();
        assert_eq!(store.pending_acceptance_count("alpha").unwrap(), 1);
        // The existing production progress path is intentionally untouched.
        let state = store
            .project_mvp_progress("alpha", &"a".repeat(40))
            .unwrap();
        assert_eq!(state.verified_percent, None);
        assert!(store
            .stage_owner_signed_acceptance(&first, &key.verifying_key())
            .is_err());
    }
    #[test]
    fn append_only_and_chain_check_reject_edit_delete_replay_and_regression() {
        let mut store = MemoryStore::open_in_memory().unwrap();
        project(&mut store, "alpha");
        let key = SigningKey::from_bytes(&[3u8; 32]);
        let first = signed(&key, 'a', &["one"], None);
        store
            .stage_owner_signed_acceptance(&first, &key.verifying_key())
            .unwrap();
        assert!(store
            .conn
            .execute("DELETE FROM acceptance_pending_receipts", [])
            .is_err());
        assert!(store
            .conn
            .execute(
                "UPDATE acceptance_pending_receipts SET review_state='pending_external_checks'",
                []
            )
            .is_err());
        let mut next = signed(&key, 'b', &["one", "two"], Some(first.hash.clone()));
        next.accepted_at = "2026-11-04T13:00:00.000Z".into();
        next.owner.signature = URL_SAFE_NO_PAD.encode(key.sign(&signing_bytes(&next)).to_bytes());
        next.hash = receipt_hash(&next);
        store
            .stage_owner_signed_acceptance(&next, &key.verifying_key())
            .unwrap();
        assert_eq!(store.pending_acceptance_count("alpha").unwrap(), 2);
        let mut regression = signed(&key, 'c', &["one"], Some(next.hash.clone()));
        regression.accepted_at = "2026-11-04T14:00:00.000Z".into();
        regression.owner.signature =
            URL_SAFE_NO_PAD.encode(key.sign(&signing_bytes(&regression)).to_bytes());
        regression.hash = receipt_hash(&regression);
        assert!(store
            .stage_owner_signed_acceptance(&regression, &key.verifying_key())
            .is_err());
        let mut changed = next.clone();
        changed.owner.decision_id = "forged".into();
        assert!(store
            .stage_owner_signed_acceptance(&changed, &key.verifying_key())
            .is_err());
    }
}
