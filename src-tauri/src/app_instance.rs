// Created by NMKato Solutions
//! Stage4J macOS start gate. Prevent duplicates; never forcibly kill unknown processes.
//! Stage35 is a legacy build without cooperative shutdown, so owner confirmation is required.
use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
    thread,
    time::Duration,
};

const TEAM_ID: &str = "T8SB89JPX7";
const NEW_APP: &str = "com.nmkato.katosync.meshqa.stage4j-isolated";
const OLD_STAGE35: &str = "com.nmkato.katosync.meshqa.stage35";
const OLD_STAGE3X: &str = "com.nmkato.katosync.meshqa.stage3x";
const PRODUCTION_APP: &str = "com.nmkato.katosync";
const EXECUTABLE_SUFFIX: &str = ".app/Contents/MacOS/katosync";
mod process_mode;
static OWNED_LOCK: OnceLock<File> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq)]
struct RunningApp {
    pid: u32,
    executable: PathBuf,
    bundle_id: String,
}

fn process_line(raw: &str, uid: u32, own_pid: u32) -> Option<(u32, PathBuf)> {
    let value = raw.trim_start();
    let (pid, rest) = value.split_once(char::is_whitespace)?;
    let (process_uid, command) = rest.trim_start().split_once(char::is_whitespace)?;
    let pid = pid.parse::<u32>().ok()?;
    if pid == own_pid || process_uid.parse::<u32>().ok()? != uid {
        return None;
    }
    let command = command.trim_start();
    // Reject shell commands mentioning KatoSync as an argument.
    // The first bytes must be the actual launch executable, never a wrapper.
    if !(command.starts_with("/Applications/") || command.starts_with("/Users/")) {
        return None;
    }
    let end = command.find(EXECUTABLE_SUFFIX)? + EXECUTABLE_SUFFIX.len();
    let trailing = &command[end..];
    if !trailing.is_empty() && !trailing.starts_with(char::is_whitespace) {
        return None;
    }
    // MARK: A login-launched headless Local Control daemon is not a second GUI.
    // Only genuine GUI candidates must compete for the singleton lock.
    if process_mode::is_headless_process_args(trailing) {
        return None;
    }
    Some((pid, PathBuf::from(&command[..end])))
}

fn signed_app(executable: &Path, home: &Path) -> Option<String> {
    let path = executable.canonicalize().ok()?;
    if !path.starts_with(home.join("Applications")) && !path.starts_with("/Applications") {
        return None;
    }
    let text = path.to_str()?;
    let app_path = Path::new(text.strip_suffix("/Contents/MacOS/katosync")?);
    if !app_path.to_str()?.ends_with(".app") {
        return None;
    }
    // Both app identity and signed Team ID must match. Never terminate a name-only match.
    let details = Command::new("/usr/bin/codesign")
        .args(["-dv", "--verbose=2"])
        .arg(app_path)
        .output()
        .ok()?;
    if !details.status.success() {
        return None;
    }
    let details_text = String::from_utf8_lossy(&details.stderr);
    if !details_text.contains(&format!("TeamIdentifier={TEAM_ID}")) {
        return None;
    }
    let plist = app_path.join("Contents/Info.plist");
    let bundle = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleIdentifier"])
        .arg(plist)
        .output()
        .ok()?;
    if !bundle.status.success() {
        return None;
    }
    let bundle = String::from_utf8(bundle.stdout).ok()?.trim().to_string();
    if [NEW_APP, OLD_STAGE35, OLD_STAGE3X, PRODUCTION_APP].contains(&bundle.as_str())
        && details_text.contains(&format!("Identifier={bundle}"))
    {
        let signature = Command::new("/usr/bin/codesign")
            .args(["--verify", "--deep", "--strict"])
            .arg(app_path)
            .status()
            .ok()?;
        if signature.success() {
            return Some(bundle);
        }
    }
    None
}

