//! Native-only TOTP verification. Tokens never cross the Tauri/JavaScript boundary.
//! JWT decoding here is a consistency check on the fixed Auth HTTPS response;
//! the remote consent service independently verifies the signed AAL2 token.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use zeroize::Zeroizing;

#[derive(Deserialize)]
struct SessionClaims {
    iss: String,
    sub: String,
    session_id: String,
    aud: String,
    role: String,
    exp: u64,
    #[serde(default)]
    aal: String,
    #[serde(default)]
    oauth_client_id: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
}

fn canonical_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value && !id.is_nil())
}

fn claims(token: &str, now: u64) -> Result<SessionClaims, String> {
    if token.len() > 16_384 {
        return Err("REMOTE_MCP_MFA_SESSION_INVALID".into());
    }
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 || parts.iter().any(|p| p.is_empty()) {
        return Err("REMOTE_MCP_MFA_SESSION_INVALID".into());
    }
    let bytes = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| "REMOTE_MCP_MFA_SESSION_INVALID".to_string())?,
    );
    let c: SessionClaims =
        serde_json::from_slice(&bytes).map_err(|_| "REMOTE_MCP_MFA_SESSION_INVALID".to_string())?;
    if c.iss != format!("{}/auth/v1", crate::KATOSYNC_AUTH_URL)
        || !canonical_uuid(&c.sub)
        || !canonical_uuid(&c.session_id)
        || c.role != "authenticated"
        || c.aud != "authenticated"
        || c.exp <= now
        || c.oauth_client_id.is_some()
        || c.client_id.is_some()
    {
        return Err("REMOTE_MCP_MFA_SESSION_INVALID".into());
    }
    Ok(c)
}

pub(super) fn validate_native_session(token: &str, owner: &str) -> Result<(), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "REMOTE_MCP_MFA_CLOCK_INVALID".to_string())?
        .as_secs();
    let session = claims(token, now)?;
    if session.sub != owner {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    Ok(())
}

fn check_rotation(
    old: &SessionClaims,
    new: &SessionClaims,
    owner: &str,
    response_owner: &str,
) -> Result<(), String> {
    if old.sub != owner
        || new.sub != owner
        || response_owner != owner
        || old.session_id != new.session_id
        || new.aal != "aal2"
    {
        return Err("REMOTE_MCP_MFA_SESSION_MISMATCH".into());
    }
    Ok(())
}

#[derive(Deserialize)]
struct VerifiedUser {
    id: String,
}
#[derive(Deserialize)]
struct VerifiedSession {
    access_token: String,
    refresh_token: String,
    user: VerifiedUser,
}

