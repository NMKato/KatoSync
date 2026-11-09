// Created by NMKato Solutions
// REX / Node-Identity der Memory Fabric.
// Die persistente KatoSync Device-ID ist die technische Identitaet. Display-Name/Persona sind
// reine Praesentations-/Arbeitsmetadaten und duerfen niemals Rechte, Leases oder Audit-Identitaet ersetzen.
// Der erste/Main Local Brain heisst fest REX. Weitere Nodes duerfen sich einmalig einen kurzen Namen
// (4-6 ASCII-Buchstaben) waehlen; stille Selbst-Umbenennung ist danach verboten.
use super::{ingest::redact_for_memory, store::MemoryStore};
use crate::context_pack::bounded_text;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

pub(crate) const NODE_IDENTITY_SCHEMA_VERSION: &str = "katosync.node-identity/v1";
pub(crate) const REX_MAIN_NAME: &str = "REX";
const MAX_ROLE_CHARS: usize = 240;
const MAX_TRAITS: usize = 8;
const MAX_CAPABILITIES: usize = 16;
const MAX_EXPERIENCE_REFS: usize = 16;
const MAX_ITEM_CHARS: usize = 96;
const MAX_REF_CHARS: usize = 180;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NodeIdentityKind {
    RexMain,
    NamedNode,
}

