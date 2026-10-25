// Created by NMKato Solutions
//! Explicit, local-only one-shot macOS Speech transcription. No uploads or audio storage.
use serde::Deserialize;
use std::{
    process::Stdio,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::Manager;
use tokio::{process::Command, time::timeout};

static DICTATING: AtomicBool = AtomicBool::new(false);
struct Exclusive;
impl Exclusive {
    fn acquire() -> Result<Self, String> {
        DICTATING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Relaxed)
            .map_err(|_| "Eine Diktataufnahme läuft bereits.".to_string())?;
        Ok(Self)
    }
}
impl Drop for Exclusive {
    fn drop(&mut self) {
        DICTATING.store(false, Ordering::Release);
    }
}
#[derive(Deserialize)]
struct DictationReply {
    ok: bool,
    text: String,
}

#[tauri::command]
pub(crate) fn local_stt_available(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        app.path()
            .resource_dir()
            .ok()
            .is_some_and(|dir| dir.join("resources/stt/katosync-stt").is_file())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        false
    }
}

#[tauri::command]
pub(crate) async fn local_stt_dictate(app: tauri::AppHandle) -> Result<String, String> {
    let _guard = Exclusive::acquire()?;
    if !local_stt_available(app.clone()) {
        return Err("Keine verifizierte lokale Diktat-Engine für diese Plattform.".into());
    }
    let bin = app
        .path()
        .resource_dir()
        .map_err(|_| "Diktat-Ressource fehlt.".to_string())?
        .join("resources/stt/katosync-stt");
    let output = timeout(
        Duration::from_secs(35),
        Command::new(bin)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Lokale Diktierzeit überschritten.".to_string())?
    .map_err(|_| "Lokaler Sprachdienst konnte nicht gestartet werden.".to_string())?;
    if output.stdout.len() > 4096 {
        return Err("Diktierantwort überschreitet Größenlimit.".into());
    }
    let result: DictationReply = serde_json::from_slice(&output.stdout)
        .map_err(|_| "Lokale Diktierantwort ist ungültig.".to_string())?;
    if !output.status.success() || !result.ok {
        return Err("Mikrofon/Offline-Spracherkennung nicht bereit oder nichts erkannt.".into());
    }
    let text = result.text.trim();
    if text.is_empty() || text.chars().count() > 1200 {
        return Err("Diktiertext leer oder zu lang.".into());
    }
    Ok(text.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dictation_is_not_marked_in_progress_by_default() {
        assert!(!DICTATING.load(Ordering::Relaxed));
    }
}