pub(crate) async fn verify_remote_mcp_totp_native(
    factor_id: &str,
    challenge_id: &str,
    code: &str,
) -> Result<(), String> {
    if !canonical_uuid(factor_id)
        || !canonical_uuid(challenge_id)
        || code.len() != 6
        || !code.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("REMOTE_MCP_MFA_INPUT_INVALID".into());
    }
    let generation = crate::native_owner_session_generation();
    let owner = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "REMOTE_MCP_MFA_SESSION_INVALID".to_string())?;
    let _guard = crate::supabase_session_transition_lock().lock().await;
    let still_current = || generation == crate::native_owner_session_generation();
    if !still_current() {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    let access = Zeroizing::new(match crate::cached_supabase_access_token() {
        Some(token) => token,
        None => crate::refresh_supabase_session_under_lock()
            .await
            .map_err(|_| "REMOTE_MCP_MFA_SESSION_INVALID".to_string())?,
    });
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "REMOTE_MCP_MFA_CLOCK_INVALID".to_string())?
        .as_secs();
    let previous = claims(&access, now)?;
    if previous.sub != owner {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    if !still_current() {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "REMOTE_MCP_MFA_UNAVAILABLE".to_string())?;
    let mut response = client
        .post(format!(
            "{}/auth/v1/factors/{}/verify",
            crate::KATOSYNC_AUTH_URL,
            factor_id
        ))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(access.as_str())
        .json(&serde_json::json!({"challenge_id":challenge_id,"code":code}))
        .send()
        .await
        .map_err(|_| "REMOTE_MCP_MFA_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err(if response.status().as_u16() == 429 {
            "REMOTE_MCP_MFA_RATE_LIMITED"
        } else {
            "REMOTE_MCP_MFA_REJECTED"
        }
        .into());
    }
    if response.content_length().is_some_and(|n| n > 65_536) {
        return Err("REMOTE_MCP_MFA_RESPONSE_INVALID".into());
    }
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "REMOTE_MCP_MFA_RESPONSE_INVALID".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > 65_536 {
            return Err("REMOTE_MCP_MFA_RESPONSE_INVALID".into());
        }
        body.extend_from_slice(&chunk);
    }
    let session: VerifiedSession =
        serde_json::from_slice(&body).map_err(|_| "REMOTE_MCP_MFA_RESPONSE_INVALID".to_string())?;
    let new_access = Zeroizing::new(session.access_token);
    let new_refresh = Zeroizing::new(session.refresh_token);
    // Supabase legacy refresh tokens are 12 characters; newer tokens are
    // versioned. This is an opaque fixed-issuer credential, not a local
    // entropy policy. Reject empty/oversized/control-bearing responses only.
    if new_refresh.is_empty()
        || new_refresh.len() > 16_384
        || !new_refresh.bytes().all(|b| b.is_ascii_graphic())
    {
        return Err("REMOTE_MCP_MFA_RESPONSE_INVALID".into());
    }
    let after = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "REMOTE_MCP_MFA_CLOCK_INVALID".to_string())?
        .as_secs();
    let elevated = claims(&new_access, after)?;
    check_rotation(&previous, &elevated, &owner, &session.user.id)?;
    if !still_current() {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    // The refresh grant rotates on verify. Persist it atomically before exposing
    // access, while holding the same lock used by refresh, login, and logout.
    crate::save_supabase_refresh_token(&new_refresh)
        .map_err(|_| "REMOTE_MCP_MFA_KEYCHAIN_FAILED".to_string())?;
    crate::cache_supabase_access_token(Some(new_access.to_string()));
    if !still_current() {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: &str = "bfb1ef9f-3433-40f0-8f0e-4d26391c4258";
    const SESSION: &str = "f87ab056-2ef0-4d50-99a4-802beded127a";
    fn token(aal: &str) -> String {
        format!(
            "e30.{}.c2ln",
            URL_SAFE_NO_PAD.encode(
                serde_json::json!({
                    "iss":format!("{}/auth/v1",crate::KATOSYNC_AUTH_URL),
                    "sub":OWNER,"session_id":SESSION,"aud":"authenticated",
                    "role":"authenticated","exp":2000,"aal":aal
                })
                .to_string()
            )
        )
    }
    #[test]
    fn mfa_rotation_requires_same_owner_session_and_aal2() {
        let old = claims(&token("aal1"), 1000).unwrap();
        let mut new = claims(&token("aal2"), 1000).unwrap();
        assert!(check_rotation(&old, &new, OWNER, OWNER).is_ok());
        new.aal = "aal1".into();
        assert!(check_rotation(&old, &new, OWNER, OWNER).is_err());
        new.aal = "aal2".into();
        new.session_id = OWNER.into();
        assert!(check_rotation(&old, &new, OWNER, OWNER).is_err());
        assert!(check_rotation(&old, &old, SESSION, OWNER).is_err());
    }
    #[test]
    fn mfa_expired_and_noncanonical_sessions_are_rejected() {
        assert!(claims(&token("aal2"), 2000).is_err());
        assert!(!canonical_uuid(&OWNER.to_uppercase()));
        assert!(!canonical_uuid("00000000-0000-0000-0000-000000000000"));
        assert!(claims("opaque", 1000).is_err());
    }
}
