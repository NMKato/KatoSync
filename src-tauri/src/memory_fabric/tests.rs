// Created by NMKato Solutions
use super::{
    assemble::{assemble_rag_block, RagOptions, MAX_MAX_CHARS, MIN_MAX_CHARS},
    ingest::{
        chunk_markdown, collect_project_sources, normalize_remote, parse_porcelain_z,
        probe_live_state, redact_for_memory, root_fingerprint, sha256_hex, MemorySource,
        MAX_CHUNK_CHARS,
    },
    projection::{export_projection, is_pristine_projection, project_markdown, ProjectionTarget},
    retrieve::{query_terms, LexicalOnly, MemoryQuery, MAX_LIMIT},
    DirectoryTarget, Freshness, IngestBatch, LiveState, MemoryFabricOverview, MemoryStore,
    NameOrigin, NamedIdentityProposal, NodeIdentityKind, ProjectIdentity, Promotion, TruthLevel,
    PROJECTION_MARKER, REX_MAIN_NAME,
};
use crate::context_pack::ContextSourceInput;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const HEAD: &str = "1111111111111111111111111111111111111111";
const NEXT_HEAD: &str = "2222222222222222222222222222222222222222";

fn identity(project_id: &str) -> ProjectIdentity {
    ProjectIdentity {
        project_id: project_id.to_string(),
        name: format!("Fixture {project_id}"),
        repo_identity: None,
        root_fingerprint: root_fingerprint(&format!("/fixture/{project_id}")),
    }
}

fn source(path: &str, kind: &str, content: &str, git_clean: bool) -> MemorySource {
    MemorySource {
        relative_path: path.to_string(),
        kind: kind.to_string(),
        content: content.to_string(),
        modified_at: Some("2026-10-06T08:00:00Z".to_string()),
        size_bytes: content.len() as u64,
        content_truncated: false,
        excluded: None,
        git_clean,
    }
}

fn batch(project_id: &str, head: Option<&str>, sources: Vec<MemorySource>) -> IngestBatch {
    IngestBatch {
        identity: identity(project_id),
        git_head: head.map(str::to_string),
        git_branch: Some("main".to_string()),
        indexed_at: "2026-10-06T08:00:00Z".to_string(),
        sources,
    }
}

fn live(head: &str, sources: &[(&str, &str)]) -> LiveState {
    LiveState {
        head_sha: Some(head.to_string()),
        content_hashes: sources
            .iter()
            .map(|(path, content)| (path.to_string(), sha256_hex(content)))
            .collect(),
    }
}

fn promote(store: &mut MemoryStore, project_id: &str, path: &str, content: &str) {
    store
        .promote(&Promotion {
            project_id: project_id.to_string(),
            relative_path: path.to_string(),
            expected_content_hash: sha256_hex(content),
            evidence_ref: "owner decision 2026-10-06".to_string(),
            approved_by: "NMKato".to_string(),
            approved_at: "2026-10-06T09:00:00Z".to_string(),
        })
        .unwrap();
}

fn query(
    store: &MemoryStore,
    project_id: &str,
    text: &str,
    live: Option<&LiveState>,
) -> super::MemoryQueryResult {
    store
        .query(
            &MemoryQuery::new(project_id, text, None),
            live,
            &LexicalOnly,
        )
        .unwrap()
}

#[derive(Default)]
struct MemoryTarget {
    files: BTreeMap<String, String>,
}

impl ProjectionTarget for MemoryTarget {
    fn read(&self, name: &str) -> Option<String> {
        self.files.get(name).cloned()
    }
    fn exists(&self, name: &str) -> bool {
        self.files.contains_key(name)
    }
    fn write(&mut self, name: &str, content: &str) -> Result<(), String> {
        self.files.insert(name.to_string(), content.to_string());
        Ok(())
    }
    fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        let content = self.files.remove(from).ok_or("missing")?;
        self.files.insert(to.to_string(), content);
        Ok(())
    }
}

fn temp_dir(label: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("katosync-memory-{label}-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
        ])
        .args(["-c", "commit.gpgsign=false"])
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed");
}

#[test]
fn schema_uses_fts5_and_survives_reopen() {
    let dir = temp_dir("schema");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store
            .ingest(batch(
                "alpha",
                Some(HEAD),
                vec![source(
                    "STATUS.md",
                    "status",
                    "# Status\nLocal brain retrieval works",
                    true,
                )],
            ))
            .unwrap();
    }
    let store = MemoryStore::open(&path).unwrap();
    let result = query(&store, "alpha", "retrieval", None);
    assert_eq!(result.hits.len(), 1);
    assert_eq!(result.hits[0].truth_level, TruthLevel::Verified);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn project_scoping_isolates_queries_snapshots_and_promotions() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let shared = "# Decisions\nThe orchestrator lease guards worktree ownership.";
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source("MEMORY.md", "memory", shared, true)],
        ))
        .unwrap();
    store
        .ingest(batch(
            "beta",
            Some(HEAD),
            vec![
                source("MEMORY.md", "memory", shared, true),
                source(
                    "STATUS.md",
                    "status",
                    "# Status\nBeta-only lease migration",
                    true,
                ),
            ],
        ))
        .unwrap();

    let alpha = query(&store, "alpha", "lease", None);
    assert_eq!(alpha.hits.len(), 1);
    assert!(alpha
        .hits
        .iter()
        .all(|hit| hit.relative_path == "MEMORY.md"));
    let beta = query(&store, "beta", "lease", None);
    assert_eq!(beta.hits.len(), 2);
    assert!(alpha
        .hits
        .iter()
        .all(|hit| beta.hits.iter().all(|other| other.chunk_id != hit.chunk_id)));
    assert!(query(&store, "gamma", "lease", None).hits.is_empty());

    promote(&mut store, "alpha", "MEMORY.md", shared);
    assert_eq!(
        query(&store, "alpha", "lease", None).hits[0].truth_level,
        TruthLevel::Canonical
    );
    let beta_memory = query(&store, "beta", "orchestrator", None);
    assert_eq!(beta_memory.hits[0].truth_level, TruthLevel::Verified);

    let alpha_snapshot = store.snapshot("alpha").unwrap();
    assert_eq!(alpha_snapshot.sources.len(), 1);
    assert_eq!(store.snapshot("beta").unwrap().sources.len(), 2);

    // Eine Projekt-ID darf nicht still auf ein anderes Repository umgebogen werden.
    let mut foreign = batch(
        "alpha",
        Some(HEAD),
        vec![source("X.md", "memory", "# X\nforeign", true)],
    );
    foreign.identity.root_fingerprint = root_fingerprint("/elsewhere/other-repo");
    assert!(store
        .ingest(foreign)
        .unwrap_err()
        .contains("anderen Repository"));
    assert_eq!(store.snapshot("alpha").unwrap(), alpha_snapshot);

    // Ungueltige IDs (z. B. Pfade oder SQL-Fragmente) werden abgelehnt.
    assert!(store
        .query(
            &MemoryQuery::new("../alpha", "lease", None),
            None,
            &LexicalOnly
        )
        .is_err());
    assert!(store.snapshot("alpha' OR 1=1 --").is_err());
}

#[test]
fn secrets_excluded_paths_and_machine_paths_never_reach_the_store() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let mut named_secret = source(
        "docs/MEMORY_credentials.md",
        "memory",
        "# M\nharmless",
        true,
    );
    named_secret.excluded = Some("secret_name".to_string());
    let report = store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![
                source(".env", "memory", "PLAIN=1", true),
                source(
                    "node_modules/pkg/MEMORY.md",
                    "memory",
                    "# M\nvendored",
                    true,
                ),
                source(
                    "/Users/alice/Projects/app/STATUS.md",
                    "status",
                    "# S\nabs",
                    true,
                ),
                source("../outside/MEMORY.md", "memory", "# M\nescape", true),
                source(
                    "MEMORY.md",
                    "memory",
                    "# M\nOPENAI_API_KEY=sk-never-store-this-value-123456",
                    true,
                ),
                named_secret,
                source("tool.md", "script", "# T\nnot an approved kind", true),
                source(
                    "AGENTS.md",
                    "agents",
                    "# Rules\nRepo lives at /Users/alice/Projects/app and C:\\Users\\bob\\work.\n\
                     Temp output in /var/folders/xy/T/run-1 and /Volumes/Backup/app.\n\
                     Remote https://alice:ghp_tokenvalue@github.com/acme/app.git is canonical.",
                    true,
                ),
            ],
        ))
        .unwrap();

    assert_eq!(report.indexed_sources, 1);
    let reasons: BTreeMap<_, _> = report
        .skipped
        .iter()
        .map(|item| (item.relative_path.clone(), item.reason.clone()))
        .collect();
    assert_eq!(reasons[".env"], "excluded_path");
    assert_eq!(reasons["node_modules/pkg/MEMORY.md"], "excluded_path");
    assert_eq!(reasons["~/Projects/app/STATUS.md"], "excluded_path");
    assert_eq!(reasons["../outside/MEMORY.md"], "excluded_path");
    assert_eq!(reasons["MEMORY.md"], "secret_pattern");
    assert_eq!(reasons["docs/MEMORY_credentials.md"], "secret_name");
    assert_eq!(reasons["tool.md"], "unsupported_kind");

    let snapshot = serde_json::to_string(&store.snapshot("alpha").unwrap()).unwrap();
    let report_json = serde_json::to_string(&report).unwrap();
    for leaked in [
        "sk-never-store",
        "/Users/alice",
        "C:\\\\Users\\\\bob",
        "bob",
        "/var/folders",
        "/Volumes/Backup",
        "ghp_tokenvalue",
        "alice:",
    ] {
        assert!(!snapshot.contains(leaked), "snapshot leaked {leaked}");
        assert!(!report_json.contains(leaked), "report leaked {leaked}");
    }
    assert!(snapshot.contains("~/Projects/app"));
    assert!(snapshot.contains("https://github.com/acme/app.git"));

    let block = assemble_rag_block(
        &query(&store, "alpha", "repo remote temp", Some(&live(HEAD, &[("AGENTS.md", "# Rules\nRepo lives at /Users/alice/Projects/app and C:\\Users\\bob\\work.\nTemp output in /var/folders/xy/T/run-1 and /Volumes/Backup/app.\nRemote https://alice:ghp_tokenvalue@github.com/acme/app.git is canonical.")]))),
        &RagOptions::default(),
    );
    assert_eq!(block.citations.len(), 1);
    assert!(!block.text.contains("/Users/") && !block.text.contains("ghp_"));
}

