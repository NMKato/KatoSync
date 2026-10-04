use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

pub(crate) const CONTEXT_PACK_SCHEMA_VERSION: &str = "katosync.context-pack/v1";
const SOURCE_POLICY: &str = "approved-scanned-context-v1";
const MAX_PROJECT_CHARS: usize = 120;
const MAX_GOAL_CHARS: usize = 600;
const MAX_ITEMS_PER_FIELD: usize = 20;
const MAX_ITEM_CHARS: usize = 600;
const MAX_ACTIVE_JOBS: usize = 12;
const MAX_EVIDENCE: usize = 24;
const MAX_SOURCES: usize = 64;
const MAX_SOURCE_CONTENT_CHARS: usize = 24_000;

#[derive(Debug, Clone)]
pub(crate) struct ContextSourceInput {
    pub relative_path: String,
    pub category: String,
    pub modified_at: String,
    pub size_bytes: u64,
    pub content: String,
    pub secret_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContextPack {
    schema_version: String,
    project: String,
    goal: String,
    current_state: Vec<String>,
    decisions: Vec<String>,
    active_jobs: Vec<ActiveJob>,
    blockers: Vec<String>,
    evidence: Vec<Evidence>,
    next_safe_steps: Vec<String>,
    learned_rules: Vec<String>,
    provenance: Provenance,
    generated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveJob {
    id: String,
    summary: String,
    owner: String,
    lease_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Evidence {
    summary: String,
    source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Provenance {
    generator: String,
    source_policy: String,
    sources: Vec<ProvenanceSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProvenanceSource {
    relative_path: String,
    category: String,
    modified_at: String,
    size_bytes: u64,
    content_truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Section {
    Goal,
    CurrentState,
    Decisions,
    ActiveJobs,
    Blockers,
    Evidence,
    NextSafeSteps,
    LearnedRules,
    Other,
}

impl ContextPack {
    /// Erzeugt den versionierten Pack ausschließlich aus bereits ausgewählten Context-Quellen.
    /// Secret-markierte Quellen führen bewusst zum Abbruch statt zu einem unvollständigen Pack.
    pub(crate) fn generate(
        project: &str,
        generated_at: &str,
        mut sources: Vec<ContextSourceInput>,
    ) -> Result<Self> {
        if sources.iter().any(|source| source.secret_detected) {
            return Err(anyhow!(
                "Context Pack nicht erzeugt: mindestens eine Status-, Roadmap- oder Memory-Quelle wurde wegen eines Secret-Musters ausgeschlossen"
            ));
        }
        if sources.len() > MAX_SOURCES {
            return Err(anyhow!(
                "Context Pack nicht erzeugt: {} Context-Quellen überschreiten das Limit von {MAX_SOURCES}",
                sources.len()
            ));
        }
        if sources
            .iter()
            .any(|source| !matches!(source.category.as_str(), "status" | "roadmap" | "memory"))
        {
            return Err(anyhow!(
                "Context Pack nicht erzeugt: nicht unterstützte Context-Kategorie"
            ));
        }

        sources.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

        let mut pack = Self {
            schema_version: CONTEXT_PACK_SCHEMA_VERSION.to_string(),
            project: bounded_text(project, MAX_PROJECT_CHARS),
            goal: String::new(),
            current_state: Vec::new(),
            decisions: Vec::new(),
            active_jobs: Vec::new(),
            blockers: Vec::new(),
            evidence: Vec::new(),
            next_safe_steps: Vec::new(),
            learned_rules: Vec::new(),
            provenance: Provenance {
                generator: "KatoSync".to_string(),
                source_policy: SOURCE_POLICY.to_string(),
                sources: Vec::new(),
            },
            generated_at: bounded_text(generated_at, 64),
        };

        for source in sources {
            let (content, content_truncated) =
                bounded_with_flag(&source.content, MAX_SOURCE_CONTENT_CHARS);
            pack.consume_source(&source.relative_path, &source.category, &content);
            pack.provenance.sources.push(ProvenanceSource {
                relative_path: bounded_text(&source.relative_path, 500),
                category: bounded_text(&source.category, 32),
                modified_at: bounded_text(&source.modified_at, 64),
                size_bytes: source.size_bytes,
                content_truncated,
            });
        }

        Ok(pack)
    }

    pub(crate) fn to_canonical_json(&self) -> Result<String> {
        let mut json = serde_json::to_string_pretty(self)?;
        json.push('\n');
        Ok(json)
    }

    /// Markdown ist ausschließlich eine Ansicht des kanonischen JSON-Datenmodells.
    pub(crate) fn to_markdown(&self) -> String {
        let mut text = String::new();
        text.push_str("---\n");
        text.push_str(&format!(
            "contextPackSchema: {}\n",
            yaml_scalar(&self.schema_version)
        ));
        text.push_str(&format!("project: {}\n", yaml_scalar(&self.project)));
        text.push_str(&format!(
            "generatedAt: {}\n",
            yaml_scalar(&self.generated_at)
        ));
        text.push_str("---\n\n");
        text.push_str(&format!("# Context Pack — {}\n\n", self.project));
        text.push_str("> Lokale Ansicht des kanonischen JSON Context Packs.\n\n");
        push_scalar_section(&mut text, "Goal", &self.goal);
        push_list_section(&mut text, "Current State", &self.current_state);
        push_list_section(&mut text, "Decisions", &self.decisions);
        text.push_str("## Active Jobs\n\n");
        if self.active_jobs.is_empty() {
            text.push_str("_None recorded._\n\n");
        } else {
            text.push_str("| ID | Summary | Owner | Lease expires |\n");
            text.push_str("|---|---|---|---|\n");
            for job in &self.active_jobs {
                text.push_str(&format!(
                    "| {} | {} | {} | {} |\n",
                    table_cell(&job.id),
                    table_cell(&job.summary),
                    table_cell(&job.owner),
                    table_cell(&job.lease_expires_at)
                ));
            }
            text.push('\n');
        }
        push_list_section(&mut text, "Blockers", &self.blockers);
        text.push_str("## Evidence\n\n");
        if self.evidence.is_empty() {
            text.push_str("_None recorded._\n\n");
        } else {
            for item in &self.evidence {
                text.push_str(&format!(
                    "- {} _(source: `{}`)_\n",
                    markdown_line(&item.summary),
                    markdown_code(&item.source)
                ));
            }
            text.push('\n');
        }
        push_list_section(&mut text, "Next Safe Steps", &self.next_safe_steps);
        push_list_section(&mut text, "Learned Rules", &self.learned_rules);
        text.push_str("## Provenance\n\n");
        text.push_str(&format!("- Generator: `{}`\n", self.provenance.generator));
        text.push_str(&format!(
            "- Source policy: `{}`\n\n",
            self.provenance.source_policy
        ));
        text.push_str("| Source | Category | Modified | Bytes | Truncated |\n");
        text.push_str("|---|---|---|---:|---|\n");
        for source in &self.provenance.sources {
            text.push_str(&format!(
                "| {} | {} | {} | {} | {} |\n",
                table_cell(&source.relative_path),
                table_cell(&source.category),
                table_cell(&source.modified_at),
                source.size_bytes,
                if source.content_truncated {
                    "yes"
                } else {
                    "no"
                }
            ));
        }
        text.push_str("\n(Created by NMKato Solutions)\n");
        text
    }

    fn consume_source(&mut self, relative_path: &str, category: &str, content: &str) {
        let mut section = Section::Other;
        for raw_line in content.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line == "---" || is_table_separator(line) {
                continue;
            }
            if let Some(heading) = line.strip_prefix('#') {
                section = classify_heading(heading.trim());
                continue;
            }
            let item = normalized_item(line);
            if item.is_empty() || looks_like_metadata(&item) {
                continue;
            }
            match section {
                Section::Goal => {
                    if self.goal.is_empty() {
                        self.goal = bounded_text(&item, MAX_GOAL_CHARS);
                    }
                }
                Section::CurrentState => push_unique(&mut self.current_state, &item),
                Section::Decisions => push_unique(&mut self.decisions, &item),
                Section::ActiveJobs => {
                    if let Some(job) = parse_active_job(&item) {
                        if self.active_jobs.len() < MAX_ACTIVE_JOBS
                            && !self
                                .active_jobs
                                .iter()
                                .any(|existing| existing.id == job.id)
                        {
                            self.active_jobs.push(job);
                        }
                    }
                }
                Section::Blockers => push_unique(&mut self.blockers, &item),
                Section::Evidence => push_evidence(&mut self.evidence, &item, relative_path),
                Section::NextSafeSteps => push_unique(&mut self.next_safe_steps, &item),
                Section::LearnedRules => push_unique(&mut self.learned_rules, &item),
                Section::Other => match category {
                    "status" => push_unique(&mut self.current_state, &item),
                    "roadmap" => push_unique(&mut self.next_safe_steps, &item),
                    "memory" => push_unique(&mut self.learned_rules, &item),
                    _ => {}
                },
            }
        }
    }
}

fn classify_heading(heading: &str) -> Section {
    let normalized = heading
        .trim_matches('#')
        .trim()
        .to_lowercase()
        .replace(['-', '_'], " ");
    if contains_any(
        &normalized,
        &[
            "next safe step",
            "nächster sicherer schritt",
            "naechster sicherer schritt",
            "next step",
            "nächste schritte",
            "naechste schritte",
        ],
    ) {
        Section::NextSafeSteps
    } else if contains_any(
        &normalized,
        &[
            "current state",
            "aktueller stand",
            "istzustand",
            "status",
            "stand",
            "progress",
        ],
    ) {
        Section::CurrentState
    } else if contains_any(&normalized, &["decision", "entscheidung", "beschluss"]) {
        Section::Decisions
    } else if contains_any(&normalized, &["active job", "aktive jobs", "laufende jobs"]) {
        Section::ActiveJobs
    } else if contains_any(&normalized, &["blocker", "hindernis", "blocked"]) {
        Section::Blockers
    } else if contains_any(
        &normalized,
        &["evidence", "nachweis", "beleg", "verifikation", "tests"],
    ) {
        Section::Evidence
    } else if contains_any(
        &normalized,
        &[
            "learned rule",
            "gelernte regel",
            "lernregel",
            "lessons learned",
        ],
    ) {
        Section::LearnedRules
    } else if contains_any(&normalized, &["goal", "ziel", "mission", "objective"]) {
        Section::Goal
    } else {
        Section::Other
    }
}

fn contains_any(value: &str, patterns: &[&str]) -> bool {
    patterns.iter().any(|pattern| value.contains(pattern))
}

fn normalized_item(line: &str) -> String {
    let mut item = line.trim();
    if item.starts_with('|') && item.ends_with('|') {
        return item.to_string();
    }
    if let Some(rest) = item.strip_prefix("- ").or_else(|| item.strip_prefix("* ")) {
        item = rest.trim();
    } else if let Some((prefix, rest)) = item.split_once(". ") {
        if prefix.chars().all(|ch| ch.is_ascii_digit()) {
            item = rest.trim();
        }
    }
    if let Some(rest) = item
        .strip_prefix("[ ] ")
        .or_else(|| item.strip_prefix("[x] "))
        .or_else(|| item.strip_prefix("[X] "))
    {
        item = rest.trim();
    }
    item.trim_matches('`').trim().to_string()
}

fn looks_like_metadata(item: &str) -> bool {
    let lower = item.to_lowercase();
    lower.starts_with("created by ")
        || lower.starts_with("zuletzt aktualisiert:")
        || lower.starts_with("last updated:")
}

fn is_table_separator(line: &str) -> bool {
    line.starts_with('|') && line.chars().all(|ch| matches!(ch, '|' | '-' | ':' | ' '))
}

fn parse_active_job(item: &str) -> Option<ActiveJob> {
    let mut id = None;
    let mut summary = None;
    let mut owner = None;
    let mut lease = None;
    for part in item.trim_matches('|').split([';', '|']) {
        let (key, value) = part.split_once('=')?;
        let value = value.trim();
        match key.trim().to_lowercase().as_str() {
            "id" | "job" | "jobid" => id = Some(value),
            "summary" | "title" | "titel" => summary = Some(value),
            "owner" => owner = Some(value),
            "lease" | "leaseexpiresat" | "lease_expires_at" => lease = Some(value),
            _ => {}
        }
    }
    let job = ActiveJob {
        id: bounded_text(id?, 120),
        summary: bounded_text(summary?, MAX_ITEM_CHARS),
        owner: bounded_text(owner?, 120),
        lease_expires_at: bounded_text(lease?, 64),
    };
    if job.id.is_empty()
        || job.summary.is_empty()
        || job.owner.is_empty()
        || job.lease_expires_at.is_empty()
    {
        None
    } else {
        Some(job)
    }
}

fn push_unique(items: &mut Vec<String>, value: &str) {
    if items.len() >= MAX_ITEMS_PER_FIELD {
        return;
    }
    let value = bounded_text(value, MAX_ITEM_CHARS);
    if !value.is_empty() && !items.iter().any(|existing| existing == &value) {
        items.push(value);
    }
}

fn push_evidence(items: &mut Vec<Evidence>, value: &str, source: &str) {
    if items.len() >= MAX_EVIDENCE {
        return;
    }
    let evidence = Evidence {
        summary: bounded_text(value, MAX_ITEM_CHARS),
        source: bounded_text(source, 500),
    };
    if !evidence.summary.is_empty() && !items.iter().any(|existing| existing == &evidence) {
        items.push(evidence);
    }
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    let clean = value.split_whitespace().collect::<Vec<_>>().join(" ");
    bounded_with_flag(&clean, max_chars).0
}

fn bounded_with_flag(value: &str, max_chars: usize) -> (String, bool) {
    let mut iter = value.chars();
    let bounded = iter.by_ref().take(max_chars).collect::<String>();
    let truncated = iter.next().is_some();
    (bounded, truncated)
}

fn push_scalar_section(text: &mut String, title: &str, value: &str) {
    text.push_str(&format!("## {title}\n\n"));
    if value.is_empty() {
        text.push_str("_Not recorded._\n\n");
    } else {
        text.push_str(&format!("{}\n\n", markdown_line(value)));
    }
}

fn push_list_section(text: &mut String, title: &str, items: &[String]) {
    text.push_str(&format!("## {title}\n\n"));
    if items.is_empty() {
        text.push_str("_None recorded._\n\n");
    } else {
        for item in items {
            text.push_str(&format!("- {}\n", markdown_line(item)));
        }
        text.push('\n');
    }
}

fn yaml_scalar(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn markdown_line(value: &str) -> String {
    value.replace(['\r', '\n'], " ")
}

fn markdown_code(value: &str) -> String {
    markdown_line(value).replace('`', "'")
}

fn table_cell(value: &str) -> String {
    markdown_line(value).replace('|', "\\|")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(path: &str, category: &str, content: &str) -> ContextSourceInput {
        ContextSourceInput {
            relative_path: path.to_string(),
            category: category.to_string(),
            modified_at: "2026-10-04 20:00".to_string(),
            size_bytes: content.len() as u64,
            content: content.to_string(),
            secret_detected: false,
        }
    }

    #[test]
    fn schema_and_serialization_are_deterministic() {
        let sources = vec![
            source(
                "roadmap.md",
                "roadmap",
                "# Goal\nShared handoff context\n# Next Safe Steps\n- Run checks",
            ),
            source(
                "status.md",
                "status",
                "# Current State\n- Core path selected\n# Decisions\n- JSON is canonical\n# Active Jobs\n- id=job-1; summary=Implement pack; owner=NMKato; lease=2026-10-05T08:00:00Z\n# Blockers\n- None\n# Evidence\n- Architecture reviewed",
            ),
        ];
        let pack = ContextPack::generate("KatoSync", "2026-10-04T20:00:00Z", sources).unwrap();

        let first = pack.to_canonical_json().unwrap();
        let second = pack.to_canonical_json().unwrap();
        assert_eq!(first, second);
        assert!(first.ends_with('\n'));
        let parsed: serde_json::Value = serde_json::from_str(&first).unwrap();
        assert_eq!(parsed["schemaVersion"], CONTEXT_PACK_SCHEMA_VERSION);
        assert_eq!(parsed["project"], "KatoSync");
        assert_eq!(parsed["activeJobs"][0]["owner"], "NMKato");
        assert_eq!(
            parsed["activeJobs"][0]["leaseExpiresAt"],
            "2026-10-05T08:00:00Z"
        );
        assert_eq!(parsed["generatedAt"], "2026-10-04T20:00:00Z");
        assert!(first.find("\"schemaVersion\"").unwrap() < first.find("\"project\"").unwrap());
        assert!(first.find("\"provenance\"").unwrap() < first.find("\"generatedAt\"").unwrap());
    }

    #[test]
    fn content_and_collections_are_bounded() {
        let long = "ä".repeat(MAX_ITEM_CHARS + 50);
        let lines = (0..(MAX_ITEMS_PER_FIELD + 5))
            .map(|index| format!("- {index}-{long}"))
            .collect::<Vec<_>>()
            .join("\n");
        let pack = ContextPack::generate(
            &"p".repeat(MAX_PROJECT_CHARS + 10),
            "2026-10-04T20:00:00Z",
            vec![source(
                "status.md",
                "status",
                &format!("# Current State\n{lines}"),
            )],
        )
        .unwrap();

        assert_eq!(pack.project.chars().count(), MAX_PROJECT_CHARS);
        assert_eq!(pack.current_state.len(), MAX_ITEMS_PER_FIELD);
        assert!(pack
            .current_state
            .iter()
            .all(|item| item.chars().count() <= MAX_ITEM_CHARS));
    }

    #[test]
    fn provenance_is_sorted_and_markdown_is_only_a_view() {
        let pack = ContextPack::generate(
            "KatoSync",
            "2026-10-04T20:00:00Z",
            vec![
                source(
                    "z/MEMORY.md",
                    "memory",
                    "# Learned Rules\n- Keep JSON canonical",
                ),
                source("a/status.md", "status", "# Evidence\n- cargo test passed"),
            ],
        )
        .unwrap();
        assert_eq!(pack.provenance.sources[0].relative_path, "a/status.md");
        assert_eq!(pack.provenance.sources[1].relative_path, "z/MEMORY.md");

        let round_trip: ContextPack =
            serde_json::from_str(&pack.to_canonical_json().unwrap()).unwrap();
        assert_eq!(round_trip, pack);
        let markdown = round_trip.to_markdown();
        assert!(markdown.contains("contextPackSchema: \"katosync.context-pack/v1\""));
        assert!(markdown.contains("cargo test passed _(source: `a/status.md`)_"));
        assert!(markdown.contains("Keep JSON canonical"));
    }

    #[test]
    fn secret_marked_context_source_fails_without_echoing_secret() {
        let secret = "OPENAI_API_KEY=sk-never-echo-this-value";
        let mut input = source("status-secret.md", "status", secret);
        input.secret_detected = true;
        let error = ContextPack::generate("KatoSync", "2026-10-04T20:00:00Z", vec![input])
            .unwrap_err()
            .to_string();

        assert!(error.contains("Secret-Musters ausgeschlossen"));
        assert!(!error.contains(secret));
        assert!(!error.contains("sk-never-echo-this-value"));
    }
}
