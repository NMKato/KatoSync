// Created by NMKato Solutions
// Read-only Uebersicht der Memory Fabric fuer die Vision-Ansicht (Systemgraph).
// Liefert nur Zaehler, Wahrheitsstufen, Index-Zeitpunkt, gespeicherten HEAD und registrierte
// Node-Identitaeten – nie Inhalte, Chunks, Quellpfade, Evidenztexte oder Persona-Details.
// Die Datenbank wird ausschliesslich lesend geoeffnet und niemals angelegt.
use super::{store::MemoryStore, NodeIdentityKind, MEMORY_FABRIC_SCHEMA_VERSION};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::{path::Path, time::Duration};

pub(crate) const MEMORY_OVERVIEW_SCHEMA_VERSION: &str = "katosync.memory-overview/v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectMemoryOverview {
    pub project_id: String,
    pub name: String,
    pub git_head: Option<String>,
    pub git_branch: Option<String>,
    pub indexed_at: String,
    pub sources: i64,
    pub chunks: i64,
    pub observed: i64,
    pub verified: i64,
    pub canonical: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeIdentityOverview {
    pub node_id: String,
    pub display_name: String,
    pub kind: NodeIdentityKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryFabricOverview {
    pub schema_version: String,
    pub fabric_schema_version: String,
    /// false = noch kein Store vorhanden bzw. unbekannte Schema-Version (nichts erfinden).
    pub available: bool,
    pub projects: Vec<ProjectMemoryOverview>,
    pub identities: Vec<NodeIdentityOverview>,
}

impl MemoryFabricOverview {
    pub(crate) fn unavailable() -> Self {
        Self {
            schema_version: MEMORY_OVERVIEW_SCHEMA_VERSION.to_string(),
            fabric_schema_version: MEMORY_FABRIC_SCHEMA_VERSION.to_string(),
            available: false,
            projects: Vec::new(),
            identities: Vec::new(),
        }
    }
}

fn db_error(error: rusqlite::Error) -> String {
    format!("Memory-Fabric-Datenbankfehler ({error}).")
}

impl MemoryStore {
    /// Oeffnet einen vorhandenen Store nur lesend. Fehlt die Datei oder passt die Schema-Version
    /// nicht, gibt es `None` – es wird weder eine Datei noch ein Schema angelegt.
    pub(crate) fn open_read_only(path: &Path) -> Result<Option<Self>, String> {
        if !path.is_file() {
            return Ok(None);
        }
        let conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(db_error)?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(db_error)?;
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(db_error)?;
        if version != super::store::SCHEMA_USER_VERSION {
            return Ok(None);
        }
        Ok(Some(Self { conn }))
    }

    pub(crate) fn overview(&self) -> Result<MemoryFabricOverview, String> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT p.project_id, p.name, p.git_head, p.git_branch, p.indexed_at,
                        (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.project_id),
                        (SELECT COUNT(*) FROM chunks c WHERE c.project_id = p.project_id),
                        (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.project_id AND s.truth_rank = 0),
                        (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.project_id AND s.truth_rank = 1),
                        (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.project_id AND s.truth_rank = 2)
                   FROM projects p ORDER BY p.project_id",
            )
            .map_err(db_error)?;
        let projects = statement
            .query_map([], |row| {
                Ok(ProjectMemoryOverview {
                    project_id: row.get(0)?,
                    name: row.get(1)?,
                    git_head: row.get(2)?,
                    git_branch: row.get(3)?,
                    indexed_at: row.get(4)?,
                    sources: row.get(5)?,
                    chunks: row.get(6)?,
                    observed: row.get(7)?,
                    verified: row.get(8)?,
                    canonical: row.get(9)?,
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;

        let mut statement = self
            .conn
            .prepare(
                "SELECT node_id, display_name, identity_kind FROM node_identities ORDER BY node_id",
            )
            .map_err(db_error)?;
        let identities = statement
            .query_map([], |row| {
                Ok(NodeIdentityOverview {
                    node_id: row.get(0)?,
                    display_name: row.get(1)?,
                    kind: if row.get::<_, String>(2)? == "rex_main" {
                        NodeIdentityKind::RexMain
                    } else {
                        NodeIdentityKind::NamedNode
                    },
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;

        Ok(MemoryFabricOverview {
            available: true,
            projects,
            identities,
            ..MemoryFabricOverview::unavailable()
        })
    }
}
