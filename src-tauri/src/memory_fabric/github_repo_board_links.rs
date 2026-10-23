// Created by NMKato Solutions
//! Provider-attested repository → Projects v2 links, read-only, bounded.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, process::Stdio};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};

const QUERY: &str = r#"query($owner:String!,$name:String!,$after:String){
 repository(owner:$owner,name:$name){
  nameWithOwner
  projectsV2(first:50,after:$after){
    totalCount
    nodes{id number title url owner{__typename ... on User{login} ... on Organization{login}}}
    pageInfo{hasNextPage endCursor}
  }
 }
}"#;
const MAX_PAGES: usize = 4;
const PER_PAGE: usize = 50;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkedGithubBoard {
    pub provider_id: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub owner: String,
    pub ownership_type: &'static str,
    /// True ONLY for returned repository.projectsV2 provider link.
    pub repository_link_verified: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoBoardLinkReport {
    pub status: &'static str,
    pub linked_boards: Vec<LinkedGithubBoard>,
    pub provider_total: Option<u64>,
    pub pages_scanned: usize,
    pub provider_source: &'static str,
    pub remote_writes_performed: bool,
}
#[derive(Deserialize)]
struct Response {
    data: Option<Data>,
    errors: Option<serde_json::Value>,
}
#[derive(Deserialize)]
struct Data {
    repository: Option<Repository>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
    projects_v2: ProjectConnection,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectConnection {
    total_count: u64,
    nodes: Vec<Option<Project>>,
    page_info: PageInfo,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}
#[derive(Deserialize)]
struct Project {
    id: String,
    number: u64,
    title: String,
    url: String,
    owner: ProjectOwner,
}
#[derive(Deserialize)]
struct ProjectOwner {
    #[serde(rename = "__typename")]
    typename: String,
    login: String,
}
fn validate_project(project: &Project) -> Option<LinkedGithubBoard> {
    if project.number == 0
        || project.id.len() < 5
        || project.id.len() > 150
        || !project
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        || project.title.trim().is_empty()
        || project.title.chars().count() > 180
        || project.title.chars().any(|c| c.is_control())
        || project.owner.login.is_empty()
        || project.owner.login.len() > 100
        || !project
            .owner
            .login
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return None;
    }
    let prefix = match project.owner.typename.as_str() {
        "User" => "users",
        "Organization" => "orgs",
        _ => return None,
    };
    let exact = format!(
        "https://github.com/{prefix}/{}/projects/{}",
        project.owner.login, project.number
    );
    if !project.url.eq_ignore_ascii_case(&exact) {
        return None;
    }
    Some(LinkedGithubBoard {
        provider_id: project.id.clone(),
        number: project.number,
        title: project.title.clone(),
        url: exact,
        owner: project.owner.login.clone(),
        ownership_type: if prefix == "users" {
            "user"
        } else {
            "organization"
        },
        repository_link_verified: true,
    })
}
fn parse_page(body: &str, repo: &str) -> Result<ProjectConnection, String> {
    if body.len() > 1024 * 1024 {
        return Err("GraphQL-Antwort überschreitet Größenlimit.".into());
    }
    let envelope: Response =
        serde_json::from_str(body).map_err(|_| "GraphQL-Antwort ungültig.".to_string())?;
    if envelope.errors.is_some() {
        return Err("GitHub Projects GraphQL nicht lesbar oder unberechtigt.".into());
    }
    let repository = envelope
        .data
        .and_then(|d| d.repository)
        .ok_or_else(|| "Repository in GraphQL nicht sichtbar.".to_string())?;
    if !repository.name_with_owner.eq_ignore_ascii_case(repo) {
        return Err("GraphQL-Repositoryidentität stimmt nicht überein.".into());
    }
    if repository.projects_v2.nodes.len() > PER_PAGE {
        return Err("GraphQL-Seite überschreitet 50 Einträge.".into());
    }
    let page = &repository.projects_v2.page_info;
    if page.has_next_page
        && !page.end_cursor.as_deref().is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 300
                && s.bytes().all(|b| {
                    b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'=' | b'-' | b'_')
                })
        })
    {
        return Err("GraphQL-Pagination-Cursor fehlt oder ist ungültig.".into());
    }
    Ok(repository.projects_v2)
}
fn unavailable() -> RepoBoardLinkReport {
    RepoBoardLinkReport {
        status: "unavailable",
        linked_boards: vec![],
        provider_total: None,
        pages_scanned: 0,
        provider_source: "github_repository_projects_v2_graphql",
        remote_writes_performed: false,
    }
}
/// Network request is explicit user-triggered, never on page load or by an LLM.
/// Existing machine gh auth only; no token changes or GitHub App impersonation.
pub(crate) async fn check_repo_links(repo: &str) -> RepoBoardLinkReport {
    let Some((owner, name)) = repo.split_once('/') else {
        return unavailable();
    };
    let valid = |s: &str| {
        !s.is_empty()
            && s.len() <= 100
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    };
    if !valid(owner) || !valid(name) {
        return unavailable();
    }
    let mut found = Vec::new();
    let mut seen = BTreeSet::new();
    let mut previous_cursors = BTreeSet::new();
    let mut cursor: Option<String> = None;
    let mut pages = 0usize;
    let mut total: Option<u64> = None;
    for _ in 0..MAX_PAGES {
        let mut args = vec![
            "api".to_string(),
            "graphql".into(),
            "-f".into(),
            format!("query={QUERY}"),
            "-f".into(),
            format!("owner={owner}"),
            "-f".into(),
            format!("name={name}"),
        ];
        if let Some(value) = &cursor {
            args.push("-f".into());
            args.push(format!("after={value}"));
        }
        let mut command = Command::new("gh");
        command
            .args(&args)
            .env("GH_HOST", "github.com")
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_PAGER", "cat")
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .kill_on_drop(true);
        let response = match timeout(Duration::from_secs(12), command.output()).await {
            Ok(Ok(output)) if output.status.success() && output.stdout.len() <= 1024 * 1024 => {
                String::from_utf8(output.stdout).ok()
            }
            _ => None,
        };
        let Some(raw) = response else {
            return RepoBoardLinkReport {
                status: "unavailable",
                linked_boards: vec![],
                provider_total: None,
                pages_scanned: pages,
                provider_source: "github_repository_projects_v2_graphql",
                remote_writes_performed: false,
            };
        };
        let Ok(connection) = parse_page(&raw, repo) else {
            return RepoBoardLinkReport {
                status: "unavailable",
                linked_boards: vec![],
                provider_total: None,
                pages_scanned: pages,
                provider_source: "github_repository_projects_v2_graphql",
                remote_writes_performed: false,
            };
        };
        pages += 1;
        if let Some(current) = total {
            if current != connection.total_count {
                return unavailable();
            }
        } else {
            total = Some(connection.total_count);
        }
        for entry in &connection.nodes {
            let Some(project) = entry else {
                return unavailable();
            };
            let Some(verified) = validate_project(project) else {
                return unavailable();
            };
            if !seen.insert(verified.provider_id.clone()) {
                return unavailable();
            }
            found.push(verified);
        }
        if !connection.page_info.has_next_page {
            // Avoid false "complete" when provider claims more than returned
            // or contradictory totals (e.g. insufficient scope).
            let complete = found.len() as u64 == connection.total_count;
            return RepoBoardLinkReport {
                status: if complete { "verified" } else { "partial" },
                linked_boards: found,
                provider_total: total,
                pages_scanned: pages,
                provider_source: "github_repository_projects_v2_graphql",
                remote_writes_performed: false,
            };
        }
        let next = connection.page_info.end_cursor.unwrap_or_default();
        if !previous_cursors.insert(next.clone()) {
            return unavailable();
        }
        cursor = Some(next);
    }
    RepoBoardLinkReport {
        status: "partial",
        linked_boards: found,
        provider_total: total,
        pages_scanned: pages,
        provider_source: "github_repository_projects_v2_graphql",
        remote_writes_performed: false,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn page(owner: &str, sha_id: &str, total: usize, has_next: bool) -> String {
        serde_json::json!({"data":{"repository":{
        "nameWithOwner":"NMKato/KatoSync","projectsV2":{
            "totalCount":total,"nodes":[{
              "id":sha_id,"number":12,"title":"KatoSync Board",
              "url":format!("https://github.com/users/{owner}/projects/12"),
              "owner":{"__typename":"User","login":owner}
            }],
            "pageInfo":{"hasNextPage":has_next,"endCursor":if has_next{Some("MQ")}else{None}}
        }}}})
        .to_string()
    }
    #[test]
    fn repo_identity_and_url_are_attested_not_guessed() {
        let parsed = parse_page(&page("NMKato", "PVT_1234", 1, false), "NMKato/KatoSync").unwrap();
        assert_eq!(parsed.total_count, 1);
        assert!(
            validate_project(parsed.nodes[0].as_ref().unwrap())
                .unwrap()
                .repository_link_verified
        );
        assert!(parse_page(&page("NMKato", "PVT_1234", 1, false), "Other/Repo").is_err());
        let injected = page("NMKato", "PVT_1234", 1, false).replace(
            "https://github.com/users/NMKato/projects/12",
            "https://evil.example/foo",
        );
        let p = parse_page(&injected, "NMKato/KatoSync").unwrap();
        assert!(validate_project(p.nodes[0].as_ref().unwrap()).is_none());
    }
    #[tokio::test]
    #[ignore = "Manual read-only GraphQL against registered repo; requires gh auth"]
    async fn manual_live_repo_project_link_from_github() {
        let result = check_repo_links("NMKato/KatoSync").await;
        assert_eq!(result.status, "verified", "GraphQL must be accessible");
        assert!(result
            .linked_boards
            .iter()
            .all(|p| p.repository_link_verified));
        assert!(
            result.linked_boards.iter().any(|p| p.number == 12),
            "existing registered KatoSync board #12 should be linked"
        );
        assert!(!result.remote_writes_performed);
    }
    #[test]
    fn graph_ql_errors_and_invalid_pagination_fail_closed() {
        let bad = r#"{"data":{"repository":null},"errors":[{"message":"permission denied"}]}"#;
        assert!(parse_page(bad, "NMKato/KatoSync").is_err());
        let query = page("NMKato", "PVT_1234", 2, true).replace("\"MQ\"", "\"../../secret\"");
        assert!(parse_page(&query, "NMKato/KatoSync").is_err());
        let s = page("NMKato", "PVT_1234", 2, true);
        assert!(parse_page(&s, "NMKato/KatoSync").is_ok());
    }
}