fn process_list(home: &Path, uid: u32, own_pid: u32) -> Result<Vec<RunningApp>, String> {
    let output = Command::new("/bin/ps")
        .args(["-axww", "-o", "pid=", "-o", "uid=", "-o", "command="])
        .output()
        .map_err(|_| "INSTANCE_PS_UNAVAILABLE")?;
    if !output.status.success() {
        return Err("INSTANCE_PS_FAILED".into());
    }
    let body = String::from_utf8(output.stdout).map_err(|_| "INSTANCE_PS_INVALID")?;
    let mut found = Vec::new();
    for raw in body.lines() {
        if let Some((pid, executable)) = process_line(raw, uid, own_pid) {
            if let Some(bundle_id) = signed_app(&executable, home) {
                found.push(RunningApp {
                    pid,
                    executable,
                    bundle_id,
                });
            }
        }
    }
    Ok(found)
}

fn owner_uid() -> Result<u32, String> {
    let result = Command::new("/usr/bin/id")
        .arg("-u")
        .output()
        .map_err(|_| "INSTANCE_UID_UNAVAILABLE")?;
    if !result.status.success() {
        return Err("INSTANCE_UID_FAILED".into());
    }
    String::from_utf8_lossy(&result.stdout)
        .trim()
        .parse::<u32>()
        .map_err(|_| "INSTANCE_UID_INVALID".into())
}

fn lock_root(home: &Path, uid: u32) -> Result<PathBuf, String> {
    let dir = home.join("Library/Application Support/KatoSync Instance Coordinator");
    if !dir.exists() {
        fs::create_dir(&dir).map_err(|_| "INSTANCE_DIR_CREATE_FAILED")?;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| "INSTANCE_DIR_PERMISSIONS_FAILED")?;
    }
    let info = fs::symlink_metadata(&dir).map_err(|_| "INSTANCE_DIR_UNREADABLE")?;
    if !info.file_type().is_dir() || info.uid() != uid || info.mode() & 0o077 != 0 {
        return Err("INSTANCE_DIR_INSECURE".into());
    }
    Ok(dir)
}

