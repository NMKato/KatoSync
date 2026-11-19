// Created by NMKato Solutions
//! Frische, kontogebundene Mesh-Topologie aus der bestehenden Data API.
//! Hauptrolle und gespeicherte Verbindung ersetzen weder Peer-Pin noch Auftragsfreigabe.
use crate::github_app_auth::AuthorityCheckError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, time::Duration};
use uuid::Uuid;
use zeroize::Zeroizing;

const MAX_REVISION: u64 = 9_007_199_254_740_991;
const MAX_RESPONSE: usize = 32_768;
const MAX_DEVICES: usize = 10;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VerifiedAccountDevice {
    pub device_id: String,
    pub owner_user_id: String,
    pub fingerprint: String,
    pub public_key: String,
    pub membership_state: String,
    pub revoked: bool,
    pub display_name: String,
    pub persona_name: Option<String>,
    pub platform_os: String,
    pub last_seen_at: Option<String>,
}

impl VerifiedAccountDevice {
    pub fn eligible(&self) -> bool {
        !self.revoked && matches!(self.membership_state.as_str(), "discovered" | "trusted")
    }
}

// Nur native Runtime. Insbesondere session_id wird nie als IPC-Snapshot serialisiert.
#[derive(Clone, Debug)]
pub struct VerifiedAccountConfiguration {
    pub owner_id: String,
    pub session_id: String,
    pub local_device_id: String,
    pub local_fingerprint: String,
    pub local_public_key: String,
    pub main_device_id: Option<String>,
    pub main_device_available: bool,
    pub account_revision: u64,
    pub devices: Vec<VerifiedAccountDevice>,
}

impl VerifiedAccountConfiguration {
    pub fn device(&self, device_id: &str) -> Option<&VerifiedAccountDevice> {
        self.devices
            .iter()
            .find(|device| device.device_id == device_id)
    }