#[test]
fn redaction_is_idempotent_and_keeps_urls_intact() {
    let text = "See https://example.com/home/page and file:///Users/carol/notes.md (~ ok)";
    let once = redact_for_memory(text);
    assert_eq!(once, redact_for_memory(&once));
    assert!(once.contains("https://example.com/home/page"));
    assert!(once.contains("file://~/notes.md"));
    assert!(!once.contains("carol"));
}

#[test]
fn ranking_prefers_canonical_then_verified_then_observed_on_ties() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let content = "# Guardrail\nNever merge feature branches during the stability window.";
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![
                source("a-observed/MEMORY.md", "memory", content, false),
                source("b-verified/MEMORY.md", "memory", content, true),
                source("c-canonical/MEMORY.md", "memory", content, true),
                source("d-verified/MEMORY.md", "memory", content, true),
            ],
        ))
        .unwrap();
    promote(&mut store, "alpha", "c-canonical/MEMORY.md", content);

    let result = query(&store, "alpha", "merge stability window", None);
    let order: Vec<_> = result
        .hits
        .iter()
        .map(|hit| (hit.relative_path.as_str(), hit.truth_level))
        .collect();
    assert_eq!(
        order,
        vec![
            ("c-canonical/MEMORY.md", TruthLevel::Canonical),
            ("b-verified/MEMORY.md", TruthLevel::Verified),
            ("d-verified/MEMORY.md", TruthLevel::Verified),
            ("a-observed/MEMORY.md", TruthLevel::Observed),
        ]
    );
    assert!(result.hits[0].score > result.hits[1].score);
    assert_eq!(result.hits[1].score, result.hits[2].score);
    assert!(result.hits[2].score > result.hits[3].score);
    assert!(result.hits[0]
        .evidence
        .iter()
        .any(|evidence| evidence.kind == "human" && evidence.truth_level == TruthLevel::Canonical));
    assert!(result.hits[3]
        .evidence
        .iter()
        .all(|evidence| evidence.truth_level == TruthLevel::Observed));

    // Deterministisch: identische Abfrage -> identische Reihenfolge und Scores.
    assert_eq!(
        query(&store, "alpha", "merge stability window", None),
        result
    );

    // Relevanz bleibt wirksam: ein deutlich passenderer verified-Treffer schlaegt einen schwachen canonical.
    let strong =
        "# Local Brain\nLocal brain runtime uses local brain retrieval for local brain answers.";
    let weak =
        "# Misc\nUnrelated notes mention local once among many other words about deployment.";
    store
        .ingest(batch(
            "beta",
            Some(HEAD),
            vec![
                source("STRONG.md", "memory", strong, true),
                source("WEAK.md", "memory", weak, true),
            ],
        ))
        .unwrap();
    promote(&mut store, "beta", "WEAK.md", weak);
    let beta = query(&store, "beta", "local brain retrieval", None);
    assert_eq!(beta.hits[0].relative_path, "STRONG.md");
}

#[test]
fn stale_git_and_content_hash_are_surfaced_and_filtered_from_context() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let status = "# Status\nWave K5 stability baseline is green.";
    let roadmap = "# Roadmap\nNext wave K5 adds hybrid retrieval.";
    let memory = "# Memory\nK5 owner rule: no merge without gate.";
    let notes = "# Notes\nK5 draft idea, uncommitted.";
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![
                source("STATUS.md", "status", status, true),
                source("ROADMAP.md", "roadmap", roadmap, true),
                source("MEMORY.md", "memory", memory, true),
                source("docs/HANDOFF.md", "handoff", notes, false),
            ],
        ))
        .unwrap();

    let unknown = query(&store, "alpha", "k5", None);
    assert!(unknown
        .hits
        .iter()
        .all(|hit| hit.freshness == Freshness::Unknown));

    let fresh = query(
        &store,
        "alpha",
        "k5",
        Some(&live(
            HEAD,
            &[
                ("STATUS.md", status),
                ("ROADMAP.md", roadmap),
                ("MEMORY.md", memory),
                ("docs/HANDOFF.md", notes),
            ],
        )),
    );
    assert!(fresh
        .hits
        .iter()
        .all(|hit| hit.freshness == Freshness::Fresh));

    // HEAD bewegt, STATUS geaendert, MEMORY entfernt/ausgeschlossen.
    let moved = live(
        NEXT_HEAD,
        &[
            ("STATUS.md", "# Status\nWave K5 is red now."),
            ("ROADMAP.md", roadmap),
            ("docs/HANDOFF.md", notes),
        ],
    );
    let result = query(&store, "alpha", "k5", Some(&moved));
    let by_path: BTreeMap<_, _> = result
        .hits
        .iter()
        .map(|hit| {
            (
                hit.relative_path.as_str(),
                (hit.freshness, hit.stale_reasons.clone()),
            )
        })
        .collect();
    assert_eq!(
        by_path["STATUS.md"],
        (Freshness::Stale, vec!["content_changed".to_string()])
    );
    assert_eq!(
        by_path["MEMORY.md"],
        (Freshness::Stale, vec!["source_missing".to_string()])
    );
    assert_eq!(
        by_path["ROADMAP.md"],
        (Freshness::HeadMoved, vec!["head_moved".to_string()])
    );
    assert_eq!(result.live_head.as_deref(), Some(NEXT_HEAD));
    assert_eq!(result.hits[0].indexed_head.as_deref(), Some(HEAD));
    // Stale-Treffer landen hinter allen belastbaren Treffern.
    let first_stale = result
        .hits
        .iter()
        .position(|hit| hit.freshness == Freshness::Stale)
        .unwrap();
    assert!(result.hits[first_stale..]
        .iter()
        .all(|hit| hit.freshness == Freshness::Stale));

    let block = assemble_rag_block(&result, &RagOptions::default());
    assert_eq!(block.citations.len(), 1);
    assert_eq!(block.citations[0].source_ref, "ROADMAP.md#0");
    assert_eq!(block.citations[0].freshness, Freshness::HeadMoved);
    assert!(block
        .text
        .contains("[1] verified | head_moved | ROADMAP.md#0"));
    assert_eq!(block.omitted.stale, 2);
    assert_eq!(block.omitted.below_truth, 1); // uncommitted HANDOFF = observed
    assert!(!block.text.contains("red now") && !block.text.contains("uncommitted"));

    let strict = assemble_rag_block(
        &result,
        &RagOptions {
            allow_head_moved: false,
            ..RagOptions::default()
        },
    );
    assert!(strict.citations.is_empty());
    assert_eq!(strict.omitted.head_moved, 1);
    assert!(strict.text.contains("No verified project memory matched"));

    let no_live = assemble_rag_block(&unknown, &RagOptions::default());
    assert!(no_live.citations.is_empty());
    assert_eq!(no_live.omitted.unknown_freshness, 3);
}

