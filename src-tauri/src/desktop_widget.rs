// Created by NMKato Solutions
// MARK: Desktop Widget 4.0 preview — bounded, in-memory display state ONLY.
// No credentials, filesystem content, trust changes or job execution from widget IPC.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, Window};

const WIDGET_LABEL: &str = "desktop-widget";
const COMPACT_WIDTH: f64 = 396.0;
const COMPACT_HEIGHT: f64 = 330.0;
const EXPANDED_WIDTH: f64 = 520.0;
const EXPANDED_HEIGHT: f64 = 580.0;
const WIDGET_STALE_MS: i64 = 90_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WidgetReport {
    signed_in: bool,
    active_jobs: u16,
    queued_jobs: u16,
    needs_attention: u16,
    task_title: Option<String>,
    local_model_running: bool,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    signed_in: bool,
    active_jobs: u16,
    queued_jobs: u16,
    needs_attention: u16,
    task_title: Option<String>,
    local_model_running: bool,
    updated_at_ms: i64,
    stale: bool,
}
impl Default for WidgetSnapshot {
    fn default() -> Self {
        Self {
            signed_in: false,
            active_jobs: 0,
            queued_jobs: 0,
            needs_attention: 0,
            task_title: None,
            local_model_running: false,
            updated_at_ms: 0,
            stale: true,
        }
    }
}
static WIDGET_STATE: OnceLock<Mutex<WidgetSnapshot>> = OnceLock::new();
fn state() -> &'static Mutex<WidgetSnapshot> {
    WIDGET_STATE.get_or_init(|| Mutex::new(WidgetSnapshot::default()))
}
fn task_title_allowed(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    !value.is_empty()
        && value.chars().count() <= 90
        && !value.chars().any(char::is_control)
        && !value.contains('@')
        && !value.contains('/')
        && !value.contains('\\')
        && !lower.contains("token")
        && !lower.contains("secret")
        && !lower.contains("password")
        && !lower.contains("api_key")
}
fn normalize_report(report: WidgetReport, now: i64) -> WidgetSnapshot {
    if !report.signed_in {
        return WidgetSnapshot {
            updated_at_ms: now,
            ..WidgetSnapshot::default()
        };
    }
    let active_jobs = report.active_jobs.min(99);
    WidgetSnapshot {
        signed_in: true,
        active_jobs,
        queued_jobs: report.queued_jobs.min(99),
        needs_attention: report.needs_attention.min(99),
        task_title: if active_jobs == 0 {
            None
        } else {
            report.task_title.filter(|value| task_title_allowed(value))
        },
        local_model_running: report.local_model_running,
        updated_at_ms: now,
        stale: false,
    }
}
fn get_snapshot(now: i64) -> WidgetSnapshot {
    let mut snapshot = state()
        .lock()
        .map(|locked| locked.clone())
        .unwrap_or_default();
    snapshot.stale = !snapshot.signed_in
        || snapshot.updated_at_ms == 0
        || now < snapshot.updated_at_ms
        || now - snapshot.updated_at_ms > WIDGET_STALE_MS;
    snapshot
}
fn require_window(window: &Window, label: &str) -> Result<(), String> {
    if window.label() != label {
        return Err("WIDGET_INVALID_WINDOW_SCOPE".into());
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_widget_publish(window: Window, input: WidgetReport) -> Result<(), String> {
    require_window(&window, "main")?;
    let snapshot = normalize_report(input, chrono::Utc::now().timestamp_millis());
    *state().lock().map_err(|_| "WIDGET_STATE_LOCK".to_owned())? = snapshot;
    Ok(())
}
#[tauri::command]
pub fn desktop_widget_snapshot(window: Window) -> Result<WidgetSnapshot, String> {
    require_window(&window, WIDGET_LABEL)?;
    Ok(get_snapshot(chrono::Utc::now().timestamp_millis()))
}
#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct WidgetPosition {
    x: i32,
    y: i32,
}
fn position_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| "WIDGET_CONFIG_UNAVAILABLE".to_owned())?
        .join("desktop-widget-position.json"))
}
fn restore_position(window: &tauri::WebviewWindow, app: &AppHandle) {
    let Ok(path) = position_path(app) else {
        return;
    };
    let Ok(raw) = fs::read(&path) else {
        return;
    };
    if raw.len() > 256 {
        return;
    }
    let Ok(pos) = serde_json::from_slice::<WidgetPosition>(&raw) else {
        return;
    };
    // Preserve the user's preferred monitor. Only fall back to the primary
    // display if the saved monitor was disconnected or has moved.
    let chosen = window.available_monitors().ok().and_then(|items| {
        items.into_iter().find(|monitor| {
            let origin = monitor.position();
            let size = monitor.size();
            pos.x >= origin.x
                && pos.y >= origin.y
                && pos.x < origin.x.saturating_add(size.width as i32)
                && pos.y < origin.y.saturating_add(size.height as i32)
        })
    });
    let Some(monitor) = chosen.or_else(|| app.primary_monitor().ok().flatten()) else {
        return;
    };
    let origin = monitor.position();
    let size = monitor.size();
    let window_size = window.outer_size().ok();
    let width = window_size
        .as_ref()
        .map(|value| value.width as i32)
        .unwrap_or(COMPACT_WIDTH as i32);
    let height = window_size
        .as_ref()
        .map(|value| value.height as i32)
        .unwrap_or(COMPACT_HEIGHT as i32);
    let max_x = origin
        .x
        .saturating_add(size.width as i32)
        .saturating_sub(width);
    let max_y = origin
        .y
        .saturating_add(size.height as i32)
        .saturating_sub(height);
    let x = pos.x.clamp(origin.x, max_x.max(origin.x));
    let y = pos.y.clamp(origin.y, max_y.max(origin.y));
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
}
#[tauri::command]
pub fn desktop_widget_save_position(window: Window, app: AppHandle) -> Result<(), String> {
    require_window(&window, WIDGET_LABEL)?;
    let pos = window
        .outer_position()
        .map_err(|_| "WIDGET_POSITION_UNAVAILABLE")?;
    if pos.x.abs() > 100_000 || pos.y.abs() > 100_000 {
        return Err("WIDGET_POSITION_OUT_OF_RANGE".into());
    }
    let path = position_path(&app)?;
    if path.exists()
        && fs::symlink_metadata(&path)
            .map_err(|_| "WIDGET_POSITION_IO")?
            .file_type()
            .is_symlink()
    {
        return Err("WIDGET_POSITION_UNSAFE_PATH".into());
    }
    let parent = path.parent().ok_or("WIDGET_POSITION_IO")?;
    fs::create_dir_all(parent).map_err(|_| "WIDGET_POSITION_IO")?;
    let temp = path.with_extension("json.tmp");
    if temp.exists()
        && fs::symlink_metadata(&temp)
            .map_err(|_| "WIDGET_POSITION_IO")?
            .file_type()
            .is_symlink()
    {
        return Err("WIDGET_POSITION_UNSAFE_PATH".into());
    }
    let value = serde_json::to_vec(&WidgetPosition { x: pos.x, y: pos.y })
        .map_err(|_| "WIDGET_POSITION_IO")?;
    fs::write(&temp, value).map_err(|_| "WIDGET_POSITION_IO")?;
    fs::rename(temp, path).map_err(|_| "WIDGET_POSITION_IO")?;
    Ok(())
}
#[tauri::command]
pub fn desktop_widget_show(window: Window, app: AppHandle) -> Result<(), String> {
    require_window(&window, "main")?;
    // Isolated preview only until IPC/window-permission audit and real widget QA.
    if !cfg!(feature = "stage35-qa") {
        return Err("WIDGET_PREVIEW_NOT_RELEASED".into());
    }
    if let Some(existing) = app.get_webview_window(WIDGET_LABEL) {
        existing.show().map_err(|_| "WIDGET_SHOW_FAILED")?;
        return Ok(());
    }
    let new_widget =
        WebviewWindowBuilder::new(&app, WIDGET_LABEL, WebviewUrl::App("widget.html".into()))
            .title("KatoSync · Desktop Widget")
            .inner_size(COMPACT_WIDTH, COMPACT_HEIGHT)
            .min_inner_size(360.0, 300.0)
            .resizable(false)
            .decorations(false)
            .build()
            .map_err(|_| "WIDGET_CREATE_FAILED".to_owned())?;
    restore_position(&new_widget, &app);
    Ok(())
}
/// Expand only this isolated preview window. Never touch or execute tasks.
#[tauri::command]
pub fn desktop_widget_set_expanded(
    window: Window,
    app: AppHandle,
    expanded: bool,
) -> Result<(), String> {
    require_window(&window, WIDGET_LABEL)?;
    let (width, height) = if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT)
    } else {
        (COMPACT_WIDTH, COMPACT_HEIGHT)
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|_| "WIDGET_RESIZE_FAILED".to_owned())?;
    // When expanding near an edge, keep the window on its current monitor.
    // Do not overwrite the user's saved drag position.
    let chosen = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    if let (Some(monitor), Ok(position), Ok(size)) =
        (chosen, window.outer_position(), window.outer_size())
    {
        let bounds = monitor.position();
        let monitor_size = monitor.size();
        let max_x = bounds
            .x
            .saturating_add(monitor_size.width as i32)
            .saturating_sub(size.width as i32);
        let max_y = bounds
            .y
            .saturating_add(monitor_size.height as i32)
            .saturating_sub(size.height as i32);
        let safe_x = position.x.clamp(bounds.x, max_x.max(bounds.x));
        let safe_y = position.y.clamp(bounds.y, max_y.max(bounds.y));
        if safe_x != position.x || safe_y != position.y {
            window
                .set_position(tauri::PhysicalPosition::new(safe_x, safe_y))
                .map_err(|_| "WIDGET_POSITION_FAILED".to_owned())?;
        }
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_widget_drag(window: Window) -> Result<(), String> {
    require_window(&window, WIDGET_LABEL)?;
    window
        .start_dragging()
        .map_err(|_| "WIDGET_DRAG_FAILED".into())
}
#[tauri::command]
pub fn desktop_widget_hide(window: Window, app: AppHandle) -> Result<(), String> {
    require_window(&window, WIDGET_LABEL)?;
    // Never leave the user with both main app AND widget hidden.
    let main = app
        .get_webview_window("main")
        .ok_or("WIDGET_MAIN_UNAVAILABLE")?;
    main.show().map_err(|_| "WIDGET_MAIN_SHOW_FAILED")?;
    main.set_focus().map_err(|_| "WIDGET_MAIN_FOCUS_FAILED")?;
    window.hide().map_err(|_| "WIDGET_HIDE_FAILED".into())
}
#[tauri::command]
pub fn desktop_widget_open_main(
    window: Window,
    app: AppHandle,
    destination: String,
) -> Result<(), String> {
    require_window(&window, WIDGET_LABEL)?;
    if !matches!(
        destination.as_str(),
        "jobs" | "chat" | "dashboard" | "agent"
    ) {
        return Err("WIDGET_INVALID_DESTINATION".into());
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "WIDGET_MAIN_UNAVAILABLE".to_owned())?;
    main.show().map_err(|_| "WIDGET_MAIN_SHOW_FAILED")?;
    main.set_focus().map_err(|_| "WIDGET_MAIN_FOCUS_FAILED")?;
    app.emit_to("main", "katosync-widget-navigate", destination)
        .map_err(|_| "WIDGET_NAVIGATION_FAILED".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsigned_or_private_widget_status_never_survives_to_display() {
        let input = WidgetReport {
            signed_in: false,
            active_jobs: 10,
            queued_jobs: 100,
            needs_attention: 2,
            task_title: Some("sensitive task".into()),
            local_model_running: true,
        };
        let sanitized = normalize_report(input, 123);
        assert!(!sanitized.signed_in);
        assert_eq!(sanitized.active_jobs, 0);
        assert_eq!(sanitized.task_title, None);
        assert!(!sanitized.local_model_running);
    }
    #[test]
    fn job_title_is_sanitized_and_task_counts_bounded() {
        assert!(!task_title_allowed("/Users/secret/private"));
        assert!(!task_title_allowed("token=private"));
        assert!(!task_title_allowed("name@example.com"));
        assert!(task_title_allowed("Repository Tests ausführen"));
        let output = normalize_report(
            WidgetReport {
                signed_in: true,
                active_jobs: 120,
                queued_jobs: 120,
                needs_attention: 200,
                task_title: Some("Running tests".into()),
                local_model_running: true,
            },
            100,
        );
        assert_eq!(output.active_jobs, 99);
        assert_eq!(output.queued_jobs, 99);
        assert_eq!(output.needs_attention, 99);
    }
    #[test]
    fn absent_heartbeat_becomes_stale_not_online() {
        let mut s = WidgetSnapshot::default();
        s.signed_in = true;
        s.updated_at_ms = 100;
        assert!(110_000 - s.updated_at_ms > WIDGET_STALE_MS);
        assert!(get_snapshot(10_000).stale);
    }
}
