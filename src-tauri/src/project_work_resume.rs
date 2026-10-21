// Created by NMKato Solutions
// Registered-project-only, read-only native project context gateway.
// Input is a logical Project Registry ID, never a caller-supplied filesystem path.
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectWorkResumeProbe {
    project_id: String,
    registered_head: Option<String>,
    probe: crate::project_registry::ProjectProbe,
}

fn registered_root(registry: &Value, id: &str) -> Result<(String, Option<String>), &'static str> {
    if id.trim().is_empty() || id.len() > 160 {
        return Err("Unbekannte oder ungueltige Projekt-ID.");
    }
    let projects = registry
        .get("projects")
        .and_then(Value::as_array)
        .ok_or("Project Registry hat kein gueltiges Projektverzeichnis.")?;
    let matches = projects
        .iter()
        .filter(|p| p.get("id").and_then(Value::as_str) == Some(id))
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err("Projekt ist nicht eindeutig registriert. Bitte Registry pruefen.");
    }
    let item = matches[0];
    let root = item
        .get("rootPath")
        .and_then(Value::as_str)
        .ok_or("Kein Projektpfad registriert.")?;
    if !Path::new(root).is_absolute() {
        return Err("Projektpfad ist nicht absolut.");
    }
    let head = item
        .get("scan")
        .and_then(|v| v.get("headSha"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);
    Ok((root.to_string(), head))
}

#[tauri::command]
pub(crate) async fn project_work_resume(
    project_id: String,
) -> Result<ProjectWorkResumeProbe, String> {
    let registry = crate::project_registry::project_registry_load()?
        .ok_or("Keine Project Registry vorhanden. Bitte Projekt importieren.")?;
    let (root, registered_head) =
        registered_root(&registry, &project_id).map_err(str::to_string)?;
    let probe = tauri::async_runtime::spawn_blocking(move || {
        crate::project_registry::scan(Path::new(&root))
    })
    .await
    .map_err(|_| "Projektprüfung wurde unterbrochen.".to_string())??;
    // Do not persist scanned documents in the registry: the caller receives transient facts only.
    Ok(ProjectWorkResumeProbe {
        project_id,
        registered_head,
        probe,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn logical_project_identity_only_no_freeform_path() {
        let root_a = std::env::temp_dir().join("katosync-resume-a");
        let root_b = std::env::temp_dir().join("katosync-resume-b");
        let reg = json!({"projects": [
            {"id":"a","rootPath":root_a.to_string_lossy(),"scan":{"headSha":"abcd0123456789"}},
            {"id":"b","rootPath":root_b.to_string_lossy()}
        ]});
        assert_eq!(
            registered_root(&reg, "a").unwrap().1.as_deref(),
            Some("abcd0123456789")
        );
        assert!(registered_root(&reg, "../../a").is_err());
        assert!(registered_root(&reg, "c").is_err());
        assert!(registered_root(&reg, "").is_err());
    }
    #[test]
    fn ambiguous_registry_entries_are_not_usable_for_model_handoff() {
        let reg = json!({"projects": [
            {"id":"a","rootPath":"/tmp/a"},
            {"id":"a","rootPath":"/tmp/b"}
        ]});
        assert!(registered_root(&reg, "a").is_err());
        let bad = json!({"projects":[{"id":"a","rootPath":"relative/path"}]});
        assert!(registered_root(&bad, "a").is_err());
    }
}