#[test]
fn retrieval_and_context_are_bounded() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let mut sources = Vec::new();
    let mut live_sources = Vec::new();
    let long_paragraph = format!("Bounded retrieval keyword {}", "word ".repeat(400));
    for index in 0..30 {
        let content =
            format!("# Section {index}\n{long_paragraph}\n\n## Detail\nkeyword detail {index}");
        live_sources.push((format!("docs/adr/{index:02}.md"), content.clone()));
        sources.push(source(
            &format!("docs/adr/{index:02}.md"),
            "adr",
            &content,
            true,
        ));
    }
    store.ingest(batch("alpha", Some(HEAD), sources)).unwrap();
    let live_refs: Vec<(&str, &str)> = live_sources
        .iter()
        .map(|(p, c)| (p.as_str(), c.as_str()))
        .collect();
    let state = live(HEAD, &live_refs);

    let result = store
        .query(
            &MemoryQuery::new("alpha", "keyword", Some(500)),
            Some(&state),
            &LexicalOnly,
        )
        .unwrap();
    assert_eq!(result.hits.len(), MAX_LIMIT);
    assert!(result.truncated);
    assert!(result
        .hits
        .iter()
        .all(|hit| hit.text.chars().count() <= MAX_CHUNK_CHARS));

    for max_chars in [0, 100, 700, 2_000, 6_000, 50_000] {
        let block = assemble_rag_block(
            &result,
            &RagOptions {
                max_chars,
                ..RagOptions::default()
            },
        );
        let expected = max_chars.clamp(MIN_MAX_CHARS, MAX_MAX_CHARS);
        assert_eq!(block.max_chars, expected);
        assert!(
            block.char_count <= expected,
            "{} > {expected}",
            block.char_count
        );
        assert_eq!(block.char_count, block.text.chars().count());
        assert_eq!(block.citations.len() + block.omitted.over_budget, MAX_LIMIT);
        assert!(block.text.ends_with("</katosync-memory>\n"));
    }

    let many_terms = (0..100)
        .map(|n| format!("term{n}"))
        .collect::<Vec<_>>()
        .join(" ");
    assert_eq!(query_terms(&many_terms).len(), 16);
    assert!(query_terms("a ! ?").is_empty());
    // FTS-Syntax des Aufrufers wird nie ausgefuehrt.
    for hostile in [
        "\"keyword\" OR NEAR(",
        "keyword* AND -x",
        "col:keyword",
        "') DROP TABLE chunks; --",
    ] {
        assert!(store
            .query(
                &MemoryQuery::new("alpha", hostile, None),
                None,
                &LexicalOnly
            )
            .is_ok());
    }
    assert_eq!(query(&store, "alpha", "keyword", None).hits.len(), 8);
}

#[test]
fn chunking_follows_headings_skips_fences_and_front_matter() {
    let content = "---\ntitle: x\n---\n# Top\nIntro text\n\n## Child\n```\n# not a heading\n```\nChild text\n### Deep\nDeep text\n## Sibling\n(Created by NMKato Solutions)\nSibling text\n";
    let chunks = chunk_markdown(content);
    let headings: Vec<_> = chunks.iter().map(|chunk| chunk.heading.as_str()).collect();
    assert_eq!(
        headings,
        vec!["Top", "Top › Child", "Top › Child › Deep", "Top › Sibling"]
    );
    assert!(chunks[1].body.contains("# not a heading"));
    assert!(!chunks.iter().any(|chunk| chunk.body.contains("title: x")));
    assert!(!chunks.iter().any(|chunk| chunk.body.contains("Created by")));
    assert_eq!(chunks[3].summary, "Sibling text");

    let huge = format!("# Big\n{}", "x".repeat(MAX_CHUNK_CHARS * 3 + 7));
    let pieces = chunk_markdown(&huge);
    assert_eq!(pieces.len(), 4);
    assert!(pieces
        .iter()
        .all(|chunk| chunk.body.chars().count() <= MAX_CHUNK_CHARS));
    let many = (0..200)
        .map(|n| format!("# H{n}\nbody {n}"))
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(chunk_markdown(&many).len(), 64);
}

#[test]
fn promotion_is_bound_to_reviewed_content_hash() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let original = "# Decisions\nSQLite is the technical truth.";
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source("MEMORY.md", "memory", original, true)],
        ))
        .unwrap();
    let wrong = Promotion {
        project_id: "alpha".to_string(),
        relative_path: "MEMORY.md".to_string(),
        expected_content_hash: sha256_hex("something else"),
        evidence_ref: "review".to_string(),
        approved_by: "NMKato".to_string(),
        approved_at: "2026-10-06T09:00:00Z".to_string(),
    };
    assert!(store.promote(&wrong).unwrap_err().contains("geändert"));
    let missing = Promotion {
        relative_path: "NOPE.md".to_string(),
        ..wrong.clone()
    };
    assert!(store.promote(&missing).is_err());
    let anonymous = Promotion {
        expected_content_hash: sha256_hex(original),
        approved_by: " ".to_string(),
        ..wrong
    };
    assert!(store.promote(&anonymous).is_err());

    promote(&mut store, "alpha", "MEMORY.md", original);
    // Re-Index mit gleichem Inhalt behaelt canonical (Freigabe haengt am Hash, nicht am Indexlauf).
    store
        .ingest(batch(
            "alpha",
            Some(NEXT_HEAD),
            vec![source("MEMORY.md", "memory", original, true)],
        ))
        .unwrap();
    assert_eq!(
        store.snapshot("alpha").unwrap().sources[0].truth_level,
        TruthLevel::Canonical
    );
    // Geaenderter Inhalt faellt auf Git-Evidenz zurueck.
    store
        .ingest(batch(
            "alpha",
            Some(NEXT_HEAD),
            vec![source("MEMORY.md", "memory", "# Decisions\nChanged.", true)],
        ))
        .unwrap();
    assert_eq!(
        store.snapshot("alpha").unwrap().sources[0].truth_level,
        TruthLevel::Verified
    );
}

#[test]
fn markdown_projection_cannot_overwrite_canonical_truth() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let content = "# Guardrails\nNo production deploys from foundation branches.";
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source("AGENTS.md", "agents", content, true)],
        ))
        .unwrap();
    let before = store.snapshot("alpha").unwrap();

    let mut target = MemoryTarget::default();
    let first = export_projection(&before, &mut target).unwrap();
    assert_eq!(
        first.written,
        vec!["AGENTS.md".to_string(), "_index.md".to_string()]
    );
    let projected = target.files["AGENTS.md"].clone();
    assert!(projected.starts_with(&format!("---\n{PROJECTION_MARKER}\n")));
    assert!(projected.contains("truthLevel: \"verified\""));
    assert!(is_pristine_projection(&projected));
    assert_eq!(project_markdown(&before), project_markdown(&before));

    // Unveraenderter Re-Export schreibt nichts.
    let second = export_projection(&before, &mut target).unwrap();
    assert!(second.written.is_empty());
    assert_eq!(second.unchanged.len(), 2);

    // Ein Mensch "befoerdert" die Projektion und aendert die Regel im Markdown.
    let edited = projected
        .replace("truthLevel: \"verified\"", "truthLevel: \"canonical\"")
        .replace("No production deploys", "Production deploys are fine");
    target.files.insert("AGENTS.md".to_string(), edited.clone());
    assert!(!is_pristine_projection(&edited));

    // Die Projektion fliesst nie als Quelle zurueck – selbst wenn sie in einem erlaubten Pfad landet.
    let report = store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![
                source("AGENTS.md", "agents", content, true),
                source("docs/MEMORY_PROJECTION.md", "memory", &edited, true),
            ],
        ))
        .unwrap();
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.skipped[0].reason, "memory_projection");
    let after = store.snapshot("alpha").unwrap();
    assert_eq!(after, before);
    assert_eq!(after.sources[0].truth_level, TruthLevel::Verified);
    let answer = query(&store, "alpha", "production deploys", None);
    assert!(answer
        .hits
        .iter()
        .all(|hit| hit.text.contains("No production deploys")));

    // Re-Export stellt die gespeicherte Wahrheit wieder her und legt die Bearbeitung beiseite.
    let third = export_projection(&after, &mut target).unwrap();
    assert_eq!(
        third.preserved_edits,
        vec!["AGENTS.user-edit-1.md".to_string()]
    );
    assert_eq!(target.files["AGENTS.md"], projected);
    assert_eq!(target.files["AGENTS.user-edit-1.md"], edited);
}

#[test]
fn directory_target_is_configurable_and_contained() {
    let base = temp_dir("export");
    let mut store = MemoryStore::open_in_memory().unwrap();
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source("docs/STATUS.md", "status", "# Status\nGreen", true)],
        ))
        .unwrap();
    let snapshot = store.snapshot("alpha").unwrap();
    let mut target = DirectoryTarget::new(&base, "alpha").unwrap();
    let report = export_projection(&snapshot, &mut target).unwrap();
    assert_eq!(
        report.written,
        vec!["docs__STATUS.md".to_string(), "_index.md".to_string()]
    );
    let dir = base.join("katosync-memory").join("alpha");
    assert!(dir.join("docs__STATUS.md").is_file());
    assert!(fs::read_to_string(dir.join("_index.md"))
        .unwrap()
        .contains("(docs__STATUS.md)"));
    assert!(target.write("../escape.md", "x").is_err());
    assert!(DirectoryTarget::new(Path::new("relative/dir"), "alpha").is_err());
    assert!(DirectoryTarget::new(&base.join("missing"), "alpha").is_err());
    assert!(DirectoryTarget::new(&base, "../alpha").is_err());
    fs::remove_dir_all(base).unwrap();
}

#[test]
fn context_pack_sources_keep_their_secret_marking() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let clean = ContextSourceInput {
        relative_path: "notes/PROJEKTSTATUS.md".to_string(),
        category: "status".to_string(),
        modified_at: "2026-10-06 08:00".to_string(),
        size_bytes: 40,
        content: "# Status\nContext pack source indexed".to_string(),
        secret_detected: false,
    };
    let marked = ContextSourceInput {
        relative_path: "notes/memory.md".to_string(),
        category: "memory".to_string(),
        content: String::new(),
        secret_detected: true,
        ..clean.clone()
    };
    let report = store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![
                MemorySource::from_context_source(&clean),
                MemorySource::from_context_source(&marked),
            ],
        ))
        .unwrap();
    assert_eq!(report.indexed_sources, 1);
    assert_eq!(report.skipped[0].reason, "secret_pattern");
    // Ohne Git-Nachweis nie mehr als observed.
    assert_eq!(
        query(&store, "alpha", "context pack", None).hits[0].truth_level,
        TruthLevel::Observed
    );
}

