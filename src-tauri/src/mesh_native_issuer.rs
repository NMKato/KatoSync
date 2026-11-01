//! Stage 3R: native issuer boundary report. Never opens Keychain or HTTP.
//! An existing KATOOS or legacy session MUST NOT become a Preview credential.
use serde::Serialize;

const SHARED_KATOOS: &str = "https://xbnnlyyxiilklsygxcof.supabase.co";
const LEGACY_KATOSYNC: &str = "https://wspcuiylctlrvvpnwufk.supabase.co";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshNativeIssuerReadiness {
    protocol: &'static str,
    compiled_issuer: &'static str,
    isolated_preview_session: &'static str,
    current_session_reusable_for_preview: bool,
    preview_token_store_isolated: bool,
    preview_cloud_probe_enabled: bool,
    online_preview_verified: bool,
    device_pairing_enabled: bool,
    remote_jobs_enabled: bool,
}

/// Only a syntactically isolated public project URL can be recognized.
/// This is NOT an authentication check and must never authorize a cloud call.
pub(crate) fn parse_preview_target(origin: &str, reference: &str, deployment_id: &str) -> bool {
    if reference.len() != 20
        || !reference
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        || reference == "xbnnlyyxiilklsygxcof"
        || reference == "wspcuiylctlrvvpnwufk"
        || origin != format!("https://{reference}.supabase.co")
        || deployment_id.len() < 20 + 1 + 36 + 2
    {
        return false;
    }
    let Some((project, deployment_tail)) = deployment_id.split_once('_') else {
        return false;
    };
    if project != reference {
        return false;
    }
    let Some((deployment_uuid, version)) = deployment_tail.rsplit_once('_') else {
        return false;
    };
    if uuid::Uuid::parse_str(deployment_uuid).is_err()
        || version.starts_with('0')
        || version.is_empty()
        || !version.bytes().all(|b| b.is_ascii_digit())
    {
        return false;
    }
    true
}

fn native_issuer_readiness(issuer: &str) -> MeshNativeIssuerReadiness {
    let compiled_issuer = match issuer {
        SHARED_KATOOS => "katoos_shared_qa",
        LEGACY_KATOSYNC => "katosync_legacy",
        _ => "unknown_fail_closed",
    };
    // There is no independent Supabase Preview login/token store in this build.
    // Exposing a report never authenticates to any server.
    MeshNativeIssuerReadiness {
        protocol: "mesh-native-issuer-boundary-v1",
        compiled_issuer,
        isolated_preview_session: "independent_login_required",
        current_session_reusable_for_preview: false,
        preview_token_store_isolated: false,
        preview_cloud_probe_enabled: false,
        online_preview_verified: false,
        device_pairing_enabled: false,
        remote_jobs_enabled: false,
    }
}

#[tauri::command]
pub fn mesh_native_issuer_readiness() -> MeshNativeIssuerReadiness {
    native_issuer_readiness(crate::KATOSYNC_AUTH_URL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_native_session_can_never_authenticate_to_preview_tenant() {
        for issuer in [
            SHARED_KATOOS,
            LEGACY_KATOSYNC,
            "",
            "https://invalid.example",
        ] {
            let status = native_issuer_readiness(issuer);
            assert_eq!(status.protocol, "mesh-native-issuer-boundary-v1");
            assert_eq!(
                status.isolated_preview_session,
                "independent_login_required"
            );
            assert!(!status.current_session_reusable_for_preview);
            assert!(!status.preview_token_store_isolated);
            assert!(!status.preview_cloud_probe_enabled);
            assert!(!status.online_preview_verified);
            assert!(!status.device_pairing_enabled);
            assert!(!status.remote_jobs_enabled);
        }
        assert_eq!(
            native_issuer_readiness(SHARED_KATOOS).compiled_issuer,
            "katoos_shared_qa"
        );
        assert_eq!(
            native_issuer_readiness(LEGACY_KATOSYNC).compiled_issuer,
            "katosync_legacy"
        );
    }

    #[test]
    fn isolated_preview_url_and_deployment_must_match_exactly() {
        let ref_id = "abcdefghijklmnopqrst";
        let url = "https://abcdefghijklmnopqrst.supabase.co";
        let deployment = "abcdefghijklmnopqrst_11111111-1111-4111-8111-111111111111_1";
        assert!(parse_preview_target(url, ref_id, deployment));
        for (origin, reference, deployment_id) in [
            (SHARED_KATOOS, ref_id, deployment),
            (LEGACY_KATOSYNC, ref_id, deployment),
            (
                "https://abcdefghijklmnopqrst.supabase.co.evil.test",
                ref_id,
                deployment,
            ),
            (
                "https://abcdefghijklmnopqrst.supabase.co/path",
                ref_id,
                deployment,
            ),
            (url, "xbnnlyyxiilklsygxcof", deployment),
            (url, "wspcuiylctlrvvpnwufk", deployment),
            (url, "uvwxyzabcdefghijklmn", deployment),
            (
                url,
                ref_id,
                "uvwxyzabcdefghijklmn_11111111-1111-4111-8111-111111111111_1",
            ),
            (url, ref_id, ""),
            (
                url,
                ref_id,
                "abcdefghijklmnopqrst_11111111-1111-4111-8111-111111111111_0",
            ),
        ] {
            assert!(!parse_preview_target(origin, reference, deployment_id));
        }
    }

    #[test]
    fn detected_issuer_matches_compile_time_feature_without_token_read() {
        let actual = mesh_native_issuer_readiness();
        let expected = if cfg!(feature = "katoos-auth-qa") {
            "katoos_shared_qa"
        } else {
            "katosync_legacy"
        };
        assert_eq!(actual.compiled_issuer, expected);
        assert!(!actual.preview_cloud_probe_enabled);
    }
}
