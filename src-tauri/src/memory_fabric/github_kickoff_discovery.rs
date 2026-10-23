// Created by NMKato Solutions
//! Optional, on-demand, read-only GitHub kickoff discovery; no writes or auth prompts.
use super::github_ci::github_repo_from_remote;
use serde::Serialize;
use std::{collections::BTreeSet, path::Path, process::Stdio};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

const ISSUES_PER_PAGE: usize = 100;
const MAX_ISSUE_PAGES: usize = 4;
const MAX_ISSUES: usize = ISSUES_PER_PAGE * MAX_ISSUE_PAGES;
const MAX_PROJECTS: usize = 100;
const MAX_FEATURES: usize = 12;
const MAX_RESPONSE: usize = 3 * 1024 * 1024;
fn safe_feature(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':'))
}
fn safe_name(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= 180 && !s.chars().any(|c| c.is_control())
}
async fn run_readonly(bin: &str, args: &[&str], sec: u64, max: usize) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .env("GH_HOST", "github.com")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PAGER", "cat")
        .env("GIT_PAGER", "cat")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let out = timeout(Duration::from_secs(sec), cmd.output())
        .await
        .map_err(|_| "GitHub-Erkennung hat das Zeitlimit überschritten.".to_string())?
        .map_err(|_| "Git oder GitHub CLI ist nicht installiert.".to_string())?;
    if !out.status.success() {
        return Err(
            "GitHub nicht erreichbar: Anmeldung, Berechtigung oder Internet prüfen.".into(),
        );
    }
    if out.stdout.len() > max {
        return Err("GitHub-Antwort zu umfangreich.".into());
    }
    String::from_utf8(out.stdout).map_err(|_| "GitHub-Antwort nicht UTF-8.".into())
}
async fn git(root: &Path, parts: &[&str]) -> Result<String, String> {
    let path = root
        .to_str()
        .ok_or_else(|| "Projektpfad ungültig.".to_string())?;
    let mut args = vec!["-C", path];
    args.extend_from_slice(parts);
    run_readonly("git", &args, 5, 2048).await
}
fn json(raw: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(raw).map_err(|_| "GitHub hat ungültige Daten geliefert.".into())
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubRepoFacts {
    pub full_name: String,
    pub visibility: &'static str,
    pub archived: bool,
    pub has_issues: bool,
}
fn repo_facts(raw: &str, expected: &str) -> Result<GithubRepoFacts, String> {
    let v = json(raw)?;
    let name = v
        .get("full_name")
        .and_then(|x| x.as_str())
        .ok_or_else(|| "GitHub-Repositoryname fehlt.".to_string())?;
    if !name.eq_ignore_ascii_case(expected) {
        return Err("GitHub-Repositoryidentität stimmt nicht überein.".into());
    }
    let private = v
        .get("private")
        .and_then(|x| x.as_bool())
        .ok_or_else(|| "Repository-Sichtbarkeit unbekannt.".to_string())?;
    let archived = v
        .get("archived")
        .and_then(|x| x.as_bool())
        .ok_or_else(|| "Repositorystatus unbekannt.".to_string())?;
    let issues = v
        .get("has_issues")
        .and_then(|x| x.as_bool())
        .ok_or_else(|| "Issue-Status unbekannt.".to_string())?;
    Ok(GithubRepoFacts {
        full_name: name.into(),
        visibility: if private { "private" } else { "public" },
        archived,
        has_issues: issues,
    })
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoardCandidate {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub public: bool,
    pub closed: bool,
    pub possible_repo_match: bool,
    pub provider_id: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssueCandidate {
    pub feature_id: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub state: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubKickoffDiscovery {
    pub project_id: String,
    pub repository: GithubRepoFacts,
    pub observed_git_head: String,
    pub auth_source: &'static str,
    pub projects_status: &'static str,
    pub projects_scan_complete: bool,
    pub projects_total: Option<u64>,
    pub boards: Vec<BoardCandidate>,
    pub issues_scan_complete: bool,
    pub issues_scanned: usize,
    pub issue_candidates: Vec<IssueCandidate>,
    pub checked_feature_ids: Vec<String>,
    pub remote_writes_performed: bool,
    pub automatic_creation_allowed: bool,
}
fn parse_boards(
    raw: &str,
    repo: &str,
    owner: &str,
) -> Result<(Vec<BoardCandidate>, bool, u64), String> {
    let v = json(raw)?;
    let list = v
        .get("projects")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "GitHub-Projects-Liste fehlt.".to_string())?;
    let total = v
        .get("totalCount")
        .and_then(|x| x.as_u64())
        .ok_or_else(|| "GitHub-Projects-Gesamtzahl fehlt.".to_string())?;
    let mut boards = Vec::new();
    let mut seen = BTreeSet::new();
    for p in list.iter().take(MAX_PROJECTS) {
        let Some(number) = p.get("number").and_then(|x| x.as_u64()) else {
            continue;
        };
        let Some(title) = p.get("title").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(id) = p.get("id").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(url) = p.get("url").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(public) = p.get("public").and_then(|x| x.as_bool()) else {
            continue;
        };
        let Some(closed) = p.get("closed").and_then(|x| x.as_bool()) else {
            continue;
        };
        let same_owner = p
            .pointer("/owner/login")
            .and_then(|x| x.as_str())
            .is_some_and(|x| x.eq_ignore_ascii_case(owner));
        if !same_owner
            || number == 0
            || !safe_name(title)
            || id.len() > 150
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
            || !seen.insert(number)
        {
            continue;
        }
        let user_url = format!("https://github.com/users/{owner}/projects/{number}");
        let org_url = format!("https://github.com/orgs/{owner}/projects/{number}");
        if !url.eq_ignore_ascii_case(&user_url) && !url.eq_ignore_ascii_case(&org_url) {
            continue;
        }
        // Description matching is ONLY a candidate hint, not verified membership.
        let desc = p
            .get("shortDescription")
            .and_then(|x| x.as_str())
            .unwrap_or("");
        let readme = p.get("readme").and_then(|x| x.as_str()).unwrap_or("");
        let repo_name = repo.split_once('/').map(|(_, n)| n).unwrap_or("");
        let related = readme.to_lowercase().contains(&repo.to_lowercase())
            || desc.to_lowercase().contains(&repo.to_lowercase())
            || !repo_name.is_empty() && title.to_lowercase().contains(&repo_name.to_lowercase());
        boards.push(BoardCandidate {
            number,
            title: title.into(),
            url: url.into(),
            public,
            closed,
            possible_repo_match: related,
            provider_id: id.into(),
        });
    }
    // Never conclude that a board is absent from incomplete or denied discovery.
    let complete = (list.len() as u64) >= total && list.len() <= MAX_PROJECTS;
    Ok((boards, complete, total))
}
fn issue_marker(body: &str, id: &str) -> bool {
    let backtick = char::from(96);
    let expected = format!("**Feature ID:** {backtick}{id}{backtick}");
    let plain = format!("Feature ID: {id}");
    body.lines()
        .take(100)
        .any(|line| line.trim() == expected || line.trim() == plain)
}
fn parse_issues(
    raw: &str,
    repo: &str,
    features: &[String],
) -> Result<(Vec<IssueCandidate>, bool), String> {
    let v = json(raw)?;
    let list = v
        .as_array()
        .ok_or_else(|| "GitHub-Issue-Liste fehlt.".to_string())?;
    let mut found = BTreeSet::new();
    let mut candidates = Vec::new();
    for issue in list.iter().take(ISSUES_PER_PAGE) {
        if issue.get("pull_request").is_some() {
            continue;
        }
        let Some(number) = issue.get("number").and_then(|x| x.as_u64()) else {
            continue;
        };
        let Some(title) = issue.get("title").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(url) = issue.get("html_url").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(state) = issue.get("state").and_then(|x| x.as_str()) else {
            continue;
        };
        if number == 0
            || !safe_name(title)
            || !matches!(state, "open" | "closed")
            || url != format!("https://github.com/{repo}/issues/{number}")
        {
            continue;
        }
        let body = issue.get("body").and_then(|x| x.as_str()).unwrap_or("");
        for feature in features {
            if issue_marker(body, feature) && found.insert((feature.clone(), number)) {
                candidates.push(IssueCandidate {
                    feature_id: feature.clone(),
                    number,
                    title: title.into(),
                    url: url.into(),
                    state: state.into(),
                });
            }
        }
    }
    Ok((candidates, list.len() < ISSUES_PER_PAGE))
}
pub(crate) async fn discover_registered_repo(
    project_id: &str,
    root: &Path,
    feature_ids: Vec<String>,
) -> Result<GithubKickoffDiscovery, String> {
    let mut ids = BTreeSet::new();
    if project_id.is_empty()
        || feature_ids.len() > MAX_FEATURES
        || !feature_ids
            .iter()
            .all(|s| safe_feature(s) && ids.insert(s.clone()))
    {
        return Err("Feature-Auswahl ungültig.".into());
    }
    let canonical = root
        .canonicalize()
        .map_err(|_| "Projektordner ist nicht erreichbar.".to_string())?;
    let observed_root = git(&canonical, &["rev-parse", "--show-toplevel"]).await?;
    if Path::new(observed_root.trim()).canonicalize().ok() != Some(canonical.clone()) {
        return Err("Git-Wurzel stimmt nicht mit registriertem Projekt überein.".into());
    }
    let head = git(&canonical, &["rev-parse", "HEAD"])
        .await?
        .trim()
        .to_string();
    if !matches!(head.len(), 40 | 64) || !head.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Git-HEAD ist ungültig.".into());
    }
    let remote = git(&canonical, &["remote", "get-url", "origin"]).await?;
    let repo = github_repo_from_remote(&remote)
        .ok_or_else(|| "Nur registrierte github.com-Repositories werden abgefragt.".to_string())?;
    let endpoint = format!("repos/{repo}");
    let answer = run_readonly("gh", &["api", "-X", "GET", &endpoint], 15, MAX_RESPONSE).await?;
    let facts = repo_facts(&answer, &repo)?;
    // Explicit bounded pagination. GitHub's issue endpoint includes pull
    // requests; exclude them and don't claim absence until the final page.
    // A full page at the last configured limit is ALWAYS incomplete.
    let mut issues = Vec::new();
    let mut seen_candidates = BTreeSet::new();
    let mut issues_scanned = 0usize;
    let mut issues_complete = false;
    for page in 1..=MAX_ISSUE_PAGES {
        let endpoint =
            format!("repos/{repo}/issues?state=all&per_page={ISSUES_PER_PAGE}&page={page}");
        let body = run_readonly("gh", &["api", "-X", "GET", &endpoint], 15, MAX_RESPONSE).await?;
        let values = json(&body)?;
        let page_items = values
            .as_array()
            .ok_or_else(|| "GitHub-Issue-Seite ist ungültig.".to_string())?;
        if page_items.len() > ISSUES_PER_PAGE {
            return Err("GitHub-Issue-Seite überschreitet das Limit.".into());
        }
        issues_scanned += page_items.len();
        if issues_scanned > MAX_ISSUES {
            return Err("Die GitHub-Issue-Prüfung überschritt ihre Obergrenze.".into());
        }
        let (found, _) = parse_issues(&body, &repo, &feature_ids)?;
        for candidate in found {
            if seen_candidates.insert((candidate.feature_id.clone(), candidate.number)) {
                issues.push(candidate);
            }
        }
        if page_items.len() < ISSUES_PER_PAGE {
            issues_complete = true;
            break;
        }
    }
    let owner = repo.split('/').next().unwrap_or("");
    let max = MAX_PROJECTS.to_string();
    let board_response = run_readonly(
        "gh",
        &[
            "project", "list", "--owner", owner, "--format", "json", "--limit", &max,
        ],
        18,
        MAX_RESPONSE,
    )
    .await;
    let (boards, projects_status, projects_complete, projects_total) = match board_response {
        Ok(body) => match parse_boards(&body, &repo, owner) {
            Ok((boards, complete, total)) => (boards, "read", complete, Some(total)),
            Err(_) => (Vec::new(), "unavailable", false, None),
        },
        Err(_) => (Vec::new(), "unavailable", false, None),
    };
    if git(&canonical, &["rev-parse", "HEAD"]).await?.trim() != head
        || git(&canonical, &["remote", "get-url", "origin"])
            .await?
            .trim()
            != remote.trim()
    {
        return Err("Projektidentität änderte sich während der GitHub-Abfrage.".into());
    }
    Ok(GithubKickoffDiscovery {
        project_id: project_id.into(),
        repository: facts,
        observed_git_head: head,
        auth_source: "existing_local_gh_cli",
        projects_status,
        projects_scan_complete: projects_complete,
        projects_total,
        boards,
        issues_scan_complete: issues_complete,
        issues_scanned,
        issue_candidates: issues,
        checked_feature_ids: feature_ids,
        remote_writes_performed: false,
        automatic_creation_allowed: false,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repository_response_requires_identity_and_known_visibility() {
        let raw =
            r#"{"full_name":"NMKato/KatoSync","private":false,"archived":false,"has_issues":true}"#;
        assert_eq!(
            repo_facts(raw, "NMKato/KatoSync").unwrap().visibility,
            "public"
        );
        assert!(repo_facts(raw, "NMKato/Other").is_err());
        assert!(repo_facts(r#"{"full_name":"NMKato/KatoSync"}"#, "NMKato/KatoSync").is_err());
    }
    #[test]
    fn board_hints_are_candidates_only_and_pagination_is_explicit() {
        let s = r#"{"totalCount":3,"projects":[
           {"id":"PVT_ABC","number":10,"title":"KatoSync Board","public":false,"closed":false,
            "url":"https://github.com/users/NMKato/projects/10","owner":{"login":"NMKato"},
            "shortDescription":"","readme":"repo NMKato/KatoSync"},
           {"id":"PVT_DEF","number":9,"title":"Other","public":true,"closed":false,
            "url":"https://github.com/users/NMKato/projects/9","owner":{"login":"NMKato"}}
        ]}"#;
        let (boards, complete, total) = parse_boards(s, "NMKato/KatoSync", "NMKato").unwrap();
        assert_eq!(total, 3);
        assert!(!complete);
        assert_eq!(boards.len(), 2);
        assert!(boards[0].possible_repo_match);
        assert!(!boards[1].possible_repo_match);
    }
    #[test]
    fn issue_marker_is_exact_and_prs_are_excluded() {
        let marker = format!(
            "**Feature ID:** {}MVP-ONE{}",
            char::from(96),
            char::from(96)
        );
        let raw=serde_json::json!([
            {"number":12,"title":"MVP Task","state":"open",
             "html_url":"https://github.com/NMKato/KatoSync/issues/12","body":marker},
            {"number":13,"title":"PR","state":"open",
             "html_url":"https://github.com/NMKato/KatoSync/issues/13","body":marker,"pull_request":{}},
            {"number":14,"title":"Foreign","state":"open",
             "html_url":"https://github.com/other/Repo/issues/14","body":marker}
        ]).to_string();
        let (out, complete) = parse_issues(&raw, "NMKato/KatoSync", &["MVP-ONE".into()]).unwrap();
        assert!(complete);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].number, 12);
    }
    #[test]
    fn exact_100_issue_page_is_not_full_repo_inventory() {
        let all: Vec<serde_json::Value> = (1..=100)
            .map(|n| {
                serde_json::json!({
                    "number":n,"title":format!("Issue {n}"),"state":"open",
                    "html_url":format!("https://github.com/NMKato/KatoSync/issues/{n}"),
                    "body":"Feature ID: TRACK-1"
                })
            })
            .collect();
        let (found, complete) = parse_issues(
            &serde_json::to_string(&all).unwrap(),
            "NMKato/KatoSync",
            &["TRACK-1".into()],
        )
        .unwrap();
        assert_eq!(found.len(), 100);
        assert!(!complete, "a full page must request the next page");
        assert_eq!(MAX_ISSUES, 400);
        let (_, short_complete) = parse_issues(
            &serde_json::to_string(&all[..9]).unwrap(),
            "NMKato/KatoSync",
            &["TRACK-1".into()],
        )
        .unwrap();
        assert!(short_complete);
    }

    #[tokio::test]
    #[ignore = "Manual live GitHub CLI check: existing login and internet required; read-only"]
    async fn manual_registered_github_inventory_read_only_smoke() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let result = discover_registered_repo("katosync-smoke", root, vec!["TASK-ONE".into()])
            .await
            .unwrap();
        assert_eq!(result.repository.full_name, "NMKato/KatoSync");
        assert_eq!(result.auth_source, "existing_local_gh_cli");
        assert!(!result.remote_writes_performed);
        assert!(!result.automatic_creation_allowed);
        assert_eq!(result.checked_feature_ids, vec!["TASK-ONE"]);
        assert!(result.projects_status == "read" || result.projects_status == "unavailable");
    }
    #[test]
    fn feature_id_validation_rejects_path_or_query() {
        for id in ["F:1", "MVP-1", "task_2", "module.v2"] {
            assert!(safe_feature(id));
        }
        for id in ["", "../../..", "@owner/repo", "one two", "feature?x=1"] {
            assert!(!safe_feature(id));
        }
    }
}