#[test]
fn query_result_is_provider_neutral_camel_case_json() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source(
                "STATUS.md",
                "status",
                "# Status\nGemma answers",
                true,
            )],
        ))
        .unwrap();
    let result = query(
        &store,
        "alpha",
        "gemma",
        Some(&live(HEAD, &[("STATUS.md", "# Status\nGemma answers")])),
    );
    let json: serde_json::Value = serde_json::to_value(&result).unwrap();
    assert_eq!(json["schemaVersion"], "katosync.memory-fabric/v1");
    let hit = &json["hits"][0];
    for key in [
        "chunkId",
        "sourceRef",
        "truthLevel",
        "evidence",
        "contentHash",
        "indexedHead",
        "freshness",
        "staleReasons",
        "score",
    ] {
        assert!(hit.get(key).is_some(), "missing {key}");
    }
    assert_eq!(hit["truthLevel"], "verified");
    assert_eq!(hit["freshness"], "fresh");
    assert_eq!(hit["sourceRef"], "STATUS.md#0");
    assert_eq!(hit["evidence"][0]["kind"], "git");
    assert_eq!(hit["evidence"][0]["ref"], format!("git:{HEAD}:STATUS.md"));
}

#[test]
fn helpers_normalize_remotes_and_parse_porcelain() {
    assert_eq!(
        normalize_remote("https://user:token@GitHub.com:443/NMKato/KatoSync.git").as_deref(),
        Some("github.com/nmkato/katosync")
    );
    assert_eq!(
        normalize_remote("git@github.com:NMKato/KatoSync.git").as_deref(),
        Some("github.com/nmkato/katosync")
    );
    assert_eq!(normalize_remote("  "), None);
    let dirty = parse_porcelain_z(b" M STATUS.md\0?? MEMORY.md\0R  NEW.md\0OLD.md\0");
    assert_eq!(
        dirty.into_iter().collect::<Vec<_>>(),
        vec!["MEMORY.md", "NEW.md", "OLD.md", "STATUS.md"]
    );
}

#[test]
fn collect_project_sources_uses_allowlist_git_truth_and_detects_staleness() {
    let root = temp_dir("repo");
    git(&root, &["init", "-q", "-b", "main"]);
    git(
        &root,
        &[
            "remote",
            "add",
            "origin",
            "https://user:secret-token@github.com/acme/demo.git",
        ],
    );
    fs::create_dir_all(root.join("docs/adr")).unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("node_modules/dep")).unwrap();
    fs::write(root.join("AGENTS.md"), "# Rules\nNever push to main.").unwrap();
    fs::write(
        root.join("PROJEKTSTATUS.md"),
        "# Status\nWave one committed.",
    )
    .unwrap();
    fs::write(root.join("ROADMAP.md"), "# Roadmap\nHybrid retrieval next.").unwrap();
    fs::write(
        root.join("docs/adr/0001-sqlite.md"),
        "# ADR 1\nUse SQLite FTS5.",
    )
    .unwrap();
    fs::write(root.join("src/MEMORY.md"), "# Deep\nnot in allowlist").unwrap();
    fs::write(root.join("node_modules/dep/MEMORY.md"), "# Vendored").unwrap();
    fs::write(root.join(".env"), "API_KEY=never").unwrap();
    git(&root, &["add", "-A"]);
    git(&root, &["commit", "-q", "-m", "init"]);
    fs::write(
        root.join("PROJEKTSTATUS.md"),
        "# Status\nWave two, uncommitted.",
    )
    .unwrap();
    fs::write(root.join("MEMORY.md"), "# Memory\nUntracked learning.").unwrap();
    fs::write(root.join("memory_secret.md"), "# Secret file name").unwrap();
    fs::write(root.join("HANDOFF.md"), "# Handoff\nTOKEN=abc123").unwrap();

    let collected = collect_project_sources(&root).unwrap();
    assert_eq!(
        collected.repo_identity.as_deref(),
        Some("github.com/acme/demo")
    );
    assert_eq!(collected.root_fingerprint.len(), 64);
    let head = collected.head.clone().unwrap();
    let paths: Vec<_> = collected
        .sources
        .iter()
        .map(|s| s.relative_path.as_str())
        .collect();
    assert!(!paths
        .iter()
        .any(|p| p.contains("src/") || p.contains("node_modules") || *p == ".env"));

    let mut store = MemoryStore::open_in_memory().unwrap();
    let report = store
        .ingest(
            collected
                .clone()
                .into_batch("demo", "Demo", "2026-10-06T08:00:00Z"),
        )
        .unwrap();
    let skipped: BTreeMap<_, _> = report
        .skipped
        .iter()
        .map(|s| (s.relative_path.as_str(), s.reason.as_str()))
        .collect();
    assert_eq!(skipped.get("memory_secret.md"), Some(&"secret_name"));
    assert_eq!(skipped.get("HANDOFF.md"), Some(&"secret_pattern"));
    let truth: BTreeMap<_, _> = store
        .snapshot("demo")
        .unwrap()
        .sources
        .into_iter()
        .map(|s| (s.relative_path, s.truth_level))
        .collect();
    assert_eq!(truth["AGENTS.md"], TruthLevel::Verified);
    assert_eq!(truth["ROADMAP.md"], TruthLevel::Verified);
    assert_eq!(truth["docs/adr/0001-sqlite.md"], TruthLevel::Verified);
    assert_eq!(truth["PROJEKTSTATUS.md"], TruthLevel::Observed);
    assert_eq!(truth["MEMORY.md"], TruthLevel::Observed);
    assert!(!serde_json::to_string(&store.snapshot("demo").unwrap())
        .unwrap()
        .contains(&root.to_string_lossy().to_string()));

    // Live-Stand: Inhalt aendern + neuer Commit -> stale bzw. head_moved.
    fs::write(root.join("AGENTS.md"), "# Rules\nNever push to main. Ever.").unwrap();
    git(&root, &["add", "ROADMAP.md", "AGENTS.md"]);
    git(&root, &["commit", "-q", "-m", "next"]);
    let fresh = collect_project_sources(&root).unwrap();
    assert!(store.root_matches("demo", &fresh.root_fingerprint).unwrap());
    assert_ne!(fresh.head.as_deref(), Some(head.as_str()));
    let state = probe_live_state(&fresh, &store.source_paths("demo").unwrap());
    let result = query(
        &store,
        "demo",
        "never push main hybrid retrieval",
        Some(&state),
    );
    let freshness: BTreeMap<_, _> = result
        .hits
        .iter()
        .map(|h| (h.relative_path.as_str(), h.freshness))
        .collect();
    assert_eq!(freshness["AGENTS.md"], Freshness::Stale);
    assert_eq!(freshness["ROADMAP.md"], Freshness::HeadMoved);

    assert!(collect_project_sources(&root.join("missing")).is_err());
    let not_git = temp_dir("plain");
    assert!(collect_project_sources(&not_git).is_err());
    fs::remove_dir_all(root).unwrap();
    fs::remove_dir_all(not_git).unwrap();
}

#[test]
fn rex_is_reserved_main_identity_and_uses_stable_node_id() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let rex = store
        .register_rex_main(
            "ks-11111111-1111-1111-1111-111111111111",
            None,
            "2026-10-06T17:10:00Z",
        )
        .unwrap();
    assert_eq!(rex.node_id, "ks-11111111-1111-1111-1111-111111111111");
    assert_eq!(rex.display_name, REX_MAIN_NAME);
    assert_eq!(rex.kind, NodeIdentityKind::RexMain);
    assert_eq!(rex.name_origin, NameOrigin::ReservedMain);

    let second = store.register_rex_main(
        "ks-22222222-2222-2222-2222-222222222222",
        None,
        "2026-10-06T17:11:00Z",
    );
    assert!(second.unwrap_err().contains("REX"));

    let named = store.register_named_identity(NamedIdentityProposal {
        node_id: "ks-33333333-3333-3333-3333-333333333333".to_string(),
        display_name: "rex".to_string(),
        role_summary: "Worker".to_string(),
        traits: vec![],
        capabilities: vec![],
        experience_refs: vec![],
        now: "2026-10-06T17:12:00Z".to_string(),
    });
    assert!(named.unwrap_err().contains("reserviert"));
}

