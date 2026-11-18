//! Stage 3U: explicit, read-only KATOOS SSO -> katosync schema preflight.
//! No enrollment, account promotion, pairing, job or production schema mutation.
use serde::{Deserialize, Serialize};
use std::time::Duration;
use uuid::Uuid;
use zeroize::Zeroizing;

const CANONICAL_KATOOS: &str = "https://xbnnlyyxiilklsygxcof.supabase.co";
const SCHEMA: &str = "katosync";
const MAX_BODY: usize = 2048;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedKatoosPreflight {
    protocol: &'static str,
    shared_issuer_verified: bool,
    schema_accessible: bool,
    membership: &'static str,
    discovery_authorized: bool,
    paired: bool,
    transport_ready: bool,
    remote_jobs_enabled: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MembershipRow {
    user_id: String,
    access_state: String,
    authorized_at: Option<String>,
    revoked_at: Option<String>,
}
fn decode_membership(
    json: &[u8],
    expected_uid: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<&'static str, &'static str> {
    let owner = Uuid::parse_str(expected_uid).map_err(|_| "MESH_SHARED_BAD_OWNER")?;
    let rows: Vec<MembershipRow> =
        serde_json::from_slice(json).map_err(|_| "MESH_SHARED_INVALID_RESPONSE")?;
    if rows.len() > 1 {
        return Err("MESH_SHARED_INVALID_RESPONSE");
    }
    let Some(row) = rows.first() else {
        return Ok("not_member");
    };
    if Uuid::parse_str(&row.user_id).ok() != Some(owner) {
        return Err("MESH_SHARED_WRONG_OWNER");
    }
    if !matches!(
        row.access_state.as_str(),
        "active" | "pending" | "suspended" | "revoked"
    ) {
        return Err("MESH_SHARED_INVALID_RESPONSE");
    }
    if row.access_state != "active" {
        return Ok("not_member");
    }
    if row.revoked_at.is_some() {
        return Err("MESH_SHARED_INVALID_RESPONSE");
    }
    let when = row
        .authorized_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .ok_or("MESH_SHARED_INVALID_RESPONSE")?;
    if when.timestamp() > now.timestamp() + 5 {
        return Err("MESH_SHARED_INVALID_RESPONSE");
    }
    Ok("active")
}
#[tauri::command]
pub async fn mesh_katoos_shared_preflight() -> Result<SharedKatoosPreflight, String> {
    // Explicit QA: the installed stable/legacy app is NOT permitted to reinterpret its token.
    if !cfg!(feature = "katoos-auth-qa") || crate::KATOSYNC_AUTH_URL != CANONICAL_KATOOS {
        return Err("MESH_SHARED_NOT_CONFIGURED".into());
    }
    // /auth/v1/user issuer proof, not an offline email marker.
    let owner = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_SHARED_LOGIN_REQUIRED".to_string())?;
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|_| "MESH_SHARED_LOGIN_REQUIRED".to_string())?,
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "MESH_SHARED_UNAVAILABLE".to_string())?;
    let response = client
        .get(format!("{CANONICAL_KATOOS}/rest/v1/account_memberships"))
        .query(&[
            ("select", "user_id,access_state,authorized_at,revoked_at"),
            ("user_id", &format!("eq.{owner}")),
            ("limit", "2"),
        ])
        .header("Accept-Profile", SCHEMA)
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token.as_str())
        .send()
        .await
        .map_err(|_| "MESH_SHARED_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err("MESH_SHARED_SCHEMA_UNAVAILABLE".into());
    }
    if response
        .content_length()
        .is_some_and(|n| n > MAX_BODY as u64)
    {
        return Err("MESH_SHARED_INVALID_RESPONSE".into());
    }
    let mut response = response;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "MESH_SHARED_UNAVAILABLE".to_string())?
    {
        if chunk.len() > MAX_BODY - body.len() {
            return Err("MESH_SHARED_INVALID_RESPONSE".into());
        }
        body.extend_from_slice(&chunk);
    }
    let membership =
        decode_membership(&body, &owner, chrono::Utc::now()).map_err(str::to_string)?;
    // Fail closed if the account switched while the query was in flight.
    crate::mesh_identity::same_account_still_verified(&owner)
        .await
        .map_err(|_| "MESH_SHARED_LOGIN_REQUIRED".to_string())?;
    Ok(SharedKatoosPreflight {
        protocol: "mesh-katoos-shared-preflight-v1",
        shared_issuer_verified: true,
        schema_accessible: true,
        membership,
        discovery_authorized: membership == "active",
        paired: false,
        transport_ready: false,
        remote_jobs_enabled: false,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    const USER: &str = "11111111-1111-4111-8111-111111111111";
    fn membership(state: &str, owner: &str, date: &str, revoked: Option<&str>) -> Vec<u8> {
        serde_json::json!([{
            "user_id":owner,"access_state":state,"authorized_at":date,
            "revoked_at":revoked
        }])
        .to_string()
        .into_bytes()
    }
    #[test]
    fn active_owner_and_exact_schema_contract() {
        let now = chrono::Utc::now();
        let record = membership("active", USER, "2026-01-01T00:00:00Z", None);
        assert_eq!(decode_membership(&record, USER, now), Ok("active"));
        assert_eq!(decode_membership(b"[]", USER, now), Ok("not_member"));
        assert_eq!(
            decode_membership(
                &membership("pending", USER, "2026-01-01T00:00:00Z", None),
                USER,
                now
            ),
            Ok("not_member")
        );
        assert_eq!(
            decode_membership(
                &membership("suspended", USER, "2026-01-01T00:00:00Z", None),
                USER,
                now
            ),
            Ok("not_member")
        );
    }
    #[test]
    fn wrong_owner_revocation_and_unexpected_payload_fail_closed() {
        let now = chrono::Utc::now();
        let other = "22222222-2222-4222-8222-222222222222";
        assert_eq!(
            decode_membership(
                &membership("active", other, "2026-01-01T00:00:00Z", None),
                USER,
                now
            ),
            Err("MESH_SHARED_WRONG_OWNER")
        );
        assert!(decode_membership(
            &membership(
                "active",
                USER,
                "2026-01-01T00:00:00Z",
                Some("2026-01-02T00:00:00Z")
            ),
            USER,
            now
        )
        .is_err());
        assert!(decode_membership(
            &membership("active", USER, "2099-01-01T00:00:00Z", None),
            USER,
            now
        )
        .is_err());
        assert!(decode_membership(br#"{"user_id":"foo"}"#, USER, now).is_err());
        assert!(decode_membership(b"null", USER, now).is_err());
        assert!(decode_membership(&[record_with_extra()].concat(), USER, now).is_err());
    }
    fn record_with_extra() -> Vec<u8> {
        format!(r#"[{{"user_id":"{USER}","access_state":"active","authorized_at":"2026-01-01T00:00:00Z","revoked_at":null,"trust":true}}]"#).into_bytes()
    }
    #[test]
    fn multiple_and_unknown_memberships_are_not_admitted() {
        let now = chrono::Utc::now();
        let row =
            String::from_utf8(membership("active", USER, "2026-01-01T00:00:00Z", None)).unwrap();
        let obj = row.trim_start_matches('[').trim_end_matches(']');
        let combined = format!("[{obj},{obj}]");
        assert!(decode_membership(combined.as_bytes(), USER, now).is_err());
        assert!(decode_membership(
            &membership("elevated", USER, "2026-01-01T00:00:00Z", None),
            USER,
            now
        )
        .is_err());
    }
}
