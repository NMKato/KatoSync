// Erstellt von NMKato Solutions
//! Native Grenze für App-Kommandos. Plugin-Kommandos behalten ihre Tauri-Capabilities.

const SCOPE_DENIED: &str = "IPC_COMMAND_SCOPE_DENIED";

fn command_allowed(window: &str, webview: &str, command: &str, widget_enabled: bool) -> bool {
    if window != webview {
        return false;
    }
    match webview {
        "main" => true,
        "desktop-widget" if widget_enabled => matches!(
            command,
            "desktop_widget_snapshot"
                | "desktop_widget_open_main"
                | "desktop_widget_set_expanded"
                | "desktop_widget_drag"
                | "desktop_widget_save_position"
                | "desktop_widget_hide"
        ),
        _ => false,
    }
}

fn dispatch_if_allowed<T>(
    allowed: bool,
    request: T,
    dispatch: impl FnOnce(T) -> bool,
    reject: impl FnOnce(T),
) -> bool {
    if allowed {
        dispatch(request)
    } else {
        reject(request);
        // Die Ablehnung beantwortet die Anfrage; der App-Dispatcher wird nicht aufgerufen.
        true
    }
}

pub(crate) fn guard<R, F>(
    dispatch: F,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static
where
    R: tauri::Runtime,
    F: Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
{
    move |invoke| {
        // Die Labels stammen aus dem nativen Tauri-Zustand, nie aus der Aufrufnutzlast.
        let webview = invoke.message.webview();
        let window = webview.window();
        let allowed = command_allowed(
            window.label(),
            webview.label(),
            invoke.message.command(),
            cfg!(feature = "stage35-qa"),
        );
        dispatch_if_allowed(allowed, invoke, &dispatch, |request| {
            request.resolver.reject(SCOPE_DENIED);
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn main_keeps_existing_app_and_login_commands() {
        for command in [
            "load_config",
            "open_provider_login_url",
            "mesh_account_network_set_primary",
            "mesh_account_peer_approve",
            "desktop_widget_show",
            "desktop_widget_publish",
        ] {
            assert!(command_allowed("main", "main", command, false));
            assert!(command_allowed("main", "main", command, true));
        }
    }

    #[test]
    fn widget_ui_commands_require_the_qa_feature() {
        for command in [
            "desktop_widget_snapshot",
            "desktop_widget_open_main",
            "desktop_widget_set_expanded",
            "desktop_widget_drag",
            "desktop_widget_save_position",
            "desktop_widget_hide",
        ] {
            assert!(command_allowed(
                "desktop-widget",
                "desktop-widget",
                command,
                true
            ));
            assert!(!command_allowed(
                "desktop-widget",
                "desktop-widget",
                command,
                false
            ));
        }
    }

    #[test]
    fn widget_cannot_call_mesh_jobs_files_login_or_unknown_commands() {
        for command in [
            "mesh_account_peer_approve",
            "mesh_account_network_set_primary",
            "mesh_account_connection_stop",
            "start_local_brain",
            "project_registry_scan",
            "open_provider_login_url",
            "desktop_widget_publish",
            "desktop_widget_show",
            "desktop_widget_snapshot_extra",
            "",
        ] {
            assert!(!command_allowed(
                "desktop-widget",
                "desktop-widget",
                command,
                true
            ));
        }
    }

    #[test]
    fn unknown_and_mismatched_native_labels_are_denied() {
        for (window, webview) in [
            ("main", "desktop-widget"),
            ("desktop-widget", "main"),
            ("main", "auth"),
            ("auth", "auth"),
            ("main-copy", "main-copy"),
            ("", ""),
        ] {
            assert!(!command_allowed(window, webview, "load_config", true));
            assert!(!command_allowed(
                window,
                webview,
                "desktop_widget_snapshot",
                true
            ));
        }
    }

    #[test]
    fn denied_dispatch_rejects_without_executing_the_handler() {
        let executions = Cell::new(0);
        let rejections = Cell::new(0);
        let allowed = command_allowed(
            "desktop-widget",
            "desktop-widget",
            "mesh_account_peer_approve",
            true,
        );
        let handled = dispatch_if_allowed(
            allowed,
            "request",
            |_| {
                executions.set(executions.get() + 1);
                true
            },
            |request| {
                assert_eq!(request, "request");
                rejections.set(rejections.get() + 1);
            },
        );
        assert!(handled);
        assert_eq!(executions.get(), 0);
        assert_eq!(rejections.get(), 1);
    }

    #[test]
    fn allowed_dispatch_preserves_the_handler_result_without_rejection() {
        for expected in [false, true] {
            let executions = Cell::new(0);
            let rejections = Cell::new(0);
            let allowed = command_allowed("main", "main", "load_config", false);
            let handled = dispatch_if_allowed(
                allowed,
                (),
                |_| {
                    executions.set(executions.get() + 1);
                    expected
                },
                |_| rejections.set(rejections.get() + 1),
            );
            assert_eq!(handled, expected);
            assert_eq!(executions.get(), 1);
            assert_eq!(rejections.get(), 0);
        }
    }
}