    pub fn eligible_device(&self, device_id: &str) -> Option<&VerifiedAccountDevice> {
        self.device(device_id).filter(|device| device.eligible())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountNetworkSnapshot {
    pub owner_id: String,
    pub local_device_id: Option<String>,
    pub local_fingerprint: Option<String>,
    pub local_public_key: Option<String>,
    pub main_device_id: Option<String>,
    pub main_device_available: bool,
    pub account_revision: u64,
    pub devices: Vec<VerifiedAccountDevice>,
    pub account_verified: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NetworkWire {
    version: u8,
    owner_id: String,
    session_id: String,
    main_device_id: Option<String>,
    main_device_available: bool,
    account_revision: u64,
    devices: Vec<VerifiedAccountDevice>,
}

fn invalid() -> String {
    "MESH_ACCOUNT_INVALID_RESPONSE".into()
}

fn canonical_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}

fn public_key(value: &str) -> Result<VerifyingKey, String> {
    let bytes = URL_SAFE_NO_PAD.decode(value).map_err(|_| invalid())?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return Err(invalid());
    }
    let raw: [u8; 32] = bytes.try_into().map_err(|_| invalid())?;
    let key = VerifyingKey::from_bytes(&raw).map_err(|_| invalid())?;
    if key.is_weak() {
        return Err(invalid());
    }
    Ok(key)
}

fn validate_wire(wire: &NetworkWire, owner: &str) -> Result<(), String> {
    if wire.version != 1
        || !canonical_id(owner)
        || wire.owner_id != owner
        || !canonical_id(&wire.session_id)
        || wire.account_revision > MAX_REVISION
        || wire.devices.len() > MAX_DEVICES
        || wire.main_device_id.is_none() != (wire.account_revision == 0)
    {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut keys = HashSet::new();
    let mut fingerprints = HashSet::new();
    for device in &wire.devices {
        if !canonical_id(&device.device_id)
            || device.owner_user_id != owner
            || device.display_name.is_empty()
            || device.display_name.chars().count() > 80
            || device
                .persona_name
                .as_ref()
                .is_some_and(|name| name.chars().count() > 80)
            || !matches!(device.platform_os.as_str(), "macos" | "windows" | "linux")
            || !matches!(
                device.membership_state.as_str(),
                "discovered" | "pending" | "trusted" | "revoked"
            )
            || device.revoked != (device.membership_state == "revoked")
            || device
                .last_seen_at
                .as_ref()
                .is_some_and(|time| chrono::DateTime::parse_from_rfc3339(time).is_err())
            || !ids.insert(&device.device_id)
            || !keys.insert(&device.public_key)
            || !fingerprints.insert(&device.fingerprint)
        {
            return Err(invalid());
        }
        if crate::mesh_identity::fingerprint(&public_key(&device.public_key)?) != device.fingerprint
        {
            return Err(invalid());
        }
    }
    let main = match wire.main_device_id.as_deref() {
        Some(id) => Some(
            wire.devices
                .iter()
                .find(|device| device.device_id == id)
                .ok_or_else(invalid)?,
        ),
        None => None,
    };
    if wire.main_device_available != main.is_some_and(VerifiedAccountDevice::eligible) {
        return Err(invalid());
    }
    Ok(())
}

fn snapshot(wire: &NetworkWire, local_key: Option<&VerifyingKey>) -> AccountNetworkSnapshot {
    let local_public_key = local_key.map(|key| URL_SAFE_NO_PAD.encode(key.as_bytes()));
    let local_device_id = local_public_key.as_ref().and_then(|key| {
        wire.devices
            .iter()
            .find(|device| &device.public_key == key)
            .map(|device| device.device_id.clone())
    });
    AccountNetworkSnapshot {
        owner_id: wire.owner_id.clone(),
        local_device_id,
        local_fingerprint: local_key.map(crate::mesh_identity::fingerprint),
        local_public_key,
        main_device_id: wire.main_device_id.clone(),
        main_device_available: wire.main_device_available,
        account_revision: wire.account_revision,
        devices: wire.devices.clone(),
        account_verified: true,
    }
}

// Eine vorübergehend nicht prüfbare Authority darf den gespeicherten Verbindungswunsch
// nicht widerrufen. Jeder neue Versuch muss sämtliche Autoritätsprüfungen erneut bestehen.
fn authority_failure(error: AuthorityCheckError, denied_code: &'static str) -> String {
    if error.is_unavailable() {
        "MESH_ACCOUNT_AUTHORITY_UNAVAILABLE".into()
    } else {
        denied_code.into()
    }
}

fn check_generation(generation: u64) -> Result<(), String> {
    if generation != crate::native_owner_session_generation() {
        return Err("MESH_ACCOUNT_SESSION_CHANGED".into());
    }
    Ok(())
}

async fn bounded_body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err(invalid());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "MESH_ACCOUNT_UNAVAILABLE".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(invalid());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn request_error(status: u16, body: &[u8]) -> String {
    // Nur feste bekannte Kategorien, niemals Datenbankdetails oder Token ausgeben.
    let parsed: Option<Value> = serde_json::from_slice(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str);
    match message {
        Some("MESH_ACCOUNT_REVISION_CONFLICT") => "MESH_ACCOUNT_REVISION_CONFLICT",
        Some("MESH_ACCOUNT_DEVICE_UNAVAILABLE") => "MESH_ACCOUNT_DEVICE_UNAVAILABLE",
        Some("MESH_ACCOUNT_MEMBERSHIP_REQUIRED") => "MESH_ACCOUNT_MEMBERSHIP_REQUIRED",
        Some("MESH_ACCOUNT_LOGIN_REQUIRED") => "MESH_ACCOUNT_LOGIN_REQUIRED",
        _ if status == 401 => "MESH_ACCOUNT_LOGIN_REQUIRED",
        _ if status == 404 => "MESH_ACCOUNT_NOT_AVAILABLE",
        _ => "MESH_ACCOUNT_UNAVAILABLE",
    }
    .into()
}

async fn request(
    selection: Option<(&str, u64)>,
) -> Result<(NetworkWire, Option<VerifyingKey>), String> {
    if !cfg!(feature = "katoos-auth-qa") {
        return Err("MESH_ACCOUNT_NOT_CONFIGURED".into());
    }
    let generation = crate::native_owner_session_generation();
    let owner = crate::github_app_auth::verified_katosync_user_classified()
        .await
        .map_err(|error| authority_failure(error, "MESH_ACCOUNT_LOGIN_REQUIRED"))?;
    check_generation(generation)?;
    let token = Zeroizing::new(
        crate::ensure_supabase_access_token()
            .await
            .map_err(|error| {
                authority_failure(
                    AuthorityCheckError::from_session(&error, "MESH_ACCOUNT_LOGIN_REQUIRED"),
                    "MESH_ACCOUNT_LOGIN_REQUIRED",
                )
            })?,
    );
    let (rpc, body) = match selection {
        Some((device_id, revision)) => (
            "mesh_account_network_set_primary",
            json!({"p_device_id":device_id,"p_expected_revision":revision}),
        ),
        None => ("mesh_account_network_get", json!({})),
    };
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|_| "MESH_ACCOUNT_UNAVAILABLE".to_string())?;
    check_generation(generation)?;
    let response = client
        .post(format!("{}/rest/v1/rpc/{rpc}", crate::KATOSYNC_AUTH_URL))
        .header("apikey", crate::KATOSYNC_AUTH_ANON_KEY)
        .header("Accept-Profile", "katosync")
        .header("Content-Profile", "katosync")
        .bearer_auth(token.as_str())
        .json(&body)
        .send()
        .await
        .map_err(|_| "MESH_ACCOUNT_UNAVAILABLE".to_string())?;
    let status = response.status();
    let body = bounded_body(response).await?;
    check_generation(generation)?;
    if !status.is_success() {
        return Err(request_error(status.as_u16(), &body));
    }
    let wire: NetworkWire = serde_json::from_slice(&body).map_err(|_| invalid())?;
    validate_wire(&wire, &owner)?;
    crate::mesh_identity::same_account_still_verified_classified(&owner)
        .await
        .map_err(|error| authority_failure(error, "MESH_ACCOUNT_SESSION_CHANGED"))?;
    check_generation(generation)?;
    // Ein reiner Refresh erzeugt keinen Schluessel und keine Registrierung.
    let local_key = crate::mesh_identity::existing_identity_if_present(&owner)
        .map_err(|_| "MESH_ACCOUNT_IDENTITY_UNAVAILABLE".to_string())?
        .map(|signing| signing.verifying_key());
    check_generation(generation)?;
    Ok((wire, local_key))
}

pub async fn mesh_account_network_get() -> Result<AccountNetworkSnapshot, String> {
    let (wire, local_key) = request(None).await?;
    Ok(snapshot(&wire, local_key.as_ref()))
}

pub async fn mesh_account_network_set_primary(
    device_id: String,
    expected_revision: u64,
) -> Result<AccountNetworkSnapshot, String> {
    if !canonical_id(&device_id) || expected_revision > MAX_REVISION {
        return Err("MESH_ACCOUNT_INVALID_SELECTION".into());
    }
    let (wire, local_key) = request(Some((&device_id, expected_revision))).await?;
    if wire.main_device_id.as_deref() != Some(device_id.as_str()) || !wire.main_device_available {
        return Err("MESH_ACCOUNT_REVISION_CONFLICT".into());
    }
    Ok(snapshot(&wire, local_key.as_ref()))
}

pub async fn verified_configuration() -> Result<VerifiedAccountConfiguration, String> {
    let (wire, local_key) = request(None).await?;
    let local_key = local_key.ok_or_else(|| "MESH_ACCOUNT_DEVICE_NOT_REGISTERED".to_string())?;
    let local_public_key = URL_SAFE_NO_PAD.encode(local_key.as_bytes());
    let local = wire
        .devices
        .iter()
        .find(|device| device.public_key == local_public_key && device.eligible())
        .ok_or_else(|| "MESH_ACCOUNT_DEVICE_NOT_REGISTERED".to_string())?;
    Ok(VerifiedAccountConfiguration {
        owner_id: wire.owner_id,
        session_id: wire.session_id,
        local_device_id: local.device_id.clone(),
        local_fingerprint: crate::mesh_identity::fingerprint(&local_key),
        local_public_key,
        main_device_id: wire.main_device_id,
        main_device_available: wire.main_device_available,
        account_revision: wire.account_revision,
        devices: wire.devices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::SigningKey;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    // Echte typisierte reqwest-Fehler aus einer reinen Loopback-Autoritätsfixture;
    // keine Zugangsdaten, Keychain-Lesezugriffe oder externen Dienste.
    async fn authority_http_failure(status: u16) -> reqwest::Error {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 2048];
            stream.read(&mut request).await.unwrap();
            let response = format!(
                "HTTP/1.1 {status} Synthetic\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
            );
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap();
        server.await.unwrap();
        response.error_for_status().unwrap_err()
    }

    fn assert_authority_failure_codes(error: reqwest::Error, unavailable: bool) {
        // Ownerprüfung und spätere Kontogleichheitsprüfung behalten jeweils ihren
        // bisherigen terminalen Code; die typisierte temporäre Klasse bleibt erhalten.
        for denied in [
            "MESH_ACCOUNT_LOGIN_REQUIRED",
            "MESH_ACCOUNT_SESSION_CHANGED",
        ] {
            let classified = AuthorityCheckError::from_request(&error, "synthetic authority");
            assert_eq!(
                authority_failure(classified, denied),
                if unavailable {
                    "MESH_ACCOUNT_AUTHORITY_UNAVAILABLE"
                } else {
                    denied
                }
            );
        }
        // Auch eine Refresh-Fehlerkette mit anyhow-Kontext darf die Klasse nicht verlieren.
        let refresh_error = anyhow::Error::new(error).context("synthetic refresh context");
        assert_eq!(
            authority_failure(
                AuthorityCheckError::from_session(&refresh_error, "synthetic refresh"),
                "MESH_ACCOUNT_LOGIN_REQUIRED"
            ),
            if unavailable {
                "MESH_ACCOUNT_AUTHORITY_UNAVAILABLE"
            } else {
                "MESH_ACCOUNT_LOGIN_REQUIRED"
            }
        );
    }

    #[tokio::test]
    async fn account_authority_http_retries_do_not_become_terminal_login_failures() {
        for (status, unavailable) in [
            (401, false),
            (403, false),
            (429, true),
            (500, true),
            (503, true),
        ] {
            assert_authority_failure_codes(authority_http_failure(status).await, unavailable);
        }
    }

    #[tokio::test]
    async fn account_authority_connection_and_timeout_failures_remain_retryable() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let refused = client
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap_err();
        assert!(refused.is_connect());
        assert_authority_failure_codes(refused, true);

        let stalled = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = stalled.local_addr().unwrap();
        let timed_out = client
            .get(format!("http://{address}/"))
            .timeout(Duration::from_millis(50))
            .send()
            .await
            .unwrap_err();
        assert!(timed_out.is_timeout());
        assert_authority_failure_codes(timed_out, true);
    }

    #[test]
    fn account_authority_owner_keychain_and_malformed_failures_stay_denied() {
        assert_eq!(
            authority_failure(
                AuthorityCheckError::denied("synthetic owner changed"),
                "MESH_ACCOUNT_SESSION_CHANGED"
            ),
            "MESH_ACCOUNT_SESSION_CHANGED"
        );
        let malformed = serde_json::from_str::<Value>("{").unwrap_err();
        for error in [
            anyhow::Error::new(keyring::Error::NoEntry).context("synthetic missing credential"),
            anyhow::Error::new(malformed).context("synthetic malformed response"),
            anyhow::anyhow!("timeout connect 429 503 is only text, not a typed transport failure"),
        ] {
            assert_eq!(
                authority_failure(
                    AuthorityCheckError::from_session(&error, "synthetic session"),
                    "MESH_ACCOUNT_LOGIN_REQUIRED"
                ),
                "MESH_ACCOUNT_LOGIN_REQUIRED"
            );
        }
    }
    const OWNER: &str = "11111111-1111-4111-8111-111111111111";
    const DEVICE: &str = "22222222-2222-4222-8222-222222222222";
    fn fixture() -> (NetworkWire, VerifyingKey) {
        let key = SigningKey::from_bytes(&[7; 32]).verifying_key();
        let wire = NetworkWire {
            version: 1,
            owner_id: OWNER.into(),
            session_id: "33333333-3333-4333-8333-333333333333".into(),
            main_device_id: Some(DEVICE.into()),
            main_device_available: true,
            account_revision: 1,
            devices: vec![VerifiedAccountDevice {
                device_id: DEVICE.into(),
                owner_user_id: OWNER.into(),
                fingerprint: crate::mesh_identity::fingerprint(&key),
                public_key: URL_SAFE_NO_PAD.encode(key.as_bytes()),
                membership_state: "discovered".into(),
                revoked: false,
                display_name: "Testgeraet".into(),
                persona_name: None,
                platform_os: "macos".into(),
                last_seen_at: None,
            }],
        };
        (wire, key)
    }
    #[test]
    fn cloud_owner_and_exact_registered_key_are_required() {
        let (wire, _) = fixture();
        assert!(validate_wire(&wire, OWNER).is_ok());
        let mut bad = wire.clone();
        bad.owner_id = DEVICE.into();
        assert!(validate_wire(&bad, OWNER).is_err());
        let mut bad = wire.clone();
        bad.devices[0].public_key =
            URL_SAFE_NO_PAD.encode(SigningKey::from_bytes(&[8; 32]).verifying_key().as_bytes());
        assert!(validate_wire(&bad, OWNER).is_err());
        let mut bad = wire.clone();
        bad.devices.push(bad.devices[0].clone());
        assert!(validate_wire(&bad, OWNER).is_err());
    }
    #[test]
    fn revoked_main_remains_selected_but_cannot_be_used() {
        let (mut wire, _) = fixture();
        wire.devices[0].revoked = true;
        wire.devices[0].membership_state = "revoked".into();
        assert!(validate_wire(&wire, OWNER).is_err());
        wire.main_device_available = false;
        assert!(validate_wire(&wire, OWNER).is_ok());
        assert!(!wire.devices[0].eligible());
        assert_eq!(wire.main_device_id.as_deref(), Some(DEVICE));
    }
    #[test]
    fn pending_is_visible_but_never_an_available_main() {
        let (mut wire, _) = fixture();
        wire.devices[0].membership_state = "pending".into();
        assert!(validate_wire(&wire, OWNER).is_err());
        wire.main_device_available = false;
        assert!(validate_wire(&wire, OWNER).is_ok());
        assert!(!wire.devices[0].eligible());
        wire.devices[0].membership_state = "trusted".into();
        wire.main_device_available = true;
        assert!(validate_wire(&wire, OWNER).is_ok());
    }
    #[test]
    fn unconfigured_and_unregistered_snapshots_are_read_only_empty_states() {
        let (mut wire, key) = fixture();
        wire.main_device_id = None;
        wire.account_revision = 0;
        wire.main_device_available = false;
        assert!(validate_wire(&wire, OWNER).is_ok());
        let no_identity = snapshot(&wire, None);
        assert!(no_identity.local_device_id.is_none());
        assert!(no_identity.local_public_key.is_none());
        wire.devices.clear();
        assert!(validate_wire(&wire, OWNER).is_ok());
        let not_enrolled = snapshot(&wire, Some(&key));
        assert!(not_enrolled.local_device_id.is_none());
        assert!(not_enrolled.local_public_key.is_some());
        let json = serde_json::to_value(not_enrolled).unwrap();
        assert!(json.get("sessionId").is_none());
        assert_eq!(json["accountVerified"], true);
        assert!(json.get("transportReady").is_none());
        assert!(json.get("remoteJobsEnabled").is_none());
    }
    #[test]
    fn malformed_identity_revision_and_flags_fail_closed() {
        let (wire, _) = fixture();
        let mut bad = wire.clone();
        bad.account_revision = MAX_REVISION + 1;
        assert!(validate_wire(&bad, OWNER).is_err());
        let mut bad = wire.clone();
        bad.account_revision = 0;
        assert!(validate_wire(&bad, OWNER).is_err());
        let mut bad = wire.clone();
        bad.session_id = Uuid::nil().to_string();
        assert!(validate_wire(&bad, OWNER).is_err());
        let mut bad = wire.clone();
        bad.devices[0].revoked = true;
        assert!(validate_wire(&bad, OWNER).is_err());
        let mut bad = wire.clone();
        bad.main_device_id = Some(OWNER.into());
        assert!(validate_wire(&bad, OWNER).is_err());
    }
    #[test]
    fn error_messages_never_forward_untrusted_database_details() {
        assert_eq!(
            request_error(500, br#"{"message":"private token and sql details"}"#),
            "MESH_ACCOUNT_UNAVAILABLE"
        );
        assert_eq!(
            request_error(500, br#"{"message":"MESH_ACCOUNT_REVISION_CONFLICT"}"#),
            "MESH_ACCOUNT_REVISION_CONFLICT"
        );
    }
}