impl NodeIdentityKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::RexMain => "rex_main",
            Self::NamedNode => "named_node",
        }
    }

    fn parse(value: &str) -> Self {
        if value == "rex_main" {
            Self::RexMain
        } else {
            Self::NamedNode
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum NameOrigin {
    ReservedMain,
    SelfSelected,
}

impl NameOrigin {
    fn as_str(self) -> &'static str {
        match self {
            Self::ReservedMain => "reserved_main",
            Self::SelfSelected => "self_selected",
        }
    }

    fn parse(value: &str) -> Self {
        if value == "reserved_main" {
            Self::ReservedMain
        } else {
            Self::SelfSelected
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodePersona {
    pub role_summary: String,
    pub traits: Vec<String>,
    pub capabilities: Vec<String>,
    pub experience_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeIdentity {
    pub schema_version: String,
    pub node_id: String,
    pub display_name: String,
    pub kind: NodeIdentityKind,
    pub name_origin: NameOrigin,
    pub persona: NodePersona,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone)]
pub(crate) struct NamedIdentityProposal {
    pub node_id: String,
    pub display_name: String,
    pub role_summary: String,
    pub traits: Vec<String>,
    pub capabilities: Vec<String>,
    pub experience_refs: Vec<String>,
    pub now: String,
}

fn validate_node_id(node_id: &str) -> Result<&str, String> {
    let value = node_id.trim();
    let valid = !value.is_empty()
        && value.chars().count() <= 128
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'));
    if valid {
        Ok(value)
    } else {
        Err("Ungueltige KatoSync Node-ID.".to_string())
    }
}

fn normalize_named_display_name(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case(REX_MAIN_NAME) {
        return Err("REX ist fuer den Main Local Brain reserviert.".to_string());
    }
    let chars: Vec<char> = trimmed.chars().collect();
    if !(4..=6).contains(&chars.len()) || !chars.iter().all(|ch| ch.is_ascii_alphabetic()) {
        return Err("Agentenname muss aus 4 bis 6 Buchstaben bestehen.".to_string());
    }
    let mut normalized = String::new();
    for (index, ch) in chars.into_iter().enumerate() {
        normalized.push(if index == 0 {
            ch.to_ascii_uppercase()
        } else {
            ch.to_ascii_lowercase()
        });
    }
    Ok(normalized)
}

fn sanitize_list(values: Vec<String>, max_items: usize, max_chars: usize) -> Vec<String> {
    let mut unique = BTreeSet::new();
    for value in values.into_iter().take(max_items * 2) {
        let clean = bounded_text(&redact_for_memory(value.trim()), max_chars);
        if !clean.is_empty() {
            unique.insert(clean);
        }
        if unique.len() >= max_items {
            break;
        }
    }
    unique.into_iter().collect()
}

fn persona(
    role_summary: String,
    traits: Vec<String>,
    capabilities: Vec<String>,
    experience_refs: Vec<String>,
) -> NodePersona {
    NodePersona {
        role_summary: bounded_text(&redact_for_memory(role_summary.trim()), MAX_ROLE_CHARS),
        traits: sanitize_list(traits, MAX_TRAITS, MAX_ITEM_CHARS),
        capabilities: sanitize_list(capabilities, MAX_CAPABILITIES, MAX_ITEM_CHARS),
        experience_refs: sanitize_list(experience_refs, MAX_EXPERIENCE_REFS, MAX_REF_CHARS),
    }
}

fn json_vec(values: &[String]) -> Result<String, String> {
    serde_json::to_string(values)
        .map_err(|_| "Node-Identity konnte nicht serialisiert werden.".to_string())
}

fn parse_vec(value: String) -> Vec<String> {
    serde_json::from_str(&value).unwrap_or_default()
}

impl MemoryStore {
    pub(crate) fn identity(&self, node_id: &str) -> Result<Option<NodeIdentity>, String> {
        let node_id = validate_node_id(node_id)?;
        self.conn
            .query_row(
                "SELECT node_id, display_name, identity_kind, name_origin, role_summary,
                        traits_json, capabilities_json, experience_refs_json, created_at, updated_at
                   FROM node_identities WHERE node_id = ?1",
                [node_id],
                |row| {
                    Ok(NodeIdentity {
                        schema_version: NODE_IDENTITY_SCHEMA_VERSION.to_string(),
                        node_id: row.get(0)?,
                        display_name: row.get(1)?,
                        kind: NodeIdentityKind::parse(&row.get::<_, String>(2)?),
                        name_origin: NameOrigin::parse(&row.get::<_, String>(3)?),
                        persona: NodePersona {
                            role_summary: row.get(4)?,
                            traits: parse_vec(row.get(5)?),
                            capabilities: parse_vec(row.get(6)?),
                            experience_refs: parse_vec(row.get(7)?),
                        },
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Node-Identity konnte nicht gelesen werden ({error})."))
    }

    fn existing_name_owner(&self, display_name: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT node_id FROM node_identities WHERE lower(display_name) = lower(?1) LIMIT 1",
                [display_name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Node-Identity konnte nicht geprueft werden ({error})."))
    }

    fn persist_identity(&mut self, identity: &NodeIdentity) -> Result<NodeIdentity, String> {
        if let Some(existing) = self.identity(&identity.node_id)? {
            if existing.display_name != identity.display_name || existing.kind != identity.kind {
                return Err(
                    "Diese Node-ID besitzt bereits eine gebundene Identitaet; stille Umbenennung ist nicht erlaubt."
                        .to_string(),
                );
            }
        }
        if identity.kind == NodeIdentityKind::RexMain {
            let rex_owner: Option<String> = self
                .conn
                .query_row(
                    "SELECT node_id FROM node_identities WHERE identity_kind = 'rex_main' LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| {
                    format!("REX-Identitaet konnte nicht geprueft werden ({error}).")
                })?;
            if rex_owner
                .as_deref()
                .is_some_and(|owner| owner != identity.node_id)
            {
                return Err(
                    "REX ist in dieser Memory Fabric bereits an die Main-Node gebunden."
                        .to_string(),
                );
            }
        }
        if let Some(owner) = self.existing_name_owner(&identity.display_name)? {
            if owner != identity.node_id {
                return Err(
                    "Dieser Agentenname ist bereits an eine andere Node gebunden.".to_string(),
                );
            }
        }

        self.conn
            .execute(
                "INSERT INTO node_identities (
                    node_id, display_name, identity_kind, name_origin, role_summary,
                    traits_json, capabilities_json, experience_refs_json, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(node_id) DO UPDATE SET
                    role_summary = excluded.role_summary,
                    traits_json = excluded.traits_json,
                    capabilities_json = excluded.capabilities_json,
                    experience_refs_json = excluded.experience_refs_json,
                    updated_at = excluded.updated_at",
                params![
                    identity.node_id,
                    identity.display_name,
                    identity.kind.as_str(),
                    identity.name_origin.as_str(),
                    identity.persona.role_summary,
                    json_vec(&identity.persona.traits)?,
                    json_vec(&identity.persona.capabilities)?,
                    json_vec(&identity.persona.experience_refs)?,
                    identity.created_at,
                    identity.updated_at,
                ],
            )
            .map_err(|error| format!("Node-Identity konnte nicht gespeichert werden ({error})."))?;
        self.identity(&identity.node_id)?
            .ok_or_else(|| "Node-Identity fehlt nach dem Speichern.".to_string())
    }

    pub(crate) fn register_rex_main(
        &mut self,
        node_id: &str,
        role_summary: Option<String>,
        now: &str,
    ) -> Result<NodeIdentity, String> {
        let node_id = validate_node_id(node_id)?.to_string();
        let existing = self.identity(&node_id)?;
        let created_at = existing
            .as_ref()
            .map(|value| value.created_at.clone())
            .unwrap_or_else(|| now.to_string());
        let existing_persona = existing.as_ref().map(|value| value.persona.clone());
        let identity = NodeIdentity {
            schema_version: NODE_IDENTITY_SCHEMA_VERSION.to_string(),
            node_id,
            display_name: REX_MAIN_NAME.to_string(),
            kind: NodeIdentityKind::RexMain,
            name_origin: NameOrigin::ReservedMain,
            persona: persona(
                role_summary.unwrap_or_else(|| {
                    existing_persona
                        .as_ref()
                        .map(|value| value.role_summary.clone())
                        .unwrap_or_else(|| {
                            "Main Local Brain und lokaler REX-Koordinator.".to_string()
                        })
                }),
                existing_persona
                    .as_ref()
                    .map(|value| value.traits.clone())
                    .unwrap_or_default(),
                existing_persona
                    .as_ref()
                    .map(|value| value.capabilities.clone())
                    .unwrap_or_default(),
                existing_persona
                    .as_ref()
                    .map(|value| value.experience_refs.clone())
                    .unwrap_or_default(),
            ),
            created_at,
            updated_at: now.to_string(),
        };
        self.persist_identity(&identity)
    }

    pub(crate) fn register_named_identity(
        &mut self,
        proposal: NamedIdentityProposal,
    ) -> Result<NodeIdentity, String> {
        let node_id = validate_node_id(&proposal.node_id)?.to_string();
        let display_name = normalize_named_display_name(&proposal.display_name)?;
        let existing = self.identity(&node_id)?;
        let created_at = existing
            .as_ref()
            .map(|value| value.created_at.clone())
            .unwrap_or_else(|| proposal.now.clone());
        let identity = NodeIdentity {
            schema_version: NODE_IDENTITY_SCHEMA_VERSION.to_string(),
            node_id,
            display_name,
            kind: NodeIdentityKind::NamedNode,
            name_origin: NameOrigin::SelfSelected,
            persona: persona(
                proposal.role_summary,
                proposal.traits,
                proposal.capabilities,
                proposal.experience_refs,
            ),
            created_at,
            updated_at: proposal.now,
        };
        self.persist_identity(&identity)
    }
}