#[test]
fn named_nodes_self_select_short_names_without_changing_technical_identity() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let node_id = "ks-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    let named = store
        .register_named_identity(NamedIdentityProposal {
            node_id: node_id.to_string(),
            display_name: "nOVA".to_string(),
            role_summary: "Windows operator and UI validation".to_string(),
            traits: vec!["careful".to_string(), "evidence-first".to_string()],
            capabilities: vec!["windows".to_string(), "ui".to_string()],
            experience_refs: vec!["rex://episodes/theorg-readonly".to_string()],
            now: "2026-10-06T17:13:00Z".to_string(),
        })
        .unwrap();
    assert_eq!(named.node_id, node_id);
    assert_eq!(named.display_name, "Nova");
    assert_eq!(named.kind, NodeIdentityKind::NamedNode);
    assert_eq!(named.name_origin, NameOrigin::SelfSelected);

    let rename = store.register_named_identity(NamedIdentityProposal {
        node_id: node_id.to_string(),
        display_name: "Kiro".to_string(),
        role_summary: "same node".to_string(),
        traits: vec![],
        capabilities: vec![],
        experience_refs: vec![],
        now: "2026-10-06T17:14:00Z".to_string(),
    });
    assert!(rename.unwrap_err().contains("Umbenennung"));

    for invalid in ["A", "TooLong", "No-1", "1234"] {
        let result = store.register_named_identity(NamedIdentityProposal {
            node_id: format!("ks-{invalid}"),
            display_name: invalid.to_string(),
            role_summary: String::new(),
            traits: vec![],
            capabilities: vec![],
            experience_refs: vec![],
            now: "2026-10-06T17:15:00Z".to_string(),
        });
        assert!(result.is_err(), "{invalid} should fail");
    }
}

#[test]
fn persona_metadata_is_bounded_deduplicated_and_secret_redacted() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let identity = store
        .register_named_identity(NamedIdentityProposal {
            node_id: "ks-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            display_name: "Kiro".to_string(),
            role_summary:
                "Works at /Users/alice/private with OPENAI_API_KEY=sk-never-store-this-value-123456"
                    .to_string(),
            traits: vec![
                "evidence-first".to_string(),
                "evidence-first".to_string(),
                "calm".to_string(),
            ],
            capabilities: vec!["git".to_string(), "local-rag".to_string()],
            experience_refs: vec![
                "/Users/alice/private/episode.md".to_string(),
                "rex://episodes/verified-1".to_string(),
            ],
            now: "2026-10-06T17:16:00Z".to_string(),
        })
        .unwrap();
    let json = serde_json::to_string(&identity).unwrap();
    assert!(!json.contains("/Users/alice"));
    assert!(!json.contains("sk-never"));
    assert_eq!(
        identity
            .persona
            .traits
            .iter()
            .filter(|value| value.as_str() == "evidence-first")
            .count(),
        1
    );
}

#[tokio::test]
#[ignore = "requires the managed Local Brain on 127.0.0.1:17842"]
async fn live_local_brain_uses_verified_rag_and_refuses_missing_fact() {
    let root = temp_dir("live-rag");
    git(&root, &["init", "-q", "-b", "main"]);
    let memory = "# Verified Memory\nThe private acceptance codename is ORCHID-731.\n";
    fs::write(root.join("MEMORY.md"), memory).unwrap();
    git(&root, &["add", "MEMORY.md"]);
    git(&root, &["commit", "-q", "-m", "verified memory"]);

    let collected = collect_project_sources(&root).unwrap();
    let mut store = MemoryStore::open_in_memory().unwrap();
    store
        .ingest(
            collected
                .clone()
                .into_batch("rag-live", "RAG Live", "2026-10-06T17:20:00Z"),
        )
        .unwrap();
    let live = probe_live_state(&collected, &store.source_paths("rag-live").unwrap());
    let result = store
        .query(
            &MemoryQuery::new("rag-live", "private acceptance codename", Some(4)),
            Some(&live),
            &LexicalOnly,
        )
        .unwrap();
    let block = assemble_rag_block(&result, &RagOptions::default());
    assert_eq!(block.citations.len(), 1);

    let known = crate::local_brain::grounded_chat(
        &block.text,
        "What is the private acceptance codename? Answer only the codename.",
    )
    .await
    .unwrap();
    assert_eq!(known, "ORCHID-731");

    let missing =
        crate::local_brain::grounded_chat(&block.text, "What is the production database password?")
            .await
            .unwrap();
    assert_eq!(missing, "NOT_IN_MEMORY");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn overview_is_read_only_counts_only_and_never_creates_a_store() {
    let dir = temp_dir("overview");
    let path = dir.join("memory.sqlite3");
    assert!(MemoryStore::open_read_only(&path).unwrap().is_none());
    assert!(!path.exists(), "overview must never create the store");
    assert!(!MemoryFabricOverview::unavailable().available);

    {
        let mut store = MemoryStore::open(&path).unwrap();
        store
            .ingest(batch(
                "alpha",
                Some(HEAD),
                vec![
                    source(
                        "STATUS.md",
                        "status",
                        "# Status\nSecret-free fact one",
                        true,
                    ),
                    source(
                        "HANDOFF.md",
                        "handoff",
                        "# Handoff\nUncommitted note",
                        false,
                    ),
                ],
            ))
            .unwrap();
        promote(
            &mut store,
            "alpha",
            "STATUS.md",
            "# Status\nSecret-free fact one",
        );
        store
            .register_rex_main(
                "ks-11111111-1111-1111-1111-111111111111",
                None,
                "2026-10-06T17:10:00Z",
            )
            .unwrap();
    }

    let store = MemoryStore::open_read_only(&path)
        .unwrap()
        .expect("store exists");
    let overview = store.overview().unwrap();
    assert!(overview.available);
    assert_eq!(overview.projects.len(), 1);
    let alpha = &overview.projects[0];
    assert_eq!(alpha.project_id, "alpha");
    assert_eq!(alpha.git_head.as_deref(), Some(HEAD));
    assert_eq!(alpha.sources, 2);
    assert!(alpha.chunks >= 2);
    assert_eq!((alpha.observed, alpha.verified, alpha.canonical), (1, 0, 1));
    assert_eq!(overview.identities.len(), 1);
    assert_eq!(overview.identities[0].display_name, REX_MAIN_NAME);
    assert_eq!(overview.identities[0].kind, NodeIdentityKind::RexMain);

    let json = serde_json::to_string(&overview).unwrap();
    assert!(json.contains("\"projectId\":\"alpha\""));
    assert!(
        !json.contains("Secret-free fact"),
        "no chunk content in the overview"
    );
    assert!(
        !json.contains("STATUS.md"),
        "no source paths in the overview"
    );
    assert!(
        !json.contains("/fixture/"),
        "no machine paths in the overview"
    );
    fs::remove_dir_all(dir).unwrap();
}

// === Continuity journal v1: local durable history, NEVER canonical project truth ===
fn journal_draft(project_id: &str, event_id: &str, previous: Option<&str>) -> super::JournalDraft {
    super::JournalDraft {
        project_id: project_id.to_string(),
        event_id: event_id.to_string(),
        device_id: "local-m2".to_string(),
        kind: "decision_proposal".to_string(),
        summary: "Keep the existing Memory Fabric as the single verified store".to_string(),
        payload_json: r#"{"choice":"Reuse Memory Fabric","why":"Avoid duplicate project truths"}"#
            .to_string(),
        base_git_head: Some(HEAD.to_string()),
        created_at: "2026-10-22T09:00:00Z".to_string(),
        expected_prev_hash: previous.map(str::to_string),
    }
}

#[test]
fn journal_is_project_scoped_append_only_and_idempotent() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
    assert!(store
        .append_continuity(journal_draft("unregistered", "evt-1", None))
        .is_err());

    let first = store
        .append_continuity(journal_draft("alpha", "evt-1", None))
        .unwrap();
    assert!(!first.replayed);
    assert_eq!(first.event.sequence, 1);
    assert!(first.event.previous_hash.is_none());
    assert_eq!(first.event.event_hash.len(), 64);
    let replay = store
        .append_continuity(journal_draft("alpha", "evt-1", None))
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.event, first.event);
    assert!(store
        .append_continuity(journal_draft("alpha", "evt-2", None))
        .is_err());

    let next = store
        .append_continuity(journal_draft(
            "alpha",
            "evt-2",
            Some(&first.event.event_hash),
        ))
        .unwrap();
    assert_eq!(next.event.sequence, 2);
    assert_eq!(
        next.event.previous_hash.as_deref(),
        Some(first.event.event_hash.as_str())
    );
    let alpha = store.continuity_events("alpha", 0, 100).unwrap();
    assert_eq!(alpha.len(), 2);
    assert_eq!(store.continuity_events("alpha", 1, 10).unwrap().len(), 1);
    assert!(store.continuity_events("beta", 0, 10).unwrap().is_empty());
    assert!(store.continuity_events("alpha", 0, 101).is_err());
    let beta = store
        .append_continuity(journal_draft("beta", "evt-1", None))
        .unwrap();
    assert_eq!(beta.event.sequence, 1);
    assert_eq!(store.continuity_events("beta", 0, 10).unwrap().len(), 1);
    assert_eq!(
        store.snapshot("alpha").unwrap().sources.len(),
        0,
        "event notes must not become indexed/canonical memory"
    );
}

#[test]
fn journal_conflicts_reject_stale_branch_and_event_id_reuse() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    let original = store
        .append_continuity(journal_draft("alpha", "evt-1", None))
        .unwrap();
    let mut rewritten = journal_draft("alpha", "evt-1", None);
    rewritten.summary = "Different reason: override the owner".to_string();
    assert!(store
        .append_continuity(rewritten)
        .unwrap_err()
        .contains("bereits anders"));
    let mut malformed = journal_draft("alpha", "evt-2", Some(&original.event.event_hash));
    malformed.kind = "run_shell".to_string();
    assert!(store.append_continuity(malformed).is_err());
    let mut bad_head = journal_draft("alpha", "evt-2", Some(&original.event.event_hash));
    bad_head.base_git_head = Some("NOT-A-REAL-COMMIT".to_string());
    assert!(store.append_continuity(bad_head).is_err());
    let mut payload = journal_draft("alpha", "evt-2", Some(&original.event.event_hash));
    payload.payload_json = "[\"not an object\"]".to_string();
    assert!(store.append_continuity(payload).is_err());
    assert_eq!(store.continuity_events("alpha", 0, 10).unwrap().len(), 1);
}

