// Created by NMKato Solutions
// SQLite-Speicher der Memory Fabric (technische Wahrheit). FTS5 fuer lexikalisches Retrieval.
// Jede Abfrage ist an project_id gebunden; Indexierung ersetzt den Projekt-Snapshot atomar
// (eine IMMEDIATE-Transaktion = ein Writer). Freigaben (canonical) liegen getrennt und sind an
// den Content-Hash gebunden, damit eine geaenderte Quelle nie stillschweigend canonical bleibt.
use super::{
    ingest::{self, admit_reason, chunk_markdown, redact_for_memory, sha256_hex},
    validate_project_id, EvidenceRef, IngestBatch, IngestReport, ProjectIdentity, Promotion,
    TruthLevel, MEMORY_FABRIC_SCHEMA_VERSION,
};
use crate::context_pack::bounded_text;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::{collections::BTreeSet, path::Path, time::Duration};

pub(super) const SCHEMA_USER_VERSION: i64 = 1;

const SCHEMA: &str = r#"
CREATE TABLE node_identities (
    node_id              TEXT PRIMARY KEY,
    display_name         TEXT NOT NULL COLLATE NOCASE,
    identity_kind        TEXT NOT NULL CHECK (identity_kind IN ('rex_main','named_node')),
    name_origin          TEXT NOT NULL CHECK (name_origin IN ('reserved_main','self_selected')),
    role_summary         TEXT NOT NULL,
    traits_json          TEXT NOT NULL,
    capabilities_json    TEXT NOT NULL,
    experience_refs_json TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    updated_at           TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX node_identity_name_unique ON node_identities(display_name COLLATE NOCASE);
CREATE UNIQUE INDEX node_identity_single_rex ON node_identities(identity_kind) WHERE identity_kind = 'rex_main';

CREATE TABLE projects (
    project_id       TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    repo_identity    TEXT,
    root_fingerprint TEXT NOT NULL,
    git_head         TEXT,
    git_branch       TEXT,
    indexed_at       TEXT NOT NULL
) STRICT;

CREATE TABLE sources (
    source_id         TEXT PRIMARY KEY,
    project_id        TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    relative_path     TEXT NOT NULL,
    kind              TEXT NOT NULL,
    truth_rank        INTEGER NOT NULL CHECK (truth_rank BETWEEN 0 AND 2),
    content_hash      TEXT NOT NULL,
    git_head          TEXT,
    modified_at       TEXT,
    size_bytes        INTEGER NOT NULL,
    content_truncated INTEGER NOT NULL,
    indexed_at        TEXT NOT NULL,
    UNIQUE (project_id, relative_path)
) STRICT;

CREATE TABLE chunks (
    chunk_rowid INTEGER PRIMARY KEY,
    chunk_id    TEXT NOT NULL UNIQUE,
    project_id  TEXT NOT NULL,
    source_id   TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    heading     TEXT NOT NULL,
    body        TEXT NOT NULL,
    summary     TEXT NOT NULL,
    chunk_hash  TEXT NOT NULL,
    char_count  INTEGER NOT NULL
) STRICT;
CREATE INDEX chunks_by_project ON chunks(project_id, source_id, ordinal);

CREATE TABLE evidence (
    evidence_id INTEGER PRIMARY KEY,
    project_id  TEXT NOT NULL,
    source_id   TEXT NOT NULL REFERENCES sources(source_id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('git','ci','runtime','memory','human','test','other')),
    truth_rank  INTEGER NOT NULL CHECK (truth_rank BETWEEN 0 AND 2),
    ref         TEXT NOT NULL,
    verified_at TEXT
) STRICT;
CREATE INDEX evidence_by_source ON evidence(project_id, source_id);

CREATE TABLE promotions (
    project_id    TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    evidence_ref  TEXT NOT NULL,
    approved_by   TEXT NOT NULL,
    approved_at   TEXT NOT NULL,
    PRIMARY KEY (project_id, relative_path, content_hash)
) STRICT;

CREATE VIRTUAL TABLE chunk_fts USING fts5(
    heading, body,
    content = 'chunks', content_rowid = 'chunk_rowid',
    tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER chunks_after_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunk_fts(rowid, heading, body) VALUES (new.chunk_rowid, new.heading, new.body);
END;
CREATE TRIGGER chunks_after_delete AFTER DELETE ON chunks BEGIN
    INSERT INTO chunk_fts(chunk_fts, rowid, heading, body)
    VALUES ('delete', old.chunk_rowid, old.heading, old.body);
END;
"#;

pub(crate) struct MemoryStore {
    pub(super) conn: Connection,
}

/// Roh-Kandidat aus FTS5 (nur innerhalb eines Projekts).
#[derive(Debug, Clone)]
pub(super) struct Candidate {
    pub chunk_id: String,
    pub source_id: String,
    pub relative_path: String,
    pub kind: String,
    pub ordinal: i64,
    pub heading: String,
    pub summary: String,
    pub body: String,
    pub truth: TruthLevel,
    pub content_hash: String,
    pub git_head: Option<String>,
    pub indexed_at: String,
    /// bm25 aus FTS5 (kleiner = relevanter).
    pub bm25: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotChunk {
    pub ordinal: i64,
    pub heading: String,
    pub summary: String,
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnapshotSource {
    pub relative_path: String,
    pub kind: String,
    pub truth_level: TruthLevel,
    pub content_hash: String,
    pub git_head: Option<String>,
    pub modified_at: Option<String>,
    pub content_truncated: bool,
    pub indexed_at: String,
    pub evidence: Vec<EvidenceRef>,
    pub chunks: Vec<SnapshotChunk>,
}

/// Vollstaendige, projektgebundene Sicht auf die gespeicherte Wahrheit (Basis fuer Projektionen).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectSnapshot {
    pub schema_version: String,
    pub project_id: String,
    pub name: String,
    pub repo_identity: Option<String>,
    pub git_head: Option<String>,
    pub git_branch: Option<String>,
    pub indexed_at: String,
    pub sources: Vec<SnapshotSource>,
}

fn db_error(error: rusqlite::Error) -> String {
    // Keine Pfade oder Inhalte in Fehlermeldungen; SQLite-Fehlertexte enthalten keine Nutzdaten.
    format!("Memory-Fabric-Datenbankfehler ({error}).")
}

fn source_id(project_id: &str, relative_path: &str) -> String {
    sha256_hex(&format!("source\0{project_id}\0{relative_path}"))
}

impl MemoryStore {
    pub(crate) fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(db_error)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(db_error)?;
        Self::init(conn)
    }

    #[cfg(test)]
    pub(crate) fn open_in_memory() -> Result<Self, String> {
        Self::init(Connection::open_in_memory().map_err(db_error)?)
    }

    fn init(conn: Connection) -> Result<Self, String> {
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(db_error)?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(db_error)?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(db_error)?;
        match version {
            0 => {
                conn.execute_batch(&format!(
                    "BEGIN;{SCHEMA}PRAGMA user_version = {SCHEMA_USER_VERSION};COMMIT;"
                ))
                .map_err(|error| {
                    format!("Memory-Fabric-Schema konnte nicht angelegt werden (FTS5 erforderlich): {error}")
                })?;
            }
            SCHEMA_USER_VERSION => {}
            _ => {
                return Err(
                    "Memory-Fabric-Datenbank stammt aus einer neueren KatoSync-Version."
                        .to_string(),
                )
            }
        }
        Ok(Self { conn })
    }

    /// Ersetzt den Projekt-Snapshot atomar. Nicht zulaessige Quellen werden mit Grund uebersprungen,
    /// ihre aelteren Indexstaende verschwinden (fail-closed).
    pub(crate) fn ingest(&mut self, batch: IngestBatch) -> Result<IngestReport, String> {
        let IngestBatch {
            identity,
            git_head,
            git_branch,
            indexed_at,
            sources,
        } = batch;
        let project_id = validate_project_id(&identity.project_id)?.to_string();
        let git_head = git_head.filter(|head| is_hex_sha(head));
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;

        let existing: Option<(String, Option<String>)> = tx
            .query_row(
                "SELECT root_fingerprint, repo_identity FROM projects WHERE project_id = ?1",
                params![project_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        if let Some((fingerprint, repo_identity)) = &existing {
            let same_root = fingerprint == &identity.root_fingerprint;
            let same_repo = repo_identity.is_some() && repo_identity == &identity.repo_identity;
            if !same_root && !same_repo {
                return Err(
                    "Projekt-ID ist bereits einem anderen Repository zugeordnet; Index unverändert."
                        .to_string(),
                );
            }
        }

        let previous: BTreeSet<String> = {
            let mut statement = tx
                .prepare("SELECT relative_path FROM sources WHERE project_id = ?1")
                .map_err(db_error)?;
            let rows = statement
                .query_map(params![project_id], |row| row.get::<_, String>(0))
                .map_err(db_error)?;
            rows.collect::<Result<_, _>>().map_err(db_error)?
        };

        upsert_project(
            &tx,
            &project_id,
            &identity,
            &git_head,
            &git_branch,
            &indexed_at,
        )?;
        for table in ["chunks", "evidence", "sources"] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE project_id = ?1"),
                params![project_id],
            )
            .map_err(db_error)?;
        }

        let mut report = IngestReport {
            schema_version: MEMORY_FABRIC_SCHEMA_VERSION.to_string(),
            project_id: project_id.clone(),
            git_head: git_head.clone(),
            indexed_sources: 0,
            chunks: 0,
            removed_sources: 0,
            skipped: Vec::new(),
            indexed_at: indexed_at.clone(),
        };
        let mut seen = BTreeSet::new();
        for source in sources {
            if let Some(reason) = admit_reason(&source) {
                report.skipped.push(ingest::skipped(&source, reason));
                continue;
            }
            if !seen.insert(source.relative_path.clone()) {
                report
                    .skipped
                    .push(ingest::skipped(&source, "duplicate_path".to_string()));
                continue;
            }
            report.chunks += insert_source(&tx, &project_id, &git_head, &indexed_at, &source)?;
            report.indexed_sources += 1;
        }
        report.removed_sources = previous.difference(&seen).count();
        tx.commit().map_err(db_error)?;
        Ok(report)
    }

    /// Menschliche Freigabe einer Quelle als canonical – nur fuer den aktuell indexierten Content-Hash.
    pub(crate) fn promote(&mut self, promotion: &Promotion) -> Result<(), String> {
        let project_id = validate_project_id(&promotion.project_id)?.to_string();
        let evidence_ref = bounded_text(&redact_for_memory(&promotion.evidence_ref), 300);
        let approved_by = bounded_text(&redact_for_memory(&promotion.approved_by), 120);
        if evidence_ref.is_empty() || approved_by.is_empty() {
            return Err("Freigabe braucht Evidenz-Referenz und freigebende Person.".to_string());
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        let current: Option<(String, String)> = tx
            .query_row(
                "SELECT source_id, content_hash FROM sources WHERE project_id = ?1 AND relative_path = ?2",
                params![project_id, promotion.relative_path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        let Some((source_id, content_hash)) = current else {
            return Err("Quelle ist für dieses Projekt nicht indexiert.".to_string());
        };
        if content_hash != promotion.expected_content_hash {
            return Err(
                "Quelle hat sich seit der Prüfung geändert; Freigabe nicht übernommen.".to_string(),
            );
        }
        tx.execute(
            "INSERT OR REPLACE INTO promotions
                (project_id, relative_path, content_hash, evidence_ref, approved_by, approved_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                project_id,
                promotion.relative_path,
                content_hash,
                evidence_ref,
                approved_by,
                promotion.approved_at
            ],
        )
        .map_err(db_error)?;
        tx.execute(
            "UPDATE sources SET truth_rank = 2 WHERE source_id = ?1",
            params![source_id],
        )
        .map_err(db_error)?;
        tx.execute(
            "INSERT INTO evidence (project_id, source_id, kind, truth_rank, ref, verified_at)
             VALUES (?1, ?2, 'human', 2, ?3, ?4)",
            params![
                project_id,
                source_id,
                format!("human:{approved_by}:{evidence_ref}"),
                promotion.approved_at
            ],
        )
        .map_err(db_error)?;
        tx.commit().map_err(db_error)
    }

    pub(crate) fn root_matches(&self, project_id: &str, fingerprint: &str) -> Result<bool, String> {
        let stored: Option<String> = self
            .conn
            .query_row(
                "SELECT root_fingerprint FROM projects WHERE project_id = ?1",
                params![project_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(db_error)?;
        stored
            .map(|stored| stored == fingerprint)
            .ok_or_else(|| "Projekt ist in der Memory Fabric noch nicht indexiert.".to_string())
    }

    pub(crate) fn source_paths(&self, project_id: &str) -> Result<Vec<String>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT relative_path FROM sources WHERE project_id = ?1 ORDER BY relative_path",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(params![project_id], |row| row.get(0))
            .map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }

    pub(super) fn search_candidates(
        &self,
        project_id: &str,
        match_expr: &str,
        min_truth: TruthLevel,
        pool: usize,
    ) -> Result<Vec<Candidate>, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT c.chunk_id, c.source_id, s.relative_path, s.kind, c.ordinal, c.heading,
                        c.summary, c.body, s.truth_rank, s.content_hash, s.git_head, s.indexed_at,
                        bm25(chunk_fts, 2.0, 1.0) AS rank
                   FROM chunk_fts
                   JOIN chunks c ON c.chunk_rowid = chunk_fts.rowid
                   JOIN sources s ON s.source_id = c.source_id
                  WHERE chunk_fts MATCH ?1
                    AND c.project_id = ?2
                    AND s.project_id = ?2
                    AND s.truth_rank >= ?3
                  ORDER BY rank, s.relative_path, c.ordinal
                  LIMIT ?4",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(
                params![match_expr, project_id, min_truth.rank(), pool as i64],
                |row| {
                    Ok(Candidate {
                        chunk_id: row.get(0)?,
                        source_id: row.get(1)?,
                        relative_path: row.get(2)?,
                        kind: row.get(3)?,
                        ordinal: row.get(4)?,
                        heading: row.get(5)?,
                        summary: row.get(6)?,
                        body: row.get(7)?,
                        truth: TruthLevel::from_rank(row.get(8)?),
                        content_hash: row.get(9)?,
                        git_head: row.get(10)?,
                        indexed_at: row.get(11)?,
                        bm25: row.get(12)?,
                    })
                },
            )
            .map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }

    pub(super) fn evidence_for(
        &self,
        project_id: &str,
        source_id: &str,
    ) -> Result<Vec<EvidenceRef>, String> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT kind, truth_rank, ref, verified_at FROM evidence
                  WHERE project_id = ?1 AND source_id = ?2 ORDER BY truth_rank DESC, evidence_id",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(params![project_id, source_id], |row| {
                Ok(EvidenceRef {
                    kind: row.get(0)?,
                    truth_level: TruthLevel::from_rank(row.get(1)?),
                    reference: row.get(2)?,
                    verified_at: row.get(3)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }

    pub(crate) fn snapshot(&self, project_id: &str) -> Result<ProjectSnapshot, String> {
        let project_id = validate_project_id(project_id)?;
        let header = self
            .conn
            .query_row(
                "SELECT name, repo_identity, git_head, git_branch, indexed_at
                   FROM projects WHERE project_id = ?1",
                params![project_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(db_error)?
            .ok_or_else(|| "Projekt ist in der Memory Fabric noch nicht indexiert.".to_string())?;

        let mut statement = self
            .conn
            .prepare(
                "SELECT source_id, relative_path, kind, truth_rank, content_hash, git_head,
                        modified_at, content_truncated, indexed_at
                   FROM sources WHERE project_id = ?1 ORDER BY relative_path",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(params![project_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    SnapshotSource {
                        relative_path: row.get(1)?,
                        kind: row.get(2)?,
                        truth_level: TruthLevel::from_rank(row.get(3)?),
                        content_hash: row.get(4)?,
                        git_head: row.get(5)?,
                        modified_at: row.get(6)?,
                        content_truncated: row.get::<_, i64>(7)? != 0,
                        indexed_at: row.get(8)?,
                        evidence: Vec::new(),
                        chunks: Vec::new(),
                    },
                ))
            })
            .map_err(db_error)?;
        let mut sources = Vec::new();
        for row in rows {
            let (source_id, mut source) = row.map_err(db_error)?;
            source.evidence = self.evidence_for(project_id, &source_id)?;
            source.chunks = self.chunks_for(project_id, &source_id)?;
            sources.push(source);
        }
        let (name, repo_identity, git_head, git_branch, indexed_at) = header;
        Ok(ProjectSnapshot {
            schema_version: MEMORY_FABRIC_SCHEMA_VERSION.to_string(),
            project_id: project_id.to_string(),
            name,
            repo_identity,
            git_head,
            git_branch,
            indexed_at,
            sources,
        })
    }

    fn chunks_for(&self, project_id: &str, source_id: &str) -> Result<Vec<SnapshotChunk>, String> {
        let mut statement = self
            .conn
            .prepare_cached(
                "SELECT ordinal, heading, summary, body FROM chunks
                  WHERE project_id = ?1 AND source_id = ?2 ORDER BY ordinal",
            )
            .map_err(db_error)?;
        let rows = statement
            .query_map(params![project_id, source_id], |row| {
                Ok(SnapshotChunk {
                    ordinal: row.get(0)?,
                    heading: row.get(1)?,
                    summary: row.get(2)?,
                    body: row.get(3)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }
}

fn is_hex_sha(value: &str) -> bool {
    (7..=64).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn upsert_project(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    identity: &ProjectIdentity,
    git_head: &Option<String>,
    git_branch: &Option<String>,
    indexed_at: &str,
) -> Result<(), String> {
    let name = bounded_text(&redact_for_memory(&identity.name), 120);
    let branch = git_branch
        .as_deref()
        .map(|branch| bounded_text(&redact_for_memory(branch), 200));
    tx.execute(
        "INSERT INTO projects
            (project_id, name, repo_identity, root_fingerprint, git_head, git_branch, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(project_id) DO UPDATE SET
            name = excluded.name, repo_identity = excluded.repo_identity,
            root_fingerprint = excluded.root_fingerprint, git_head = excluded.git_head,
            git_branch = excluded.git_branch, indexed_at = excluded.indexed_at",
        params![
            project_id,
            if name.is_empty() { project_id } else { &name },
            identity.repo_identity,
            identity.root_fingerprint,
            git_head,
            branch,
            indexed_at
        ],
    )
    .map_err(db_error)?;
    Ok(())
}

/// Schreibt eine zulaessige Quelle samt Evidenz und Chunks; liefert die Anzahl Chunks.
fn insert_source(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    git_head: &Option<String>,
    indexed_at: &str,
    source: &ingest::MemorySource,
) -> Result<usize, String> {
    let source_id = source_id(project_id, &source.relative_path);
    let content_hash = sha256_hex(&source.content);
    let promotion: Option<(String, String, String)> = tx
        .query_row(
            "SELECT evidence_ref, approved_by, approved_at FROM promotions
              WHERE project_id = ?1 AND relative_path = ?2 AND content_hash = ?3",
            params![project_id, source.relative_path, content_hash],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(db_error)?;
    let verified_head = git_head.as_ref().filter(|_| source.git_clean);
    let truth = if promotion.is_some() {
        TruthLevel::Canonical
    } else if verified_head.is_some() {
        TruthLevel::Verified
    } else {
        TruthLevel::Observed
    };

    tx.execute(
        "INSERT INTO sources
            (source_id, project_id, relative_path, kind, truth_rank, content_hash, git_head,
             modified_at, size_bytes, content_truncated, indexed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            source_id,
            project_id,
            source.relative_path,
            source.kind,
            truth.rank(),
            content_hash,
            git_head,
            source.modified_at,
            source.size_bytes as i64,
            source.content_truncated as i64,
            indexed_at
        ],
    )
    .map_err(db_error)?;

    let mut evidence: Vec<(&str, TruthLevel, String, Option<String>)> = Vec::new();
    match verified_head {
        Some(head) => evidence.push((
            "git",
            TruthLevel::Verified,
            format!("git:{head}:{}", source.relative_path),
            Some(indexed_at.to_string()),
        )),
        None => evidence.push((
            "memory",
            TruthLevel::Observed,
            format!(
                "file:{}@sha256:{}",
                source.relative_path,
                &content_hash[..16]
            ),
            None,
        )),
    }
    if let Some((evidence_ref, approved_by, approved_at)) = promotion {
        evidence.push((
            "human",
            TruthLevel::Canonical,
            format!("human:{approved_by}:{evidence_ref}"),
            Some(approved_at),
        ));
    }
    for (kind, level, reference, verified_at) in evidence {
        tx.execute(
            "INSERT INTO evidence (project_id, source_id, kind, truth_rank, ref, verified_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                project_id,
                source_id,
                kind,
                level.rank(),
                reference,
                verified_at
            ],
        )
        .map_err(db_error)?;
    }

    let chunks = chunk_markdown(&redact_for_memory(&source.content));
    for chunk in &chunks {
        let chunk_hash = sha256_hex(&format!("{}\0{}", chunk.heading, chunk.body));
        tx.execute(
            "INSERT INTO chunks
                (chunk_id, project_id, source_id, ordinal, heading, body, summary, chunk_hash, char_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                sha256_hex(&format!("{source_id}\0{}\0{chunk_hash}", chunk.ordinal)),
                project_id,
                source_id,
                chunk.ordinal as i64,
                chunk.heading,
                chunk.body,
                chunk.summary,
                chunk_hash,
                chunk.body.chars().count() as i64
            ],
        )
        .map_err(db_error)?;
    }
    Ok(chunks.len())
}