fn lock_for_session(root: &Path, uid: u32) -> Result<File, String> {
    let path = root.join("katosync-user.lock");
    let existing = fs::symlink_metadata(&path).ok();
    if let Some(ref info) = existing {
        if !info.file_type().is_file() || info.uid() != uid || info.mode() & 0o077 != 0 {
            return Err("INSTANCE_LOCK_INSECURE".into());
        }
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .open(&path)
        .map_err(|_| "INSTANCE_LOCK_OPEN_FAILED")?;
    file.try_lock().map_err(|_| "INSTANCE_ALREADY_RUNNING")?;
    Ok(file)
}

fn notify(text: &str) {
    // Only known static messages are ever supplied; never interpolate process arguments.
    let _ = Command::new("/usr/bin/osascript")
        .args(["-e", &format!(
            "display dialog \"{text}\" buttons {{\"OK\"}} default button \"OK\" with icon caution giving up after 30"
        )]).status();
}

fn confirm_handoff() -> bool {
    // Legacy versions cannot report their in-memory draft/queue state.
    // Require a user action once instead of silently losing unsaved changes.
    Command::new("/usr/bin/osascript")
        .args(["-e",
            "display dialog \"Eine ältere KatoSync-App ist noch geöffnet. Nur fortfahren, wenn keine ungespeicherten Eingaben oder Agent-Aufträge laufen. Alte Version regulär schließen und neue Version starten?\" buttons {\"Abbrechen\", \"Alte Version beenden\"} default button \"Abbrechen\" with icon caution giving up after 30"
        ])
        .output().ok().is_some_and(|o| o.status.success()
            && String::from_utf8_lossy(&o.stdout).contains("Alte Version beenden"))
}

fn ask_old_to_quit(pid: u32, bundle_id: &str) -> bool {
    // Only two exact code-reviewed identifiers can receive a graceful Quit.
    // No SIGKILL, SIGTERM or arbitrary process-name match.
    let command = match bundle_id {
        OLD_STAGE35 => "tell application id \"com.nmkato.katosync.meshqa.stage35\" to quit",
        _ => return false,
    };
    let sent = Command::new("/usr/bin/osascript")
        .args(["-e", command])
        .status()
        .is_ok_and(|s| s.success());
    if !sent {
        return false;
    }
    for _ in 0..12 {
        let exists = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .status()
            .is_ok_and(|s| s.success());
        if !exists {
            return true;
        }
        thread::sleep(Duration::from_millis(250));
    }
    false
}

/// Only a QA GUI launch uses this gate; headless --run-sync and system watchdog
/// are intentionally unaffected. On rejection the older app remains untouched.
pub fn allow_gui_start() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    let Ok(uid) = owner_uid() else { return false };
    let Ok(root) = lock_root(&home, uid) else {
        notify(
            "KatoSync konnte die sichere Startsperre nicht prüfen. Keine neue Instanz gestartet.",
        );
        return false;
    };
    // If another coordinated instance already holds the lock, simply exit.
    // Never invoke AppleScript here: LaunchServices may block when resolving
    // two installations with the same CFBundleIdentifier.
    let file = match lock_for_session(&root, uid) {
        Ok(file) => file,
        Err(cause) if cause == "INSTANCE_ALREADY_RUNNING" => return false,
        Err(_) => {
            notify("KatoSync konnte die sichere Startsperre nicht öffnen. Die vorhandene App bleibt aktiv.");
            return false;
        }
    };
    // Always keep lock in this process until it exits, regardless of launch success.
    if OWNED_LOCK.set(file).is_err() {
        return false;
    }
    let Ok(others) = process_list(&home, uid, std::process::id()) else {
        notify("Laufende KatoSync-Instanzen konnten nicht sicher geprüft werden.");
        return false;
    };
    for app in others {
        if app.bundle_id == OLD_STAGE3X || app.bundle_id == PRODUCTION_APP {
            notify("Eine andere KatoSync-Produktiv- oder Altversion läuft. Bitte zuerst regulär aus dieser App heraus beenden.");
            return false;
        }
        // The process lock belongs to us. A remaining signed Stage4J process
        // therefore predates the coordinator, just like Stage35.
        if app.bundle_id == NEW_APP {
            // A pre-coordinator Stage4J has the SAME LaunchServices bundle ID.
            // An AppleEvent by bundle ID could address the wrong installation.
            // Refuse the new launch until its precise older PID exits via its GUI.
            notify("Eine ältere Stage4J-App mit derselben Apple-Kennung läuft. Bitte dort Programm beenden wählen und die neue App erneut öffnen.");
            return false;
        }
        if app.bundle_id == OLD_STAGE35 {
            if !crate::local_control::handoff_work_idle() || !confirm_handoff() {
                notify("Die bisherige KatoSync-App bleibt geöffnet. Eine zweite App wurde nicht gestartet.");
                return false;
            }
            // Detect an unexpected app switch/rotation after owner confirmation.
            let checked = process_list(&home, uid, std::process::id())
                .ok()
                .is_some_and(|v| v.iter().any(|other| other == &app));
            if !checked || !ask_old_to_quit(app.pid, &app.bundle_id) {
                notify("Die bisherige KatoSync-App konnte nicht regulär beendet werden. Neue App nicht gestartet.");
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_lock_rejects_a_second_live_same_user_instance() {
        let dir = std::env::temp_dir().join(format!("ks4j-singleton-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let uid = owner_uid().unwrap();
        let first = lock_for_session(&dir, uid).unwrap();
        assert_eq!(
            lock_for_session(&dir, uid).unwrap_err(),
            "INSTANCE_ALREADY_RUNNING"
        );
        drop(first);
        let subsequent = lock_for_session(&dir, uid).unwrap();
        drop(subsequent);
        fs::remove_file(dir.join("katosync-user.lock")).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn only_exact_same_uid_executable_commands_are_candidates() {
        let raw="  42  501 /Users/example/Applications/KatoSync Mesh QA Stage35.app/Contents/MacOS/katosync";
        let (pid, path) = process_line(raw, 501, 77).unwrap();
        assert_eq!(pid, 42);
        assert!(path.to_str().unwrap().ends_with(EXECUTABLE_SUFFIX));
        assert!(process_line(raw, 502, 77).is_none());
        assert!(process_line(raw, 501, 42).is_none());
        assert!(process_line(
            "42 501 /bin/zsh -c /Applications/KatoSync Mesh QA Stage35.app/Contents/MacOS/katosync",
            501,
            77
        )
        .is_none());
        assert!(process_line(
            "42 501 /Applications/Unknown.app/Contents/MacOS/katosync.malicious",
            501,
            77
        )
        .is_none());
    }
}