#[test]
fn journal_persists_in_the_existing_fabric_and_survives_project_reindex() {
    let dir = temp_dir("journal");
    let path = dir.join("memory.sqlite3");
    let hash;
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store
            .ingest(batch(
                "alpha",
                Some(HEAD),
                vec![source(
                    "STATUS.md",
                    "status",
                    "# Status\nSource remains verified",
                    true,
                )],
            ))
            .unwrap();
        hash = store
            .append_continuity(journal_draft("alpha", "evt-1", None))
            .unwrap()
            .event
            .event_hash;
    }
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store
            .ingest(batch("alpha", Some(NEXT_HEAD), vec![]))
            .unwrap();
        assert_eq!(store.continuity_events("alpha", 0, 10).unwrap().len(), 1);
        let second = store
            .append_continuity(journal_draft("alpha", "evt-2", Some(&hash)))
            .unwrap();
        assert_eq!(second.event.sequence, 2);
        assert_eq!(
            store.snapshot("alpha").unwrap().git_head.as_deref(),
            Some(NEXT_HEAD)
        );
        assert!(MemoryStore::open_read_only(&path).unwrap().is_some());
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn journal_migrates_v1_store_transactionally_without_losing_memory() {
    let dir = temp_dir("journal-migrate");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store
            .ingest(batch(
                "alpha",
                Some(HEAD),
                vec![source(
                    "STATUS.md",
                    "status",
                    "# Keep\nOriginal v1 facts",
                    true,
                )],
            ))
            .unwrap();
        store
            .conn
            .execute_batch("DROP TABLE continuity_events; DROP TABLE continuity_chat_turns; PRAGMA user_version=1;")
            .unwrap();
    }
    // Read-only overview accepts the previous version without changing it.
    assert!(MemoryStore::open_read_only(&path).unwrap().is_some());
    {
        let mut store = MemoryStore::open(&path).unwrap();
        assert_eq!(store.snapshot("alpha").unwrap().sources.len(), 1);
        let ev = store
            .append_continuity(journal_draft("alpha", "evt-1", None))
            .unwrap();
        assert_eq!(ev.event.sequence, 1);
        let version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 4);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn journal_redacts_secret_fields_without_corrupting_json_or_trusting_model_output() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    let mut draft = journal_draft("alpha", "evt-secret", None);
    draft.payload_json = r#"{"why":"A quoted \"string\" is valid JSON","apiKey":"very-secret-key","nested":{"access_token":"top-secret","reason":"/Users/alice/source"}}"#.to_string();
    let result = store.append_continuity(draft).unwrap();
    let value: serde_json::Value = serde_json::from_str(&result.event.payload_json).unwrap();
    assert_eq!(value["apiKey"], "[redacted]");
    assert_eq!(value["nested"]["access_token"], "[redacted]");
    assert!(!result.event.payload_json.contains("alice"));
    assert!(!result.event.payload_json.contains("very-secret-key"));
    assert_eq!(store.snapshot("alpha").unwrap().sources.len(), 0);
}

#[test]
fn journal_rejects_nested_payload_bombs_and_preserves_empty_history() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    let mut draft = journal_draft("alpha", "evt-nested", None);
    draft.payload_json = format!("{}{}", "[".repeat(30), "]".repeat(30));
    assert!(store.append_continuity(draft).is_err());
    let mut draft = journal_draft("alpha", "evt-object", None);
    draft.payload_json = format!("{}1{}", "{\"a\":".repeat(19), "}".repeat(19));
    assert!(store.append_continuity(draft).is_err());
    assert!(store.continuity_events("alpha", 0, 10).unwrap().is_empty());
}

#[test]
fn journal_two_independent_sqlite_writers_cannot_claim_one_predecessor() {
    use std::sync::{Arc, Barrier};
    let dir = temp_dir("journal-race");
    let path = dir.join("memory.sqlite3");
    let root_hash = {
        let mut store = MemoryStore::open(&path).unwrap();
        store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
        store
            .append_continuity(journal_draft("alpha", "root", None))
            .unwrap()
            .event
            .event_hash
    };
    let barrier = Arc::new(Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|index| {
            let path = path.clone();
            let root_hash = root_hash.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                let mut store = MemoryStore::open(&path).unwrap();
                let mut draft =
                    journal_draft("alpha", &format!("writer-{index}"), Some(&root_hash));
                draft.device_id = format!("device-{index}");
                barrier.wait();
                store.append_continuity(draft)
            })
        })
        .collect();
    let outcomes: Vec<_> = handles
        .into_iter()
        .map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(outcomes.iter().filter(|value| value.is_ok()).count(), 1);
    assert_eq!(outcomes.iter().filter(|value| value.is_err()).count(), 1);
    assert!(outcomes
        .into_iter()
        .find_map(Result::err)
        .unwrap()
        .contains("Konflikt"));
    assert_eq!(
        MemoryStore::open(&path)
            .unwrap()
            .continuity_events("alpha", 0, 10)
            .unwrap()
            .len(),
        2
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn continuity_recent_timeline_is_newest_first_bounded_and_project_isolated() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
    let mut previous: Option<String> = None;
    for seq in 1..=25 {
        let saved = store
            .append_continuity(journal_draft(
                "alpha",
                &format!("timeline-{seq}"),
                previous.as_deref(),
            ))
            .unwrap();
        previous = Some(saved.event.event_hash);
    }
    store
        .append_continuity(journal_draft("beta", "timeline-1", None))
        .unwrap();
    let recent = store.recent_continuity_events("alpha", 20).unwrap();
    assert_eq!(recent.len(), 20);
    assert_eq!(recent[0].sequence, 25);
    assert_eq!(recent[19].sequence, 6);
    assert!(recent.iter().all(|event| event.project_id == "alpha"));
    assert_eq!(store.recent_continuity_events("beta", 10).unwrap().len(), 1);
    assert!(store.recent_continuity_events("alpha", 0).is_err());
    assert!(store.recent_continuity_events("alpha", 31).is_err());
    assert!(store.recent_continuity_events("../alpha", 10).is_err());
}

fn chat_draft(project: &str, expected: i64, question: &str) -> super::ChatTurnDraft {
    super::ChatTurnDraft {
        project_id: project.to_string(),
        expected_sequence: expected,
        question: question.to_string(),
        answer: "An answer grounded only in current verified sources.".to_string(),
        git_head: HEAD.to_string(),
        citations_json: "[]".to_string(),
        created_at: "2026-10-22T15:20:00Z".to_string(),
    }
}

#[test]
fn durable_chat_preserves_sequence_restart_and_project_isolation() {
    let dir = temp_dir("continuity-chat");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
        store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
        let first = store
            .append_local_chat_turn(chat_draft("alpha", 0, "Why SQLite?"))
            .unwrap();
        assert_eq!(first.sequence, 1);
        let second = store
            .append_local_chat_turn(chat_draft("alpha", 1, "What about offline?"))
            .unwrap();
        assert_eq!(second.sequence, 2);
        assert!(store
            .append_local_chat_turn(chat_draft("alpha", 0, "stale"))
            .is_err());
        assert!(store
            .append_local_chat_turn(chat_draft("foreign", 0, "foreign"))
            .is_err());
        assert!(store.local_chat_history("beta", 20).unwrap().is_empty());
    }
    {
        let store = MemoryStore::open_read_only(&path).unwrap().unwrap();
        let turns = store.local_chat_history("alpha", 20).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].question, "Why SQLite?");
        assert_eq!(turns[1].sequence, 2);
        assert!(
            store.snapshot("alpha").unwrap().sources.is_empty(),
            "transcript must not enter canonical RAG"
        );
        assert!(store.local_chat_history("other", 20).unwrap().is_empty());
        assert!(store.local_chat_history("alpha", 21).is_err());
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn durable_chat_migrates_v2_without_overwriting_journal() {
    let dir = temp_dir("continuity-chat-migration");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
        store
            .append_continuity(journal_draft("alpha", "keep-me", None))
            .unwrap();
        store
            .conn
            .execute_batch("DROP TABLE continuity_chat_turns; PRAGMA user_version=2;")
            .unwrap();
    }
    assert!(MemoryStore::open_read_only(&path).unwrap().is_some());
    {
        let mut store = MemoryStore::open(&path).unwrap();
        assert_eq!(store.continuity_events("alpha", 0, 5).unwrap().len(), 1);
        store
            .append_local_chat_turn(chat_draft("alpha", 0, "Why retain journal?"))
            .unwrap();
        let version: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, 4);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn durable_chat_redacts_secrets_rejects_invalid_payloads_and_conflicts() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    let mut bad = chat_draft("alpha", 0, "");
    assert!(store.append_local_chat_turn(bad.clone()).is_err());
    bad.question = "a".repeat(1201);
    assert!(store.append_local_chat_turn(bad.clone()).is_err());
    bad.question = "Safe?".into();
    bad.answer = "".into();
    assert!(store.append_local_chat_turn(bad.clone()).is_err());
    bad.answer = "Possible.".into();
    bad.citations_json = "{\"not\":\"array\"}".into();
    assert!(store.append_local_chat_turn(bad.clone()).is_err());
    bad.citations_json = "[]".into();
    bad.git_head = "not-sha".into();
    assert!(store.append_local_chat_turn(bad).is_err());
    let mut secret = chat_draft(
        "alpha",
        0,
        "My token is sk-test-long-not-for-sharing please",
    );
    secret.answer = "See /Users/alice/private".into();
    let stored = store.append_local_chat_turn(secret).unwrap();
    assert!(!stored.question.contains("sk-test-long"));
    assert!(!stored.answer.contains("/Users/alice/private"));
    assert_eq!(store.local_chat_history("alpha", 20).unwrap().len(), 1);
}

