// Created by NMKato Solutions
// Secure Beta Check read-only GitHub adapter. Uses a user's existing gh CLI auth.
// Never accepts arbitrary executable, GitHub owner/repo, token or shell expression from the UI.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

const MAX_PROJECTS: usize = 8;
const MAX_RESPONSE_BYTES: usize = 256 * 1024;
const GH_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubIssueBatch {
    remote: String,
    issues: Vec<Value>,
    error: Option<&'static str>,
}

fn github_repo(remote: &str) -> Option<String> {
    let source = remote.trim();
    let rest = source
        .strip_prefix("https://github.com/")
        .or_else(|| source.strip_prefix("git@github.com:"))
        .or_else(|| source.strip_prefix("ssh://git@github.com/"))?;
    let rest = rest
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(rest.trim_end_matches('/'));
    let (owner, repo) = rest.split_once('/')?;
    if owner.is_empty()
        || owner.len() > 39
        || repo.is_empty()
        || repo.len() > 100
        || repo == "."
        || repo == ".."
        || repo.starts_with('.')
        || !owner
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !repo
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return None;
    }
    Some(format!("{owner}/{repo}"))
}

fn selected_repos(registry: &Value, project_ids: &[String]) -> Result<Vec<String>, &'static str> {
    if project_ids.is_empty() || project_ids.len() > MAX_PROJECTS {
        return Err("Bitte 1 bis 8 registrierte Projekte auswaehlen.");
    }
    let registered = registry
        .get("projects")
        .and_then(Value::as_array)
        .ok_or("Projekt-Registry nicht lesbar. Bitte zuerst Projekte scannen.")?;
    let mut repos = Vec::new();
    let mut seen = HashSet::new();
    let mut used_ids = HashSet::new();
    for id in project_ids {
        if id.is_empty() || !used_ids.insert(id.as_str()) {
            return Err("Doppelte oder ungueltige Projektauswahl.");
        }
        let found = registered
            .iter()
            .find(|entry| entry.get("id").and_then(Value::as_str) == Some(id.as_str()))
            .ok_or("Projekt ist nicht mehr in der Registry. Bitte erneut scannen.")?;
        let remote = found
            .get("remote")
            .and_then(Value::as_str)
            .ok_or("Projekt hat keinen GitHub-Remote.")?;
        let repo = github_repo(remote).ok_or("Projekt hat keinen gueltigen GitHub-Remote.")?;
        if seen.insert(repo.to_ascii_lowercase()) {
            repos.push(repo);
        }
    }
    Ok(repos)
}

fn gh_executable() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        for path in ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"] {
            if std::path::Path::new(path).is_file() {
                return if path == "/opt/homebrew/bin/gh" {
                    "/opt/homebrew/bin/gh"
                } else {
                    "/usr/local/bin/gh"
                };
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        return "gh.exe";
    }
    #[cfg(not(target_os = "windows"))]
    {
        "gh"
    }
}

async fn read_issues(repo: String) -> GithubIssueBatch {
    let mut response = GithubIssueBatch {
        remote: format!("https://github.com/{repo}"),
        issues: Vec::new(),
        error: None,
    };
    let mut command = Command::new(gh_executable());
    command
        .args([
            "issue",
            "list",
            "--repo",
            repo.as_str(),
            "--state",
            "open",
            "--limit",
            "100",
            "--json",
            "number,title,url,updatedAt,state,labels",
        ])
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let result = timeout(GH_TIMEOUT, command.output()).await;
    match result {
        Err(_) => response.error = Some("GitHub-Abruf hat zu lange gedauert. Verbindung pruefen."),
        Ok(Err(_)) => {
            response.error =
                Some("GitHub CLI nicht gefunden oder nicht startbar. Bitte gh installieren.")
        }
        Ok(Ok(output)) if !output.status.success() => {
            response.error =
                Some("GitHub-Abruf fehlgeschlagen. Bitte gh auth status und Repo-Zugriff pruefen.");
        }
        Ok(Ok(output)) if output.stdout.len() > MAX_RESPONSE_BYTES => {
            response.error = Some("GitHub-Antwort ist zu gross. Abruf abgebrochen.");
        }
        Ok(Ok(output)) => match serde_json::from_slice::<Value>(&output.stdout) {
            Ok(Value::Array(issues)) if issues.len() <= 100 => response.issues = issues,
            _ => response.error = Some("GitHub-Antwort ist kein gueltiger Issue-Datensatz."),
        },
    }
    response
}

/// No workspace writes, no GitHub mutations, no token access or execution from issue content.
/// Explicit selection must match IDs in the locally persisted Project Registry.
#[tauri::command]
pub async fn github_issue_inbox_read(
    project_ids: Vec<String>,
) -> Result<Vec<GithubIssueBatch>, String> {
    let registry = crate::project_registry::project_registry_load()
        .map_err(|_| "Projekt-Registry ist nicht verfuegbar.".to_string())?
        .ok_or("Keine Projekte registriert. Bitte zuerst Projekte hinzufuegen.")?;
    let repos = selected_repos(&registry, &project_ids).map_err(str::to_string)?;
    let mut batches = Vec::with_capacity(repos.len());
    for repo in repos {
        batches.push(read_issues(repo).await);
    }
    Ok(batches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn accepts_only_safe_github_remotes() {
        assert_eq!(
            github_repo("https://github.com/NMKato/KatoSync.git"),
            Some("NMKato/KatoSync".into())
        );
        assert_eq!(
            github_repo("git@github.com:NMKato/KatoSync.git"),
            Some("NMKato/KatoSync".into())
        );
        assert_eq!(
            github_repo("ssh://git@github.com/NMKato/KatoSync"),
            Some("NMKato/KatoSync".into())
        );
        for input in [
            "https://evil.com/u/r",
            "https://github.com/u/r/another",
            "https://u:token@github.com/u/r",
            "https://github.com/u/../x",
            "https://github.com/u/x?foo=1",
            "file:///etc/passwd",
            "https://github.com/u/-repo;echo",
            "",
        ] {
            assert!(github_repo(input).is_none(), "{input}");
        }
    }
    #[test]
    fn only_selected_registered_project_repos_are_readable() {
        let registry = json!({"projects":[
            {"id":"a","remote":"https://github.com/NMKato/KatoSync.git"},
            {"id":"b","remote":"git@github.com:NMKato/KatoOS-Website.git"},
            {"id":"c","remote":"https://gitlab.com/other/repo"}]});
        assert_eq!(
            selected_repos(&registry, &["a".into(), "b".into()]).unwrap(),
            vec!["NMKato/KatoSync", "NMKato/KatoOS-Website"]
        );
        assert!(selected_repos(&registry, &["missing".into()]).is_err());
        assert!(selected_repos(&registry, &["c".into()]).is_err());
        assert!(selected_repos(&registry, &["a".into(), "a".into()]).is_err());
        assert!(selected_repos(&registry, &[]).is_err());
    }
}
