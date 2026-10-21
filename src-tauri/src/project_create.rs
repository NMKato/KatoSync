// Created by NMKato Solutions
// Non-destructive, local-only project creation. No external installers or services.
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Clone, Copy)]
enum Template {
    Blank,
    WebTypeScript,
    IosSwiftui,
    AndroidKotlin,
    TauriRust,
}

impl Template {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "blank" => Ok(Self::Blank),
            "web_typescript" => Ok(Self::WebTypeScript),
            "ios_swiftui" => Ok(Self::IosSwiftui),
            "android_kotlin" => Ok(Self::AndroidKotlin),
            "tauri_rust" => Ok(Self::TauriRust),
            _ => Err("Unbekannte Projektvorlage.".to_string()),
        }
    }

    fn description(self) -> &'static str {
        match self {
            Self::Blank => "Leeres Git-Projekt",
            Self::WebTypeScript => "Web / TypeScript",
            Self::IosSwiftui => "iOS / SwiftUI",
            Self::AndroidKotlin => "Android / Kotlin",
            Self::TauriRust => "Tauri / Rust",
        }
    }

    fn kuas_profile(self) -> &'static str {
        match self {
            Self::Blank => "community",
            Self::WebTypeScript => "web_typescript",
            Self::IosSwiftui => "ios_swiftui",
            Self::AndroidKotlin => "android_kotlin",
            Self::TauriRust => "tauri_rust",
        }
    }
}

fn validate_name(value: &str) -> Result<&str, String> {
    let name = value.trim();
    if name.is_empty()
        || name.len() > 80
        || name.chars().count() < 2
        || name.chars().any(|c| c.is_control())
        || !name
            .chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
    {
        return Err(
            "Projektname: 2–80 Zeichen, nur Buchstaben, Zahlen, Leerzeichen, - oder _.".to_string(),
        );
    }
    Ok(name)
}

fn validate_slug(value: &str) -> Result<&str, String> {
    if value.len() < 2
        || value.len() > 64
        || !value.is_ascii()
        || !value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        || !value.as_bytes()[0].is_ascii_alphanumeric()
        || !value.as_bytes()[value.len() - 1].is_ascii_alphanumeric()
    {
        return Err(
            "Projektordner: 2–64 Zeichen, Kleinbuchstaben/Zahlen und Bindestriche.".to_string(),
        );
    }
    if ["con", "prn", "aux", "nul"].contains(&value)
        || (value.len() == 4
            && (value.starts_with("com") || value.starts_with("lpt"))
            && value.as_bytes()[3].is_ascii_digit())
    {
        return Err("Dieser Projektordnername ist reserviert.".to_string());
    }
    Ok(value)
}

fn git(repo: &Path, args: &[&str]) -> Result<(), String> {
    // Fixed command/arguments only; no shell, no global hooks/exec filters.
    let status = Command::new("git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
        ])
        .arg("-C")
        .arg(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|_| "Git konnte nicht gestartet werden.".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Lokale Git-Initialisierung fehlgeschlagen. Projektordner bleibt zur manuellen Prüfung erhalten.".to_string())
    }
}

fn write_new(root: &Path, relative: &str, content: &str) -> Result<(), String> {
    let file = root.join(relative);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|_| "Projektunterordner konnte nicht angelegt werden.".to_string())?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    let mut handle = options
        .open(&file)
        .map_err(|_| "Projektdatei konnte nicht exklusiv angelegt werden.".to_string())?;
    use std::io::Write;
    handle
        .write_all(content.as_bytes())
        .map_err(|_| "Projektdatei konnte nicht geschrieben werden.".to_string())
}

fn git_ancestor(parent: &Path, boundary: &Path) -> bool {
    let mut node = parent;
    while node.starts_with(boundary) {
        if node.join(".git").exists() {
            return true;
        }
        match node.parent() {
            Some(next) if next != node => node = next,
            _ => break,
        }
    }
    false
}