#[test]
fn durable_chat_two_writers_require_matching_previous_sequence() {
    use std::sync::{Arc, Barrier};
    let dir = temp_dir("continuity-chat-race");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    }
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|n| {
            let b = barrier.clone();
            let path = path.clone();
            std::thread::spawn(move || {
                let mut store = MemoryStore::open(&path).unwrap();
                b.wait();
                store.append_local_chat_turn(chat_draft("alpha", 0, &format!("question-{n}")))
            })
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(results.iter().filter(|r| r.is_err()).count(), 1);
    assert_eq!(
        MemoryStore::open_read_only(&path)
            .unwrap()
            .unwrap()
            .local_chat_history("alpha", 20)
            .unwrap()
            .len(),
        1
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn project_context_anchors_first_blueprint_three_starters_and_recent_twenty() {
    let dir = temp_dir("continuity-origin-context");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
        store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
        let blueprint = |id: &str, intent: &str| {
            serde_json::json!({
                "schemaVersion":"katosync.continuity-blueprint/v1",
                "projectId":"alpha","blueprintId":id,
                "title":"Initial design","intent":intent
            })
            .to_string()
        };
        let first = store
            .append_continuity(super::JournalDraft {
                project_id: "alpha".into(),
                event_id: "blueprint:origin".into(),
                device_id: "m2".into(),
                kind: "decision_proposal".into(),
                summary: "Initial".into(),
                payload_json: blueprint("origin", "What we build from day one"),
                base_git_head: Some(HEAD.into()),
                created_at: "2026-10-22T09:00:00Z".into(),
                expected_prev_hash: None,
            })
            .unwrap();
        store
            .append_continuity(super::JournalDraft {
                project_id: "alpha".into(),
                event_id: "blueprint:revision".into(),
                device_id: "m2".into(),
                kind: "decision_proposal".into(),
                summary: "Revision".into(),
                payload_json: blueprint("revision", "Do not replace the pinned original"),
                base_git_head: Some(HEAD.into()),
                created_at: "2026-10-22T10:00:00Z".into(),
                expected_prev_hash: Some(first.event.event_hash),
            })
            .unwrap();
        for i in 0..25 {
            store
                .append_local_chat_turn(chat_draft("alpha", i, &format!("Question {i}")))
                .unwrap();
        }
        store
            .append_local_chat_turn(chat_draft("beta", 0, "Secret project beta"))
            .unwrap();
    }
    {
        let store = MemoryStore::open_read_only(&path).unwrap().unwrap();
        let anchored = store.project_context_anchors("alpha").unwrap();
        assert_eq!(anchored.project_id, "alpha");
        let origin = anchored.pinned_origin.unwrap();
        assert_eq!(origin.blueprint_id, "origin");
        assert_eq!(origin.original_sequence, 1);
        assert_eq!(origin.verification, "imported_unverified_origin");
        assert_eq!(anchored.first_three.len(), 3);
        assert_eq!(
            anchored
                .first_three
                .iter()
                .map(|x| x.sequence)
                .collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(anchored.latest_twenty.len(), 20);
        assert_eq!(anchored.latest_twenty.first().unwrap().sequence, 6);
        assert_eq!(anchored.latest_twenty.last().unwrap().sequence, 25);
        assert!(!anchored
            .latest_twenty
            .iter()
            .any(|turn| turn.question.contains("Secret")));
        assert!(store
            .project_context_anchors("beta")
            .unwrap()
            .pinned_origin
            .is_none());
        assert!(store.project_context_anchors("../alpha").is_err());
        // Origin/answers are context DATA only; not indexed into verified source memory.
        assert!(store.snapshot("alpha").unwrap().sources.is_empty());
    }
    fs::remove_dir_all(dir).unwrap();
}

fn feature_blueprint(project: &str) -> String {
    serde_json::json!({
        "schemaVersion":"katosync.continuity-blueprint/v1",
        "projectId":project,
        "blueprintId":"genxline-plan",
        "revision":1,
        "title":"GENXLine family memory roadmap",
        "intent":"Private family timeline, planet and offline project tools",
        "nextSteps":["Test the photo landing experience"],
        "decisions":[
            {"id":"ADR-10","title":"Telephone assistant routing",
             "choice":"One on-demand telephony worker",
             "rationale":"Prevent forgotten warm containers and reduce costs",
             "alternatives":["Multiple always-on workers"],"consequences":["Startup latency"],
             "evidence":[{"kind":"issue","ref":"issue:76"}]},
            {"id":"ADR-11","title":"3D photo timeline",
             "choice":"Local panorama thumbnail anchored to the building",
             "rationale":"Ground images in the correct world location",
             "alternatives":[],"consequences":[],"evidence":[]}
        ]
    })
    .to_string()
}

#[test]
fn blueprint_feature_index_scopes_reasons_to_project_and_compares_baseline_only() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
    let mut proposal = journal_draft("alpha", "blueprint:initial", None);
    proposal.payload_json = feature_blueprint("alpha");
    let first = store.append_continuity(proposal).unwrap();
    let result = store
        .search_blueprint_sections("alpha", "telephony", HEAD)
        .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].section_key, "decision:ADR-10");
    assert!(result[0]
        .excerpt
        .contains("Prevent forgotten warm containers"));
    assert_eq!(result[0].truth_status, "imported_unverified");
    assert_eq!(result[0].git_baseline_matches, Some(true));
    assert_eq!(result[0].event_sequence, first.event.sequence);
    let stale = store
        .search_blueprint_sections("alpha", "telephony", NEXT_HEAD)
        .unwrap();
    assert_eq!(stale[0].git_baseline_matches, Some(false));
    assert!(store
        .search_blueprint_sections("beta", "telephony", HEAD)
        .unwrap()
        .is_empty());
    assert!(store
        .search_blueprint_sections("../alpha", "telephony", HEAD)
        .is_err());
    assert!(store
        .search_blueprint_sections("alpha", "\" OR *", HEAD)
        .unwrap()
        .is_empty());
    assert!(store
        .search_blueprint_sections("alpha", &"t".repeat(210), HEAD)
        .is_err());
    assert!(
        store.snapshot("alpha").unwrap().sources.is_empty(),
        "imported Blueprint must never become verified/canonical project fact"
    );
    assert!(store
        .append_continuity(journal_draft(
            "alpha",
            "reused-unrelated",
            Some(&first.event.event_hash)
        ))
        .is_ok());
    assert_eq!(
        store
            .search_blueprint_sections("alpha", "telephony", HEAD)
            .unwrap()
            .len(),
        1,
        "non-blueprint notes must not duplicate indexed decisions"
    );
}

#[test]
fn feature_index_stores_structured_milestones_without_claiming_completion() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    let mut milestone = journal_draft("alpha", "checkpoint:planet-textures", None);
    milestone.kind = "checkpoint".into();
    milestone.payload_json = serde_json::json!({
        "projectId":"alpha","featureKey":"3d-roofs",
        "title":"Photorealistic roofs","summary":"Roof geometry visual review pending",
        "rationale":"Need geometry verified on Hannover reference area",
        "status":"completed","evidence":["unverified screenshot"]
    })
    .to_string();
    store.append_continuity(milestone).unwrap();
    let hits = store
        .search_blueprint_sections("alpha", "roofs", HEAD)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].event_kind, "milestone");
    assert_eq!(hits[0].truth_status, "imported_unverified");
    assert!(hits[0].excerpt.contains("Claimed status: completed"));
    assert!(store
        .search_blueprint_sections("beta", "roofs", HEAD)
        .unwrap()
        .is_empty());
}

