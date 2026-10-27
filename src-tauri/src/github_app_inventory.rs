// Created by NMKato Solutions
//! Read-only GitHub App user-to-server inventory. Never accepts a URL,
//! client ID, bearer token or arbitrary HTTP method from the frontend.
//! Credentials remain only in the OS keychain and native process memory.
use super::*;
use serde::de::DeserializeOwned;

const MAX_INSTALLATIONS: usize = 4;
const MAX_REPOS_PER_INSTALLATION: usize = 50;
const MAX_ISSUES: usize = 30;
const MAX_ISSUE_PAGES: u32 = 10; // explicit bounded paging, never an unbounded background crawl
fn valid_issue_page(page: u32) -> bool {
    (1..=MAX_ISSUE_PAGES).contains(&page)
}

#[derive(Deserialize)]
struct InstallationsResponse {
    total_count: u64,
    installations: Vec<Installation>,
}
#[derive(Deserialize)]
struct Installation {
    id: u64,
}
#[derive(Deserialize)]
struct RepositoriesResponse {
    total_count: u64,
    repositories: Vec<ApiRepository>,
}
#[derive(Deserialize)]
struct ApiRepository {
    full_name: String,
    #[serde(default)]
    private: bool,
    #[serde(default)]
    archived: bool,
}
#[derive(Deserialize)]
struct ApiIssue {
    number: u64,
    title: String,
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubRepository {
    full_name: String,
    url: String,
    private: bool,
    archived: bool,
    installation_id: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubInventory {
    repositories: Vec<GithubRepository>,
    installation_count: usize,
    truncated: bool,
    auth_source: &'static str,
    remote_writes_performed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GithubOpenIssues {
    full_name: String,
    issues: Vec<GithubIssue>,
    truncated: bool,
    remote_writes_performed: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GithubIssue {
    number: u64,
    title: String,
    url: String,
}

fn valid_full_name(full_name: &str) -> bool {
    let mut parts = full_name.split('/');
    let (Some(owner), Some(repo), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    safe_login(owner)
        && (1..=100).contains(&repo.len())
        && repo != "."
        && repo != ".."
        && repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}
fn repo_url(full_name: &str) -> Option<String> {
    valid_full_name(full_name).then(|| format!("https://github.com/{full_name}"))
}
async fn read_credential(uid: &str) -> Result<Credential, String> {
    let record = ensure_fresh_github_credentials(uid)
        .await?
        .ok_or("GitHub-App noch nicht verbunden. Bitte über Provider verbinden.")?;
    if record.katosync_uid != uid
        || Some(record.client_id.as_str()) != client_id()
        || record.user_id == 0
        || !safe_login(&record.login)
        || record.expires_at <= now_secs() + 15
    {
        return Err("GitHub-Sitzung abgelaufen. Bitte die App-Verbindung erneuern.".into());
    }
    Ok(record)
}
async fn same_account_and_credential(uid: &str, token: &str) -> Result<(), String> {
    if verified_katosync_user().await? != uid {
        return Err("KatoSync-Konto während des GitHub-Abrufs gewechselt.".into());
    }
    let current = credentials(uid)?.ok_or("GitHub-App-Verbindung während Abruf entfernt.")?;
    if !owned_credential(&current, uid) || current.access_token != token {
        return Err("GitHub-Autorisierung während des Abrufs gewechselt.".into());
    }
    Ok(())
}
async fn github_read<T: DeserializeOwned>(
    http: &reqwest::Client,
    token: &str,
    path: &str,
) -> Result<T, String> {
    // Callers construct the only allowed fixed GitHub REST paths. No redirects.
    let response = http
        .get(format!("https://api.github.com{path}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2026-03-10")
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "GitHub API derzeit nicht erreichbar.".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 => "GitHub-App-Sitzung ungültig oder abgelaufen. Bitte neu verbinden.",
            403 => "GitHub-App hat für diese Ressource keine Leseberechtigung oder das API-Limit ist erreicht.",
            404 => "GitHub-App hat keinen Zugriff auf dieses Repository.",
            _ => "GitHub konnte die Lesedaten nicht bereitstellen.",
        }
        .into());
    }
    response
        .json()
        .await
        .map_err(|_| "GitHub hat unerwartete Metadaten zurückgegeben.".into())
}

async fn installations(
    http: &reqwest::Client,
    token: &str,
) -> Result<InstallationsResponse, String> {
    github_read(http, token, "/user/installations?per_page=100&page=1").await
}
async fn installation_repos(
    http: &reqwest::Client,
    token: &str,
    installation_id: u64,
) -> Result<RepositoriesResponse, String> {
    if installation_id == 0 {
        return Err("Ungültige GitHub-Installation.".into());
    }
    github_read(
        http,
        token,
        &format!(
            "/user/installations/{installation_id}/repositories?per_page={MAX_REPOS_PER_INSTALLATION}&page=1"
        ),
    )
    .await
}

/// Explicit, bounded read-only listing; never writes credentials, files or GitHub objects.
#[tauri::command]
pub(crate) async fn github_app_repository_inventory() -> Result<GithubInventory, String> {
    let uid = verified_katosync_user().await?;
    let mut credential = read_credential(&uid).await?;
    let http = network()?;
    let accessible = installations(&http, &credential.access_token).await?;
    let truncated_installations =
        accessible.total_count as usize > accessible.installations.len().min(MAX_INSTALLATIONS);
    let mut repositories = Vec::new();
    let mut truncated = truncated_installations;
    for installation in accessible.installations.iter().take(MAX_INSTALLATIONS) {
        let response = installation_repos(&http, &credential.access_token, installation.id).await?;
        truncated |= response.total_count as usize > response.repositories.len();
        for repo in response.repositories {
            if let Some(url) = repo_url(&repo.full_name) {
                repositories.push(GithubRepository {
                    full_name: repo.full_name,
                    url,
                    private: repo.private,
                    archived: repo.archived,
                    installation_id: installation.id,
                });
            }
        }
    }
    repositories.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    repositories.dedup_by(|a, b| a.full_name == b.full_name);
    same_account_and_credential(&uid, &credential.access_token).await?;
    credential.access_token.zeroize();
    Ok(GithubInventory {
        repositories,
        installation_count: accessible.installations.len().min(MAX_INSTALLATIONS),
        truncated,
        auth_source: "github_app_user_access_token",
        remote_writes_performed: false,
    })
}

/// A repo must be rediscovered in a user-authorized App installation before
/// requesting issue titles. No arbitrary repository/API URL is trusted.
#[tauri::command]
pub(crate) async fn github_app_repo_issues(
    full_name: String,
    installation_id: u64,
    page: u32,
) -> Result<GithubOpenIssues, String> {
    if !valid_full_name(&full_name) || installation_id == 0 || !valid_issue_page(page) {
        return Err("Ungültiger Repository-Name, Installation oder Seitenbereich.".into());
    }
    let uid = verified_katosync_user().await?;
    let credential = read_credential(&uid).await?;
    let http = network()?;
    let accessible = installations(&http, &credential.access_token).await?;
    if !accessible
        .installations
        .iter()
        .any(|record| record.id == installation_id)
    {
        return Err("Diese GitHub-Installation gehört nicht zur angemeldeten Person.".into());
    }
    let repositories = installation_repos(&http, &credential.access_token, installation_id).await?;
    if !repositories
        .repositories
        .iter()
        .any(|repo| repo.full_name == full_name && valid_full_name(&repo.full_name))
    {
        return Err("Repository ist nicht im autorisierten App-Ausschnitt enthalten.".into());
    }
    let api_issues: Vec<ApiIssue> = github_read(
        &http,
        &credential.access_token,
        &format!("/repos/{full_name}/issues?state=open&per_page={MAX_ISSUES}&page={page}"),
    )
    .await?;
    let truncated = api_issues.len() == MAX_ISSUES;
    let issues = api_issues
        .into_iter()
        .filter(|issue| issue.pull_request.is_none() && issue.number > 0)
        .take(MAX_ISSUES)
        .map(|issue| GithubIssue {
            number: issue.number,
            title: issue.title.chars().take(300).collect(),
            url: format!("https://github.com/{full_name}/issues/{}", issue.number),
        })
        .collect();
    same_account_and_credential(&uid, &credential.access_token).await?;
    Ok(GithubOpenIssues {
        full_name,
        issues,
        truncated,
        remote_writes_performed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_bounded_issue_pages_allowed() {
        assert!(valid_issue_page(1));
        assert!(valid_issue_page(10));
        assert!(!valid_issue_page(0));
        assert!(!valid_issue_page(11));
        assert!(!valid_issue_page(u32::MAX));
    }
    #[test]
    fn only_owner_repo_slugs_allowed() {
        assert!(valid_full_name("NMKato/KatoSync"));
        assert!(valid_full_name("owner/repo.with-hyphens_01"));
        for bad in [
            "",
            "evil",
            "/name",
            "owner/",
            "owner/../../evil",
            "owner/repo?x=a",
            "owner/repo#fragment",
            "evil.com/repo/extra",
            "owner/%2F",
            "owner/..",
            "owner/.",
        ] {
            assert!(!valid_full_name(bad), "{bad}");
        }
        assert_eq!(
            repo_url("NMKato/KatoSync").as_deref(),
            Some("https://github.com/NMKato/KatoSync")
        );
    }
    #[test]
    fn inventory_struct_never_contains_bearer_token_field() {
        let info = GithubInventory {
            repositories: vec![],
            installation_count: 0,
            truncated: false,
            auth_source: "github_app_user_access_token",
            remote_writes_performed: false,
        };
        let json = serde_json::to_string(&info).unwrap();
        assert!(!json.contains("accessToken"));
        assert!(!json.contains("refreshToken"));
        assert!(json.contains("\"remoteWritesPerformed\":false"));
    }
}
