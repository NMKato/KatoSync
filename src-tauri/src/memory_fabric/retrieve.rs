// Created by NMKato Solutions
// Retrieval der Memory Fabric: projektgebundene FTS5-Suche, Stale-Erkennung gegen den Live-Stand und
// deterministisches Ranking (Relevanz + Wahrheitsstufe + Frische). `SemanticReranker` ist die Naht
// fuer spaetere Embedding-/Vektor-Reranker; v1 liefert nur lexikalische Scores (keine Abhaengigkeit).
use super::{
    store::{Candidate, MemoryStore},
    validate_project_id, EvidenceRef, Freshness, LiveState, TruthLevel,
    MEMORY_FABRIC_SCHEMA_VERSION,
};
use serde::Serialize;
use std::{cmp::Ordering, collections::BTreeMap};

pub(super) const DEFAULT_LIMIT: usize = 8;
pub(super) const MAX_LIMIT: usize = 20;
const MAX_QUERY_CHARS: usize = 512;
const MAX_QUERY_TERMS: usize = 16;
const CANDIDATE_FACTOR: usize = 5;
const MAX_CANDIDATES: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MemoryQuery {
    pub project_id: String,
    pub text: String,
    pub limit: usize,
    pub min_truth: TruthLevel,
}

impl MemoryQuery {
    pub(crate) fn new(project_id: &str, text: &str, limit: Option<usize>) -> Self {
        Self {
            project_id: project_id.to_string(),
            text: text.to_string(),
            limit: limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT),
            min_truth: TruthLevel::Observed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryHit {
    pub chunk_id: String,
    /// Projektrelativer, providerneutraler Verweis: `<relativer Pfad>#<Chunk-Ordinal>`.
    pub source_ref: String,
    pub relative_path: String,
    pub kind: String,
    pub heading: String,
    pub summary: String,
    pub text: String,
    pub truth_level: TruthLevel,
    pub evidence: Vec<EvidenceRef>,
    pub content_hash: String,
    pub indexed_head: Option<String>,
    pub indexed_at: String,
    pub freshness: Freshness,
    pub stale_reasons: Vec<String>,
    pub score: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryQueryResult {
    pub schema_version: String,
    pub project_id: String,
    /// Bereinigte Suchbegriffe (keine FTS-Syntax des Aufrufers wird ausgefuehrt).
    pub terms: Vec<String>,
    pub live_head: Option<String>,
    pub reranker: String,
    pub candidate_count: usize,
    pub truncated: bool,
    pub hits: Vec<MemoryHit>,
}

/// Naht fuer spaetere semantische Reranker (Embeddings/Vektoren). Liefert je Treffer einen Score in
/// [0, 1] oder None (= keine Meinung). Implementierungen duerfen keine Netzwerk-/Cloud-Aufrufe machen,
/// solange die Local-Brain-Policy das nicht explizit erlaubt.
pub(crate) trait SemanticReranker {
    fn id(&self) -> &'static str;
    fn scores(&self, query: &str, hits: &[MemoryHit]) -> Vec<Option<f64>>;
}

/// Standard v1: rein lexikalisch (FTS5/bm25).
pub(crate) struct LexicalOnly;

impl SemanticReranker for LexicalOnly {
    fn id(&self) -> &'static str {
        "fts5-bm25"
    }

    fn scores(&self, _query: &str, hits: &[MemoryHit]) -> Vec<Option<f64>> {
        vec![None; hits.len()]
    }
}

/// Zerlegt Freitext in begrenzte, deduplizierte Suchbegriffe (nur Buchstaben/Ziffern).
pub(super) fn query_terms(text: &str) -> Vec<String> {
    let bounded: String = text.chars().take(MAX_QUERY_CHARS).collect();
    let mut terms: Vec<String> = Vec::new();
    for raw in bounded.split(|ch: char| !ch.is_alphanumeric()) {
        let term = raw.to_lowercase();
        if term.chars().count() >= 2 && !terms.contains(&term) {
            terms.push(term);
            if terms.len() >= MAX_QUERY_TERMS {
                break;
            }
        }
    }
    terms
}

/// FTS5-Ausdruck: jeder Begriff als gequotetes Praefix, ODER-verknuepft (Recall vor Praezision;
/// das Ranking uebernimmt bm25). Begriffe enthalten nur alphanumerische Zeichen.
fn match_expression(terms: &[String]) -> String {
    terms
        .iter()
        .map(|term| format!("\"{term}\"*"))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub(super) fn freshness_of(
    relative_path: &str,
    content_hash: &str,
    indexed_head: Option<&str>,
    live: Option<&LiveState>,
) -> (Freshness, Vec<String>) {
    let Some(live) = live else {
        return (Freshness::Unknown, vec!["no_live_state".to_string()]);
    };
    match live.content_hashes.get(relative_path) {
        None => (Freshness::Stale, vec!["source_missing".to_string()]),
        Some(hash) if hash != content_hash => {
            (Freshness::Stale, vec!["content_changed".to_string()])
        }
        Some(_) if indexed_head != live.head_sha.as_deref() => {
            (Freshness::HeadMoved, vec!["head_moved".to_string()])
        }
        Some(_) => (Freshness::Fresh, Vec::new()),
    }
}

fn truth_bonus(level: TruthLevel) -> f64 {
    match level {
        TruthLevel::Canonical => 0.30,
        TruthLevel::Verified => 0.15,
        TruthLevel::Observed => 0.0,
    }
}

fn freshness_adjustment(freshness: Freshness) -> f64 {
    match freshness {
        Freshness::Fresh => 0.0,
        Freshness::HeadMoved => -0.05,
        Freshness::Unknown => -0.10,
        Freshness::Stale => -1.0,
    }
}

/// Deterministische Reihenfolge: Score, dann Wahrheitsstufe, dann Pfad und Ordinal.
fn compare_hits(left: &MemoryHit, right: &MemoryHit) -> Ordering {
    right
        .score
        .partial_cmp(&left.score)
        .unwrap_or(Ordering::Equal)
        .then_with(|| right.truth_level.cmp(&left.truth_level))
        .then_with(|| left.relative_path.cmp(&right.relative_path))
        .then_with(|| left.source_ref.cmp(&right.source_ref))
}

impl MemoryStore {
    pub(crate) fn query(
        &self,
        query: &MemoryQuery,
        live: Option<&LiveState>,
        reranker: &dyn SemanticReranker,
    ) -> Result<MemoryQueryResult, String> {
        let project_id = validate_project_id(&query.project_id)?;
        let limit = query.limit.clamp(1, MAX_LIMIT);
        let terms = query_terms(&query.text);
        let mut result = MemoryQueryResult {
            schema_version: MEMORY_FABRIC_SCHEMA_VERSION.to_string(),
            project_id: project_id.to_string(),
            terms: terms.clone(),
            live_head: live.and_then(|state| state.head_sha.clone()),
            reranker: reranker.id().to_string(),
            candidate_count: 0,
            truncated: false,
            hits: Vec::new(),
        };
        if terms.is_empty() {
            return Ok(result);
        }

        let pool = (limit * CANDIDATE_FACTOR).min(MAX_CANDIDATES);
        let candidates =
            self.search_candidates(project_id, &match_expression(&terms), query.min_truth, pool)?;
        result.candidate_count = candidates.len();
        let best = candidates
            .iter()
            .map(|candidate| -candidate.bm25)
            .fold(0.0_f64, f64::max);

        let mut evidence_cache: BTreeMap<String, Vec<EvidenceRef>> = BTreeMap::new();
        let mut lexical = Vec::with_capacity(candidates.len());
        let mut hits = Vec::with_capacity(candidates.len());
        for candidate in candidates {
            if !evidence_cache.contains_key(&candidate.source_id) {
                let evidence = self.evidence_for(project_id, &candidate.source_id)?;
                evidence_cache.insert(candidate.source_id.clone(), evidence);
            }
            lexical.push(if best > 0.0 {
                (-candidate.bm25 / best).clamp(0.0, 1.0)
            } else {
                0.0
            });
            let evidence = evidence_cache[&candidate.source_id].clone();
            hits.push(hit_from(candidate, evidence, live));
        }

        let semantic = reranker.scores(&query.text, &hits);
        for (index, hit) in hits.iter_mut().enumerate() {
            let relevance = match semantic.get(index).copied().flatten() {
                Some(score) => 0.5 * lexical[index] + 0.5 * score.clamp(0.0, 1.0),
                None => lexical[index],
            };
            let score =
                relevance + truth_bonus(hit.truth_level) + freshness_adjustment(hit.freshness);
            hit.score = (score * 1_000_000.0).round() / 1_000_000.0;
        }
        hits.sort_by(compare_hits);
        result.truncated = hits.len() > limit;
        hits.truncate(limit);
        result.hits = hits;
        Ok(result)
    }
}

fn hit_from(
    candidate: Candidate,
    evidence: Vec<EvidenceRef>,
    live: Option<&LiveState>,
) -> MemoryHit {
    let (freshness, stale_reasons) = freshness_of(
        &candidate.relative_path,
        &candidate.content_hash,
        candidate.git_head.as_deref(),
        live,
    );
    MemoryHit {
        source_ref: format!("{}#{}", candidate.relative_path, candidate.ordinal),
        chunk_id: candidate.chunk_id,
        relative_path: candidate.relative_path,
        kind: candidate.kind,
        heading: candidate.heading,
        summary: candidate.summary,
        text: candidate.body,
        truth_level: candidate.truth,
        evidence,
        content_hash: candidate.content_hash,
        indexed_head: candidate.git_head,
        indexed_at: candidate.indexed_at,
        freshness,
        stale_reasons,
        score: 0.0,
    }
}
