// Created by NMKato Solutions
//! Session-based, on-device macOS speech transcription. No recordings saved or uploaded.
use serde::{Deserialize, Serialize};
use std::{process::Stdio, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::Mutex,
    time::timeout,
};
use uuid::Uuid;

const STT_EVENT: &str = "katosync-stt-event";
static SESSION: Mutex<Option<ActiveSession>> = Mutex::const_new(None);
struct ActiveSession {
    id: Uuid,
    input: ChildStdin,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UiEvent {
    id: String,
    kind: String,
    code: String,
    text: String,
}
#[derive(Deserialize)]
struct HelperEvent {
    kind: String,
    code: String,
    text: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SttReadiness {
    code: String,
}

fn helper_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        let bundle = app
            .path()
            .resource_dir()
            .map_err(|_| "helper_missing".to_string())?
            .join("resources/stt/KatoSyncSpeechHelper.app");
        let bin = bundle.join("Contents/MacOS/katosync-stt");
        if !bundle.join("Contents/Info.plist").is_file() || !bin.is_file() {
            return Err("helper_missing".into());
        }
        Ok(bin)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("platform_unavailable".into())
    }
}
fn emit(app: &AppHandle, id: &Uuid, kind: &str, code: &str, text: &str) {
    let _ = app.emit(
        STT_EVENT,
        UiEvent {
            id: id.to_string(),
            kind: kind.to_string(),
            code: code.to_string(),
            text: text.to_string(),
        },
    );
}

#[tauri::command]
pub(crate) fn local_stt_available(app: AppHandle) -> bool {
    helper_path(&app).is_ok()
}

#[tauri::command]
pub(crate) async fn local_stt_preflight(app: AppHandle) -> SttReadiness {
    let bin = match helper_path(&app) {
        Ok(p) => p,
        Err(code) => return SttReadiness { code },
    };
    let result = timeout(
        Duration::from_secs(6),
        Command::new(bin)
            .arg("--preflight")
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output(),
    )
    .await;
    let code = match result {
        Ok(Ok(output)) if output.stdout.len() < 2048 => {
            let line = output
                .stdout
                .split(|b| *b == b'\n')
                .next()
                .unwrap_or_default();
            serde_json::from_slice::<HelperEvent>(line)
                .map(|item| item.code)
                .unwrap_or_else(|_| "helper_failed".to_string())
        }
        Ok(_) => "helper_failed".into(),
        Err(_) => "timeout".into(),
    };
    SttReadiness { code }
}

#[tauri::command]
pub(crate) async fn local_stt_start(app: AppHandle, id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|_| "invalid_session".to_string())?;
    let bin = helper_path(&app)?;
    let mut session = SESSION.lock().await;
    if session.is_some() {
        return Err("already_recording".into());
    }
    let mut child = Command::new(bin)
        .arg("--record")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "helper_failed".to_string())?;
    let input = child.stdin.take().ok_or("helper_failed")?;
    let stdout = child.stdout.take().ok_or("helper_failed")?;
    *session = Some(ActiveSession { id, input });
    drop(session);
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut terminal: Option<HelperEvent> = None;
        let result = timeout(Duration::from_secs(58), async {
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) if line.len() < 4096 => {
                        if let Ok(item) = serde_json::from_str::<HelperEvent>(&line) {
                            if matches!(
                                item.kind.as_str(),
                                "permission" | "recording" | "processing" | "partial"
                            ) {
                                emit(&app, &id, &item.kind, &item.code, &item.text);
                            } else if matches!(item.kind.as_str(), "complete" | "error") {
                                terminal = Some(item);
                                break;
                            }
                        }
                    }
                    Ok(Some(_)) => break,
                    _ => break,
                }
            }
        })
        .await;
        // Clear the global session before the terminal UI event. Immediate second
        // recordings no longer race against native cleanup ("already_recording").
        let _ = child.kill().await;
        let _ = child.wait().await;
        let mut locked = SESSION.lock().await;
        if locked.as_ref().is_some_and(|active| active.id == id) {
            *locked = None;
        }
        drop(locked);
        if let Some(item) = terminal {
            emit(&app, &id, &item.kind, &item.code, &item.text);
        } else {
            emit(
                &app,
                &id,
                "error",
                if result.is_err() {
                    "timeout"
                } else {
                    "helper_failed"
                },
                "",
            );
        }
    });
    Ok(())
}
#[tauri::command]
pub(crate) async fn local_stt_stop(id: String) -> Result<(), String> {
    let id = Uuid::parse_str(&id).map_err(|_| "invalid_session".to_string())?;
    let mut locked = SESSION.lock().await;
    let active = locked.as_mut().ok_or("not_recording")?;
    if active.id != id {
        return Err("wrong_session".into());
    }
    active
        .input
        .write_all(b"STOP\n")
        .await
        .map_err(|_| "helper_failed".to_string())?;
    active
        .input
        .flush()
        .await
        .map_err(|_| "helper_failed".to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn local_stt_open_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
            .status()
            .await
            .map_err(|_| "settings_unavailable".to_string())?;
        if !status.success() {
            return Err("settings_unavailable".into());
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("platform_unavailable".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expected_event_has_no_raw_audio() {
        let event = UiEvent {
            id: "demo".into(),
            kind: "recording".into(),
            code: "".into(),
            text: "".into(),
        };
        let encoded = serde_json::to_string(&event).unwrap();
        assert!(!encoded.contains("audio"));
        assert!(encoded.contains("recording"));
    }
    #[test]
    fn parse_untrusted_helper_result() {
        let item: HelperEvent =
            serde_json::from_str(r#"{"kind":"error","code":"mic_denied","text":""}"#).unwrap();
        assert_eq!(item.code, "mic_denied");
    }
}