#[test]
fn feature_index_v3_migration_backfills_existing_blueprints_transactionally() {
    let dir = temp_dir("blueprint-backfill");
    let path = dir.join("memory.sqlite3");
    {
        let mut store = MemoryStore::open(&path).unwrap();
        store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
        let mut proposal = journal_draft("alpha", "blueprint:from-v3", None);
        proposal.payload_json = feature_blueprint("alpha");
        store.append_continuity(proposal).unwrap();
        store
            .conn
            .execute_batch(
                "DROP TRIGGER IF EXISTS bp_section_ai;
             DROP TRIGGER IF EXISTS bp_section_ad;
             DROP TRIGGER IF EXISTS bp_section_au;
             DROP TABLE blueprint_sections_fts;
             DROP TABLE blueprint_sections;
             PRAGMA user_version=3;",
            )
            .unwrap();
    }
    assert!(MemoryStore::open_read_only(&path).unwrap().is_some());
    {
        let store = MemoryStore::open(&path).unwrap();
        assert_eq!(
            store
                .search_blueprint_sections("alpha", "telephony", HEAD)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(store.continuity_events("alpha", 0, 10).unwrap().len(), 1);
        assert_eq!(store.snapshot("alpha").unwrap().project_id, "alpha");
        let schema: i64 = store
            .conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(schema, 4);
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn feature_trace_joins_exact_adr_revision_and_milestone_with_no_false_completion() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source(
                "docs/ADR-10.md",
                "architecture",
                "# ADR-10\nADR-10 describes a verified telephone architecture.",
                true,
            )],
        ))
        .unwrap();
    store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
    let mut first = journal_draft("alpha", "blueprint:orig-trace", None);
    first.payload_json = feature_blueprint("alpha");
    let initial = store.append_continuity(first).unwrap();
    let mut revision = journal_draft(
        "alpha",
        "blueprint:revision-trace",
        Some(&initial.event.event_hash),
    );
    revision.payload_json = feature_blueprint("alpha").replace(
        "Prevent forgotten warm containers",
        "Use no idle cloud workers",
    );
    let updated = store.append_continuity(revision).unwrap();
    let mut milestone = journal_draft("alpha", "milestone:ADR-10", Some(&updated.event.event_hash));
    milestone.kind = "checkpoint".into();
    milestone.payload_json = serde_json::json!({
        "projectId":"alpha","featureKey":"ADR-10","title":"Phone routing",
        "summary":"Claims feature completed","rationale":"Prototype ran",
        "status":"completed","evidence":[{"kind":"git_commit","ref":"a".repeat(40)}]
    })
    .to_string();
    store.append_continuity(milestone).unwrap();
    let check = live(
        HEAD,
        &[(
            "docs/ADR-10.md",
            "# ADR-10\nADR-10 describes a verified telephone architecture.",
        )],
    );
    let report = super::feature_trace::build_feature_trace(
        &store,
        "alpha",
        "decision:ADR-10",
        std::path::Path::new("/nonexistent/katosync-git"),
        &check,
        HEAD,
    )
    .unwrap();
    assert_eq!(report.feature_id, "ADR-10");
    assert_eq!(report.versions.len(), 3);
    assert_eq!(report.versions[0].event_kind, "milestone");
    assert_eq!(report.versions[1].event_kind, "blueprint");
    assert_eq!(report.versions[2].event_kind, "blueprint");
    assert_eq!(
        report.completion,
        "unknown_requires_feature_specific_tests_and_owner_review"
    );
    assert!(report
        .claimed_evidence
        .iter()
        .any(|ev| ev.check == "unverified_reference"));
    assert!(report
        .claimed_evidence
        .iter()
        .any(|ev| ev.check == "commit_not_present_locally"));
    assert!(
        !report.matching_verified_sources.is_empty(),
        "independent indexed source text may be a candidate without proving completion"
    );
    assert!(report
        .matching_verified_sources
        .iter()
        .all(|s| s.match_basis == "lexical_candidate_not_implementation_proof"));
    let from_milestone = store
        .feature_versions("alpha", "milestone:ADR-10", HEAD)
        .unwrap();
    assert_eq!(from_milestone.len(), 3);
    assert!(store
        .feature_versions("beta", "decision:ADR-10", HEAD)
        .unwrap()
        .is_empty());
    assert!(store
        .feature_versions("../alpha", "decision:ADR-10", HEAD)
        .is_err());
    assert!(
        store
            .feature_versions("alpha", "decision:ADR-11", HEAD)
            .unwrap()
            .len()
            == 2
    );
}

#[test]
fn feature_trace_stale_verified_sources_and_unrelated_keys_are_not_auto_joined() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    let original = "# ADR-10\nADR-10 was the original choice";
    store
        .ingest(batch(
            "alpha",
            Some(HEAD),
            vec![source("docs/ADR-10.md", "architecture", original, true)],
        ))
        .unwrap();
    let mut proposal = journal_draft("alpha", "blueprint:stale-trace", None);
    proposal.payload_json = feature_blueprint("alpha");
    store.append_continuity(proposal).unwrap();
    let check = live(
        HEAD,
        &[("docs/ADR-10.md", "# ADR-10\nCHANGED since last index")],
    );
    let trace = super::feature_trace::build_feature_trace(
        &store,
        "alpha",
        "decision:ADR-10",
        std::path::Path::new("/none"),
        &check,
        HEAD,
    )
    .unwrap();
    assert!(
        trace.matching_verified_sources.is_empty(),
        "source content changed, so it must not be treated as fresh evidence"
    );
    assert!(store
        .feature_versions("alpha", "milestone:unrelated", HEAD)
        .unwrap()
        .is_empty());
}

#[test]
fn mvp_progress_scopes_weighted_claims_and_separates_side_tasks_without_fake_acceptance() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    store.ingest(batch("beta", Some(HEAD), vec![])).unwrap();
    let mut blueprint = journal_draft("alpha", "blueprint:mvp-scope", None);
    blueprint.payload_json = serde_json::json!({
        "schemaVersion":"katosync.continuity-blueprint/v1",
        "projectId":"alpha","blueprintId":"mvp-v1",
        "mvpScope":[
            {"featureId":"A","title":"Main feature","lane":"mvp","weight":3,
             "acceptanceCriteria":"Automated regression test and operator review"},
            {"featureId":"B","title":"Second feature","lane":"mvp","weight":1,
             "acceptanceCriteria":"Live user flow verified"},
            {"featureId":"EXTRA","title":"Animation polish","lane":"side","weight":5,
             "acceptanceCriteria":"Visual style review"}
        ]
    })
    .to_string();
    let first = store.append_continuity(blueprint).unwrap();
    let mut tail = first.event.event_hash;
    let mut add_claim = |key: &str, status: &str| {
        let mut draft = journal_draft("alpha", &format!("checkpoint:{key}:{status}"), Some(&tail));
        draft.kind = "checkpoint".into();
        draft.payload_json = serde_json::json!({
            "projectId":"alpha","featureKey":key,"title":key,
            "summary":"A model says this is complete","rationale":"Unverified claim",
            "status":status,"evidence":[]
        })
        .to_string();
        tail = store.append_continuity(draft).unwrap().event.event_hash;
    };
    add_claim("A", "completed");
    add_claim("B", "in_progress");
    add_claim("EXTRA", "completed");
    let current = store.project_mvp_progress("alpha").unwrap();
    assert_eq!(current.mvp_task_count, 2);
    assert_eq!(current.side_task_count, 1);
    assert_eq!(current.total_weight, 4);
    assert_eq!(current.reported_done_weight, 3);
    assert_eq!(current.reported_percent, Some(75));
    assert_eq!(current.verified_percent, None);
    assert_eq!(current.plan_status, "imported_unverified");
    assert_eq!(current.tasks[0].reported_status, "claimed_done");
    assert!(!current.tasks[0].verified);
    let other = store.project_mvp_progress("beta").unwrap();
    assert_eq!(other.reported_percent, None);
    assert_eq!(other.plan_status, "missing_explicit_mvp_scope");
}

#[test]
fn mvp_progress_newer_checkpoint_can_reopen_claimed_done_and_legacy_has_no_percent() {
    let mut store = MemoryStore::open_in_memory().unwrap();
    store.ingest(batch("alpha", Some(HEAD), vec![])).unwrap();
    assert_eq!(
        store
            .project_mvp_progress("alpha")
            .unwrap()
            .reported_percent,
        None
    );
    let mut draft = journal_draft("alpha", "blueprint:defined", None);
    draft.payload_json = serde_json::json!({
       "schemaVersion":"katosync.continuity-blueprint/v1","projectId":"alpha",
       "mvpScope":[{"featureId":"A","title":"Primary","lane":"mvp","weight":5,
                    "acceptanceCriteria":"Human-approved release test"}]
    })
    .to_string();
    let first = store.append_continuity(draft).unwrap();
    let mut one = journal_draft("alpha", "checkpoint:done", Some(&first.event.event_hash));
    one.kind = "checkpoint".into();
    one.payload_json = serde_json::json!({
       "projectId":"alpha","featureKey":"A","title":"Primary","status":"done"
    })
    .to_string();
    let prior = store.append_continuity(one).unwrap();
    assert_eq!(
        store
            .project_mvp_progress("alpha")
            .unwrap()
            .reported_percent,
        Some(100)
    );
    let mut reopened = journal_draft(
        "alpha",
        "checkpoint:reopened",
        Some(&prior.event.event_hash),
    );
    reopened.kind = "checkpoint".into();
    reopened.payload_json = serde_json::json!({
        "projectId":"alpha","featureKey":"A","title":"Primary","status":"blocked"
    })
    .to_string();
    store.append_continuity(reopened).unwrap();
    let result = store.project_mvp_progress("alpha").unwrap();
    assert_eq!(result.reported_percent, Some(0));
    assert_eq!(result.verified_percent, None);
    assert_eq!(result.tasks[0].reported_status, "claimed_blocked");
}