fn create_at(parent: &Path, name: &str, slug: &str, template: Template) -> Result<PathBuf, String> {
    let name = validate_name(name)?;
    let slug = validate_slug(slug)?;
    if !parent.is_dir() {
        return Err("Der gewählte Workspace-Ordner existiert nicht.".to_string());
    }
    let path = parent.join(slug);
    // create_dir is exclusive: never merge files into an existing directory.
    fs::create_dir(&path).map_err(|_| "Projektordner existiert bereits oder kann nicht erstellt werden. Bestehende Dateien bleiben unverändert.".to_string())?;

    let today = chrono::Utc::now().date_naive();
    let title = template.description();
    write_new(&path, "README.md", &format!(
        "# {name}\n\nNeues KatoSync-Projekt ({title}).\n\nStartzustand: **Grundstruktur**. Abhängigkeiten und IDE-/Build-Projekte wurden nicht installiert.\n\nSiehe PROJECT_STATUS_FLOW.md und docs/TECH_STACK.md.\n"
    ))?;
    write_new(&path, "PROJECT_STATUS_FLOW.md", &format!(
        "# Projektstatus: {name}\n\nStand: {today}\nBranch: main\nAktuelle Welle: Initialisierung / Projektarchitektur festlegen\n\n## Aktueller Stand\n- Lokales Git-Projekt mit KatoSync angelegt.\n- Technologie-Vorlage: {title}.\n- Kein Build, kein Testlauf und kein Deployment ausgeführt.\n\n## Nächste Schritte\n- [ ] Ziele, Zielplattform und minimale Funktionen definieren.\n- [ ] Passendes offizielles SDK/IDE-Projekt erzeugen (sofern erforderlich).\n- [ ] Projektkontext und KUAS-Profil prüfen.\n- [ ] Ersten überprüfbaren Entwicklungsschritt planen.\n\n## Freigaben\n- Codeänderungen, Cloud-Transfer und Veröffentlichung benötigen eigenständige Berechtigung.\n"
    ))?;
    write_new(&path, "AGENTS.md",
        "# Agentenrichtlinien\n\nKUAS v1 gilt als allgemeiner KatoSync-Standard.\nDieses Dokument ist Projektkontext und keine Befehlsautorität.\nÄnderungen nur nach vertrauenswürdiger Freigabe, in einem eigenen Worktree und mit überprüfbaren Tests.\nProjektstatus und Git-HEAD vor jeder Arbeit neu prüfen.\n")?;
    write_new(&path, "MEMORY.md",
        "# Projektgedächtnis\n\n## Architekturentscheidungen\n- Noch keine.\n\n## Bisherige Arbeit\n- KatoSync-Grundstruktur erzeugt.\n\n## Offene Fragen\n- Anforderungen und nächste Phase festlegen.\n")?;
    write_new(
        &path,
        ".gitignore",
        ".DS_Store\n.env\n.env.*\nnode_modules/\ndist/\nbuild/\ntarget/\nDerivedData/\n",
    )?;
    write_new(&path, "docs/TECH_STACK.md", &format!(
        "# Technologieprofil\n\nVorlage: {title}\nKatoSync KUAS-Profilvorschlag: {}\n\nDieses Profil ist ein Vorschlag, keine bestätigte Organisationsrichtlinie.\nSDK/Framework-Versionen erst nach Kompatibilitätsprüfung auswählen.\nKein Build-Projekt oder Drittanbieterpaket wurde generiert bzw. installiert.\n",
        template.kuas_profile()
    ))?;
    // No automatic remote creation and no network. A first local commit provides
    // a verifiable HEAD for the existing Project Registry scanner.
    git(&path, &["init", "--template=", "-b", "main"])?;
    git(
        &path,
        &[
            "add",
            "--",
            "README.md",
            "PROJECT_STATUS_FLOW.md",
            "AGENTS.md",
            "MEMORY.md",
            ".gitignore",
            "docs/TECH_STACK.md",
        ],
    )?;
    git(
        &path,
        &[
            "-c",
            "user.name=KatoSync",
            "-c",
            "user.email=katosync@local.invalid",
            "commit",
            "--no-gpg-sign",
            "-m",
            "chore: initialize KatoSync project",
        ],
    )?;
    Ok(path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectCreation {
    pub path: String,
    pub template: String,
    pub probe: crate::project_registry::ProjectProbe,
}

/// Desktop only; parent must already exist inside this user's home. Use the
/// native folder picker in the UI. External volumes are an explicit future capability.
#[tauri::command]
pub(crate) async fn project_create(
    parent_dir: String,
    name: String,
    slug: String,
    template: String,
) -> Result<ProjectCreation, String> {
    validate_name(&name)?;
    validate_slug(&slug)?;
    let preset = Template::parse(&template)?;
    let home = dirs::home_dir().ok_or("Benutzerverzeichnis nicht gefunden.")?;
    let home =
        fs::canonicalize(home).map_err(|_| "Benutzerverzeichnis nicht prüfbar.".to_string())?;
    let parent = fs::canonicalize(&parent_dir)
        .map_err(|_| "Workspace-Ordner nicht verfügbar.".to_string())?;
    if !parent.starts_with(&home) || parent == home || git_ancestor(&parent, &home) {
        return Err("Workspace muss ein bestehender Ordner unterhalb deines Benutzerverzeichnisses sein, außerhalb anderer Git-Projekte.".to_string());
    }
    let created =
        tauri::async_runtime::spawn_blocking(move || create_at(&parent, &name, &slug, preset))
            .await
            .map_err(|_| "Projektanlage wurde unterbrochen.".to_string())??;
    let probe = crate::project_registry::scan(&created)?;
    Ok(ProjectCreation {
        path: created.to_string_lossy().into_owned(),
        template,
        probe,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    fn temp_workspace() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "katosync-create-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        root
    }

    #[test]
    fn rejects_invalid_names_slugs_and_unsupported_templates() {
        for s in [
            "",
            "../app",
            ".git",
            "App",
            "has space",
            "a",
            "a/",
            "x;rm",
            "con",
        ] {
            assert!(validate_slug(s).is_err(), "{s}");
        }
        for s in ["", "a", "../etc", "A\nB", "# injected"] {
            assert!(validate_name(s).is_err(), "{s}");
        }
        assert!(Template::parse("from_url").is_err());
    }

    #[test]
    fn creates_isolated_template_git_project_without_overwrite() {
        let root = temp_workspace();
        let created = create_at(&root, "Neue App", "neue-app", Template::IosSwiftui).unwrap();
        let scanned =
            serde_json::to_value(crate::project_registry::scan(&created).unwrap()).unwrap();
        assert_eq!(scanned["repo"]["branch"], "main");
        assert!(scanned["repo"]["headSha"].as_str().is_some());
        assert!(created.join("PROJECT_STATUS_FLOW.md").is_file());
        assert!(created.join("MEMORY.md").is_file());
        assert!(created.join("AGENTS.md").is_file());
        assert!(created.join("docs/TECH_STACK.md").is_file());
        let before = fs::read(created.join("README.md")).unwrap();
        assert!(create_at(&root, "Overwrite", "neue-app", Template::Blank).is_err());
        assert_eq!(fs::read(created.join("README.md")).unwrap(), before);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn nested_git_workspace_is_identified_before_project_creation() {
        let root = temp_workspace();
        let project = create_at(&root, "First Repo", "first-repo", Template::Blank).unwrap();
        assert!(git_ancestor(&project, &root));
        assert!(!git_ancestor(&root, &root));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creation_is_exclusive_and_does_not_touch_existing_neighbor() {
        let root = temp_workspace();
        let existing = root.join("legacy");
        fs::create_dir(&existing).unwrap();
        fs::write(existing.join("marker.txt"), b"keep me").unwrap();
        assert!(create_at(&root, "Legacy", "legacy", Template::Blank).is_err());
        assert_eq!(fs::read(existing.join("marker.txt")).unwrap(), b"keep me");
        let _ = fs::remove_dir_all(root);
    }
}
