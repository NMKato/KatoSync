//! Private-beta outbound presence relay with separately opted-in Git status.
//! Ticket scope comes only from fixed-host HTTPS and is independently bound by
//! a compiled Ed25519 server pin before any device signature is transmitted.
use crate::mesh_rc67_presence_qa::{sign_presence_jws, PresenceContext};
use crate::mesh_rc72_signed_server_qa::{
    verify_rc70_challenge_packet, verify_signed_server_notice, ExpectedServerNotice,
    PinnedServerContext,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{SigningKey, VerifyingKey};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::task::JoinHandle;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

mod git_status;

const HOST: &str = "https://remote-mcp.katoos.de";
const SOCKET: &str = "wss://remote-mcp.katoos.de/api/device-relay/socket";
const FRESH_MS: u64 = 15_000;
const AUTH_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RelayStatus {
    state: String,
    last_heartbeat_at: Option<u64>,
    expires_at: Option<u64>,
    error_code: Option<String>,
    device_access_enabled: bool,
    remote_jobs_enabled: bool,
    read_only_git_status_enabled: bool,
    approved_project_ids: Vec<String>,
}
impl RelayStatus {
    fn state(state: &str, error: Option<&str>) -> Self {
        Self {
            state: state.into(),
            last_heartbeat_at: None,
            expires_at: None,
            error_code: error.map(str::to_owned),
            device_access_enabled: false,
            remote_jobs_enabled: false,
            read_only_git_status_enabled: false,
            approved_project_ids: Vec::new(),
        }
    }
}
struct Runtime {
    generation: u64,
    status: RelayStatus,
    deadline: Option<Instant>,
    task: Option<JoinHandle<()>>,
}
static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();
fn runtime() -> &'static Mutex<Runtime> {
    RUNTIME.get_or_init(|| {
        Mutex::new(Runtime {
            generation: 0,
            status: RelayStatus::state("idle", None),
            deadline: None,
            task: None,
        })
    })
}
fn now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|_| "REMOTE_MCP_RELAY_CLOCK_INVALID".into())
}
fn publish(generation: u64, state: &str, error: Option<&str>) {
    let mut r = runtime().lock().unwrap_or_else(|e| e.into_inner());
    if r.generation == generation {
        r.status = RelayStatus::state(state, error);
        r.deadline = None;
    }
}
fn publish_ack(
    generation: u64,
    owner_generation: u64,
    acknowledged_at: u64,
    expires: u64,
    project_ids: &[String],
) -> Result<(), String> {
    let mut r = runtime().lock().unwrap_or_else(|e| e.into_inner());
    if r.generation != generation || crate::native_owner_session_generation() != owner_generation {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    let now = now_ms()?;
    if expires <= now || now < acknowledged_at || now.saturating_sub(acknowledged_at) >= FRESH_MS {
        return Err("REMOTE_MCP_RELAY_HEARTBEAT_EXPIRED".into());
    }
    r.status = RelayStatus {
        state: "connected".into(),
        last_heartbeat_at: Some(acknowledged_at),
        expires_at: Some(expires),
        error_code: None,
        device_access_enabled: false,
        remote_jobs_enabled: false,
        read_only_git_status_enabled: !project_ids.is_empty(),
        approved_project_ids: project_ids.to_vec(),
    };
    r.deadline = Some(Instant::now() + Duration::from_millis(expires - now));
    Ok(())
}
pub(crate) fn remote_mcp_relay_status() -> RelayStatus {
    let r = runtime().lock().unwrap_or_else(|e| e.into_inner());
    if r.status.state == "connected" {
        let fresh = now_ms().is_ok_and(|now| {
            r.status
                .last_heartbeat_at
                .is_some_and(|last| now >= last && now - last < FRESH_MS)
                && r.status.expires_at.is_some_and(|expires| now < expires)
        }) && r.deadline.is_some_and(|deadline| Instant::now() < deadline)
            && r.task.as_ref().is_some_and(|t| !t.is_finished());
        if !fresh {
            return RelayStatus::state("reconnecting", Some("REMOTE_MCP_RELAY_HEARTBEAT_EXPIRED"));
        }
    }
    r.status.clone()
}
pub(crate) fn invalidate_owner_session() {
    let mut r = runtime().lock().unwrap_or_else(|e| e.into_inner());
    r.generation = r.generation.wrapping_add(1);
    if let Some(task) = r.task.take() {
        task.abort();
    }
    r.status = RelayStatus::state("idle", None);
    r.deadline = None;
}
async fn reserve() -> u64 {
    let (generation, old) = {
        let mut r = runtime().lock().unwrap_or_else(|e| e.into_inner());
        r.generation = r.generation.wrapping_add(1);
        r.status = RelayStatus::state("idle", None);
        r.deadline = None;
        (r.generation, r.task.take())
    };
    if let Some(old) = old {
        old.abort();
        let _ = old.await;
    }
    generation
}
pub(crate) async fn remote_mcp_relay_stop() -> RelayStatus {
    reserve().await;
    remote_mcp_relay_status()
}
pub(crate) async fn remote_mcp_relay_projects() -> Result<serde_json::Value, String> {
    let owner = crate::remote_mcp_owner_review::context().await?;
    let registry = crate::project_registry::project_registry_load()
        .map_err(|_| "REMOTE_MCP_GIT_REGISTRY_INVALID".to_string())?
        .ok_or("REMOTE_MCP_GIT_REGISTRY_INVALID")?;
    let options = git_status::project_options(&registry).map_err(str::to_owned)?;
    crate::remote_mcp_owner_review::check_generation(&owner)?;
    serde_json::to_value(options).map_err(|_| "REMOTE_MCP_GIT_REGISTRY_INVALID".into())
}
pub(crate) async fn remote_mcp_relay_start(
    project_ids: Vec<String>,
) -> Result<RelayStatus, String> {
    server_key()?;
    // Bind selection before any asynchronous work. The reserved supervisor
    // verifies this same owner's live session before requesting a ticket.
    let owner_generation = crate::native_owner_session_generation();
    let projects = if project_ids.is_empty() {
        Vec::new()
    } else {
        let registry = crate::project_registry::project_registry_load()
            .map_err(|_| "REMOTE_MCP_GIT_REGISTRY_INVALID".to_string())?
            .ok_or("REMOTE_MCP_GIT_REGISTRY_INVALID")?;
        git_status::approve_projects(&registry, &project_ids).map_err(str::to_owned)?
    };
    let generation = reserve().await;
    let mut r = runtime().lock().unwrap_or_else(|e| e.into_inner());
    if r.generation != generation || owner_generation != crate::native_owner_session_generation() {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    r.status = RelayStatus::state("connecting", None);
    r.task = Some(tokio::spawn(supervise(
        generation,
        owner_generation,
        projects,
    )));
    Ok(r.status.clone())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ServerPin {
    kid: String,
    x: String,
}
fn server_key() -> Result<(String, VerifyingKey), String> {
    let pin: ServerPin = serde_json::from_str(include_str!("remote_mcp_server_pin.json"))
        .map_err(|_| "REMOTE_MCP_RELAY_PIN_INVALID".to_string())?;
    let bytes: [u8; 32] = URL_SAFE_NO_PAD
        .decode(&pin.x)
        .ok()
        .and_then(|v| v.try_into().ok())
        .ok_or("REMOTE_MCP_RELAY_PIN_INVALID")?;
    if pin.kid != "katosync_beta4_relay_20261118b" || URL_SAFE_NO_PAD.encode(bytes) != pin.x {
        return Err("REMOTE_MCP_RELAY_PIN_INVALID".into());
    }
    let key =
        VerifyingKey::from_bytes(&bytes).map_err(|_| "REMOTE_MCP_RELAY_PIN_INVALID".to_string())?;
    Ok((pin.kid, key))
}
fn current(generation: u64, owner_generation: u64) -> Result<(), String> {
    if runtime()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .generation
        != generation
        || crate::native_owner_session_generation() != owner_generation
    {
        return Err("REMOTE_MCP_OWNER_CHANGED".into());
    }
    Ok(())
}
fn transient(code: &str) -> bool {
    matches!(
        code,
        "REMOTE_MCP_RELAY_UNAVAILABLE"
            | "REMOTE_MCP_RELAY_DISCONNECTED"
            | "REMOTE_MCP_RELAY_HEARTBEAT_EXPIRED"
            | "REMOTE_MCP_RELAY_TIMEOUT"
            | "REMOTE_MCP_RELAY_CLOCK_CHANGED"
            | "REMOTE_MCP_GIT_DEADLINE"
    )
}
async fn supervise(
    generation: u64,
    owner_generation: u64,
    projects: Vec<git_status::ApprovedProject>,
) {
    let mut backoff = 1;
    loop {
        if current(generation, owner_generation).is_err() {
            return;
        }
        publish(generation, "connecting", None);
        match session(generation, owner_generation, &projects).await {
            Ok(()) => {
                backoff = 1;
                publish(generation, "reconnecting", None);
            }
            Err(code) if transient(&code) => {
                publish(generation, "reconnecting", Some(&code));
                tokio::time::sleep(Duration::from_secs(backoff)).await;
                backoff = (backoff * 2).min(16);
            }
            Err(code) => {
                publish(generation, "blocked", Some(&code));
                return;
            }
        }
    }
}
async fn bounded_body(mut response: reqwest::Response) -> Result<Zeroizing<Vec<u8>>, String> {
    if response.content_length().is_some_and(|n| n > 32_768) {
        return Err("REMOTE_MCP_RELAY_RESPONSE_INVALID".into());
    }
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "REMOTE_MCP_RELAY_UNAVAILABLE".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > 32_768 {
            return Err("REMOTE_MCP_RELAY_RESPONSE_INVALID".into());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
fn http_error(status: reqwest::StatusCode) -> String {
    if status.is_server_error() || status.as_u16() == 429 {
        "REMOTE_MCP_RELAY_UNAVAILABLE".into()
    } else if status.as_u16() == 401 {
        "REMOTE_MCP_RELAY_LOGIN_REQUIRED".into()
    } else {
        "REMOTE_MCP_RELAY_CONSENT_REQUIRED".into()
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Enrollment {
    device_id: Uuid,
    owner_user_id: Uuid,
    signing_public_key: String,
    fingerprint: String,
    membership_state: String,
    enrolled_at: Option<String>,
    revoked_at: Option<String>,
}
async fn own_device(
    client: &reqwest::Client,
    token: &str,
    owner: Uuid,
    key: &SigningKey,
) -> Result<Uuid, String> {
    let public = URL_SAFE_NO_PAD.encode(key.verifying_key().as_bytes());
    let response=client.get(format!("{}/rest/v1/mesh_devices",crate::KATOSYNC_AUTH_URL))
        .header("Accept-Profile","katosync").header("apikey",crate::KATOSYNC_AUTH_ANON_KEY)
        .bearer_auth(token).query(&[
            ("select","device_id,owner_user_id,signing_public_key,fingerprint,membership_state,enrolled_at,revoked_at"),
            ("owner_user_id",&format!("eq.{owner}")),("signing_public_key",&format!("eq.{public}")),("limit","2")])
        .send().await.map_err(|_|"REMOTE_MCP_RELAY_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    let records: Vec<Enrollment> = serde_json::from_slice(&bounded_body(response).await?)
        .map_err(|_| "REMOTE_MCP_RELAY_RESPONSE_INVALID".to_string())?;
    if records.len() != 1 {
        return Err("REMOTE_MCP_RELAY_DEVICE_NOT_ENROLLED".into());
    }
    let row = &records[0];
    if row.owner_user_id != owner
        || row.signing_public_key != public
        || row.fingerprint != crate::mesh_identity::fingerprint(&key.verifying_key())
        || row.enrolled_at.is_none()
        || row.revoked_at.is_some()
        || row.membership_state != "trusted"
    {
        return Err("REMOTE_MCP_RELAY_DEVICE_CONSENT_REQUIRED".into());
    }
    Ok(row.device_id)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Ticket {
    version: u8,
    protocol: String,
    owner_id: Uuid,
    tenant_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    session_id: Uuid,
    ticket: String,
    challenge_id: Uuid,
    device_key_id: String,
    revoke_epoch: u64,
    ticket_expires_at_ms: u64,
    expires_at_ms: u64,
    readmit_at_ms: u64,
    route: String,
    remote_execution_allowed: bool,
    #[serde(default)]
    native_tool_names: Vec<String>,
    #[serde(default)]
    admitted_project_ids: Vec<String>,
    #[serde(default)]
    oauth_client_id: Option<Uuid>,
    #[serde(default)]
    authority_revision: Option<String>,
}
impl Drop for Ticket {
    fn drop(&mut self) {
        self.ticket.zeroize();
    }
}
fn valid_ticket(
    t: &Ticket,
    owner: Uuid,
    device: Uuid,
    key: &SigningKey,
    now: u64,
    projects: &[git_status::ApprovedProject],
) -> Result<(), String> {
    let digest = Sha256::digest(key.verifying_key().as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let ids = [
        t.owner_id,
        t.tenant_id,
        t.grant_id,
        t.device_id,
        t.session_id,
        t.challenge_id,
    ];
    if t.version != 1
        || t.protocol != "rc67-beta-native-v1"
        || t.owner_id != owner
        || t.device_id != device
        || ids.iter().any(|id| {
            !(1..=8).contains(&id.get_version_num())
                || !matches!(id.get_variant(), uuid::Variant::RFC4122)
        })
        || t.device_key_id != format!("mesh_ed25519_{}", &digest[..40])
        || t.route != "/api/device-relay/socket"
        || t.remote_execution_allowed
        || t.ticket.len() != 64
        || !t
            .ticket
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || t.revoke_epoch > 2_147_483_647
        || t.ticket_expires_at_ms <= now
        || t.ticket_expires_at_ms > t.expires_at_ms
        || t.expires_at_ms <= now
        || t.expires_at_ms.saturating_sub(now) > 45_000
        || t.readmit_at_ms == 0
        || t.readmit_at_ms > t.expires_at_ms
    {
        return Err("REMOTE_MCP_RELAY_TICKET_INVALID".into());
    }
    if t.admitted_project_ids.len() != projects.len()
        || t.admitted_project_ids.iter().collect::<HashSet<_>>().len() != projects.len()
        || projects
            .iter()
            .any(|project| !t.admitted_project_ids.contains(&project.id))
        || if projects.is_empty() {
            !t.native_tool_names.is_empty()
        } else {
            t.native_tool_names != [git_status::TOOL]
                || t.oauth_client_id.is_none_or(|id| id.is_nil())
                || t.authority_revision.as_ref().is_none_or(|revision| {
                    revision.len() != 64
                        || !revision
                            .bytes()
                            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                })
        }
    {
        return Err("REMOTE_MCP_RELAY_TICKET_SCOPE_INVALID".into());
    }
    Ok(())
}
fn renewal_deadline(ticket: &Ticket) -> u64 {
    ticket
        .readmit_at_ms
        .min(ticket.expires_at_ms.saturating_sub(FRESH_MS))
}

fn renewal_due(now: u64, start_wall: u64, elapsed: u64, renew_at: u64) -> Result<bool, String> {
    if now < start_wall || now.saturating_sub(start_wall).abs_diff(elapsed) > 5_000 {
        return Err("REMOTE_MCP_RELAY_CLOCK_CHANGED".into());
    }
    Ok(now >= renew_at || elapsed >= renew_at.saturating_sub(start_wall))
}

fn remaining_execution_ms(deadline: u64, now: u64) -> Result<u64, String> {
    deadline
        .checked_sub(now)
        .filter(|remaining| *remaining > 0)
        .ok_or_else(|| "REMOTE_MCP_GIT_DEADLINE".into())
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
async fn read_text(socket: &mut Socket) -> Result<String, String> {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => return Ok(text),
                Some(Ok(Message::Ping(bytes))) => socket
                    .send(Message::Pong(bytes))
                    .await
                    .map_err(|_| "REMOTE_MCP_RELAY_DISCONNECTED".to_string())?,
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Close(_))) | None => {
                    return Err("REMOTE_MCP_RELAY_DISCONNECTED".into())
                }
                Some(Err(_)) => return Err("REMOTE_MCP_RELAY_DISCONNECTED".into()),
                _ => return Err("REMOTE_MCP_RELAY_PACKET_INVALID".into()),
            }
        }
    })
    .await
    .map_err(|_| "REMOTE_MCP_RELAY_TIMEOUT".to_string())?
}
fn verify_presence_ack(
    packet: &str,
    pin: &PinnedServerContext<'_>,
    challenge_id: Uuid,
    device_sequence: u64,
    last_server_sequence: u64,
    now: u64,
    tool_names: &[String],
) -> Result<crate::mesh_rc72_signed_server_qa::VerifiedServerNotice, String> {
    if packet.len() > 24_576 {
        return Err("REMOTE_MCP_RELAY_PACKET_INVALID".into());
    }
    let doc: serde_json::Value =
        serde_json::from_str(packet).map_err(|_| "REMOTE_MCP_RELAY_PACKET_INVALID".to_string())?;
    if doc["type"] != "rc69.presence.accepted"
        || doc["serverKid"].as_str() != Some(pin.kid)
        || doc["sessionId"].as_str() != Some(pin.session_id.to_string().as_str())
        || doc["acceptedSequence"].as_u64() != Some(device_sequence)
        || doc["remoteExecutionAllowed"] != false
        || doc["nativeToolNames"] != serde_json::json!(tool_names)
    {
        return Err("REMOTE_MCP_RELAY_PACKET_INVALID".into());
    }
    let proof = doc["serverProofJws"]
        .as_str()
        .ok_or("REMOTE_MCP_RELAY_PACKET_INVALID")?;
    let mut verified = verify_signed_server_notice(
        proof,
        pin,
        ExpectedServerNotice::PresenceAccepted {
            challenge_id,
            device_sequence,
        },
        last_server_sequence,
        now,
    )
    .map_err(str::to_owned)?;
    // Unsigned compatibility metadata may only shorten an authenticated lease,
    // never extend it. The server can shorten this after a fresh consent check.
    let expires = doc["expiresAtMs"]
        .as_u64()
        .filter(|expires| *expires > now)
        .ok_or("REMOTE_MCP_RELAY_HEARTBEAT_EXPIRED")?;
    verified.expires_at_ms = verified.expires_at_ms.min(expires);
    Ok(verified)
}

async fn session(
    generation: u64,
    owner_generation: u64,
    projects: &[git_status::ApprovedProject],
) -> Result<(), String> {
    current(generation, owner_generation)?;
    let owner_string = tokio::time::timeout(
        AUTH_TIMEOUT,
        crate::github_app_auth::verified_katosync_user_classified(),
    )
    .await
    .map_err(|_| "REMOTE_MCP_RELAY_TIMEOUT".to_string())?
    .map_err(|error| {
        if error.is_unavailable() {
            "REMOTE_MCP_RELAY_UNAVAILABLE".to_string()
        } else {
            "REMOTE_MCP_RELAY_LOGIN_REQUIRED".to_string()
        }
    })?;
    let owner = Uuid::parse_str(&owner_string)
        .map_err(|_| "REMOTE_MCP_RELAY_LOGIN_REQUIRED".to_string())?;
    let key = crate::mesh_identity::existing_identity(&owner_string)
        .map_err(|_| "REMOTE_MCP_RELAY_DEVICE_NOT_ENROLLED".to_string())?;
    let token = Zeroizing::new(
        tokio::time::timeout(AUTH_TIMEOUT, crate::ensure_supabase_access_token())
            .await
            .map_err(|_| "REMOTE_MCP_RELAY_TIMEOUT".to_string())?
            .map_err(|error| {
                if crate::github_app_auth::AuthorityCheckError::from_session(
                    &error,
                    "safe session error",
                )
                .is_unavailable()
                {
                    "REMOTE_MCP_RELAY_UNAVAILABLE".to_string()
                } else {
                    "REMOTE_MCP_RELAY_LOGIN_REQUIRED".to_string()
                }
            })?,
    );
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| "REMOTE_MCP_RELAY_UNAVAILABLE".to_string())?;
    let device = own_device(&client, &token, owner, &key).await?;
    current(generation, owner_generation)?;
    let response = client
        .post(format!("{HOST}/api/device-relay/ticket"))
        .bearer_auth(token.as_str())
        .json(&if projects.is_empty() { serde_json::json!({"deviceId":device}) }
            else { serde_json::json!({"deviceId":device,"projectIds":projects.iter().map(|project| &project.id).collect::<Vec<_>>()}) })
        .send()
        .await
        .map_err(|_| "REMOTE_MCP_RELAY_UNAVAILABLE".to_string())?;
    if !response.status().is_success() {
        return Err(http_error(response.status()));
    }
    let ticket: Ticket = serde_json::from_slice(&bounded_body(response).await?)
        .map_err(|_| "REMOTE_MCP_RELAY_RESPONSE_INVALID".to_string())?;
    valid_ticket(&ticket, owner, device, &key, now_ms()?, projects)?;
    let renew_at = renewal_deadline(&ticket);
    if now_ms()? >= renew_at {
        // A nearly expired actor JWT may legitimately yield a short ticket.
        // Wait for that bounded expiry before re-verification/rotation, instead
        // of minting unused tickets in a tight loop or sending an overlong frame.
        let wait = ticket.expires_at_ms.saturating_sub(now_ms()?).min(FRESH_MS);
        tokio::time::sleep(Duration::from_millis(wait.saturating_add(100))).await;
        current(generation, owner_generation)?;
        return Ok(());
    }
    current(generation, owner_generation)?;
    let (kid, verifying_key) = server_key()?;
    let pin = PinnedServerContext {
        kid: &kid,
        verifying_key,
        owner_id: owner,
        tenant_id: ticket.tenant_id,
        grant_id: ticket.grant_id,
        device_id: device,
        session_id: ticket.session_id,
    };
    let mut request = SOCKET
        .into_client_request()
        .map_err(|_| "REMOTE_MCP_RELAY_ENDPOINT_INVALID".to_string())?;
    request.headers_mut().insert(
        "X-KatoSync-Relay-Ticket",
        HeaderValue::from_str(&ticket.ticket)
            .map_err(|_| "REMOTE_MCP_RELAY_TICKET_INVALID".to_string())?,
    );
    request.headers_mut().insert(
        "X-KatoSync-Relay-Device",
        HeaderValue::from_str(&device.to_string())
            .map_err(|_| "REMOTE_MCP_RELAY_TICKET_INVALID".to_string())?,
    );
    let (mut socket, _) = tokio::time::timeout(
        Duration::from_secs(7),
        connect_async_with_config(
            request,
            Some(crate::mesh_rc70_outbound_wss_qa::bounded_ws_config()),
            false,
        ),
    )
    .await
    .map_err(|_| "REMOTE_MCP_RELAY_TIMEOUT".to_string())?
    .map_err(|_| "REMOTE_MCP_RELAY_DISCONNECTED".to_string())?;
    let packet = read_text(&mut socket).await?;
    let notice = verify_rc70_challenge_packet(
        &packet,
        &pin,
        ticket.challenge_id,
        ticket.revoke_epoch,
        0,
        now_ms()?,
    )
    .map_err(str::to_owned)?;
    let mut last_server_sequence = notice.server_sequence;
    let start_wall = now_ms()?;
    let start_mono = Instant::now();
    let mut sequence = 1_u64;
    let tool_names: Vec<&str> = ticket
        .native_tool_names
        .iter()
        .map(String::as_str)
        .collect();
    let mut seen_requests = HashSet::new();
    let mut next_heartbeat = start_wall;
    let mut lease_expires = 0_u64;
    let mut pending_presence: Option<(u64, u64)> = None;
    let mut pending_result: Option<(Uuid, u64, u64)> = None;
    loop {
        current(generation, owner_generation)?;
        let now = now_ms()?;
        let elapsed = start_mono.elapsed().as_millis() as u64;
        if renewal_due(now, start_wall, elapsed, renew_at)? {
            let _ = tokio::time::timeout(Duration::from_secs(1), socket.close(None)).await;
            return Ok(());
        }
        if pending_presence.is_some_and(|(_, sent)| now.saturating_sub(sent) >= 10_000)
            || pending_result.is_some_and(|(_, _, sent)| now.saturating_sub(sent) >= 10_000)
        {
            return Err("REMOTE_MCP_RELAY_TIMEOUT".into());
        }
        if now >= next_heartbeat && pending_presence.is_none() {
            let sent_sequence = sequence;
            let frame = sign_presence_jws(
                &PresenceContext {
                    owner_id: owner,
                    tenant_id: ticket.tenant_id,
                    grant_id: ticket.grant_id,
                    device_id: device,
                    session_id: ticket.session_id,
                    request_id: Uuid::new_v4(),
                    challenge_id: ticket.challenge_id,
                    key_id: &ticket.device_key_id,
                    sequence: sent_sequence,
                    issued_at_ms: now as i64,
                    challenge_expires_at_ms: ticket.expires_at_ms as i64,
                    revoke_epoch: ticket.revoke_epoch,
                    native_tool_names: &tool_names,
                },
                &key,
            )
            .map_err(str::to_owned)?;
            tokio::time::timeout(Duration::from_secs(5), socket.send(Message::Text(frame)))
                .await
                .map_err(|_| "REMOTE_MCP_RELAY_TIMEOUT".to_string())?
                .map_err(|_| "REMOTE_MCP_RELAY_DISCONNECTED".to_string())?;
            pending_presence = Some((sent_sequence, now));
            sequence = sequence
                .checked_add(1)
                .ok_or("REMOTE_MCP_RELAY_SEQUENCE_INVALID")?;
            next_heartbeat = now.saturating_add(5_000);
        }
        // Keep consuming signed requests between heartbeats, instead of sleeping
        // through a server dispatch. No concurrent Git process is admitted.
        let wake_ms = if pending_presence.is_some() {
            1_000
        } else {
            next_heartbeat.saturating_sub(now).max(1).min(1_000)
        };
        let packet = match tokio::time::timeout(
            Duration::from_millis(wake_ms),
            read_text(&mut socket),
        )
        .await
        {
            Ok(packet) => packet?,
            Err(_) => continue,
        };
        let received = now_ms()?;
        current(generation, owner_generation)?;
        // A packet can arrive after the pre-read boundary check. Rotate the
        // expired session before interpreting it as an authority violation.
        if renewal_due(
            received,
            start_wall,
            start_mono.elapsed().as_millis() as u64,
            renew_at,
        )? {
            let _ = tokio::time::timeout(Duration::from_secs(1), socket.close(None)).await;
            return Ok(());
        }
        if let Ok(doc) = serde_json::from_str::<serde_json::Value>(&packet) {
            match doc["type"].as_str() {
                Some("rc69.presence.accepted") => {
                    let (device_sequence, sent) = pending_presence
                        .take()
                        .ok_or("REMOTE_MCP_RELAY_PACKET_INVALID")?;
                    let accepted = verify_presence_ack(
                        &packet,
                        &pin,
                        ticket.challenge_id,
                        device_sequence,
                        last_server_sequence,
                        received,
                        &ticket.native_tool_names,
                    )?;
                    last_server_sequence = accepted.server_sequence;
                    lease_expires = accepted
                        .expires_at_ms
                        .min(ticket.expires_at_ms)
                        .min(sent.saturating_add(FRESH_MS));
                    publish_ack(
                        generation,
                        owner_generation,
                        received,
                        lease_expires,
                        &ticket.admitted_project_ids,
                    )?;
                }
                Some("rc69.result.accepted") => {
                    let (request_id, device_sequence, _) = pending_result
                        .take()
                        .ok_or("REMOTE_MCP_RELAY_PACKET_INVALID")?;
                    if doc["requestId"].as_str() != Some(request_id.to_string().as_str())
                        || doc["acceptedSequence"].as_u64() != Some(device_sequence)
                        || doc["serverKid"].as_str() != Some(pin.kid)
                    {
                        return Err("REMOTE_MCP_RELAY_PACKET_INVALID".into());
                    }
                    let verified = verify_signed_server_notice(
                        doc["serverProofJws"]
                            .as_str()
                            .ok_or("REMOTE_MCP_RELAY_PACKET_INVALID")?,
                        &pin,
                        ExpectedServerNotice::ResultAccepted {
                            request_id,
                            device_sequence,
                        },
                        last_server_sequence,
                        received,
                    )
                    .map_err(str::to_owned)?;
                    last_server_sequence = verified.server_sequence;
                }
                _ => return Err("REMOTE_MCP_RELAY_PACKET_INVALID".into()),
            }
            continue;
        }
        if pending_result.is_some() || projects.is_empty() {
            return Err("REMOTE_MCP_GIT_REQUEST_REJECTED".into());
        }
        if lease_expires <= received {
            return Err("REMOTE_MCP_RELAY_HEARTBEAT_EXPIRED".into());
        }
        let authority = git_status::DispatchAuthority {
            client_id: ticket
                .oauth_client_id
                .ok_or("REMOTE_MCP_RELAY_TICKET_SCOPE_INVALID")?,
            revision: ticket
                .authority_revision
                .as_deref()
                .ok_or("REMOTE_MCP_RELAY_TICKET_SCOPE_INVALID")?,
        };
        let request = git_status::verify_request(
            &packet,
            &pin,
            &authority,
            last_server_sequence,
            received,
            ticket.expires_at_ms,
            projects,
            &seen_requests,
        )
        .map_err(str::to_owned)?;
        // Consume before execution, including failures; a request is never retried.
        last_server_sequence = request.sequence;
        seen_requests.insert(request.request_id);
        let project = projects
            .iter()
            .find(|project| project.id == request.project_id)
            .ok_or("REMOTE_MCP_GIT_PROJECT_NOT_SELECTED")?;
        let registry = crate::project_registry::project_registry_load()
            .map_err(|_| "REMOTE_MCP_GIT_REGISTRY_INVALID".to_string())?
            .ok_or("REMOTE_MCP_GIT_REGISTRY_INVALID")?;
        git_status::verify_registered_root(&registry, project).map_err(str::to_owned)?;
        let execution_expires = request
            .execution_deadline_ms
            .min(ticket.expires_at_ms)
            .min(lease_expires)
            .min(renew_at);
        current(generation, owner_generation)?;
        let result = git_status::read_status(
            project,
            remaining_execution_ms(execution_expires, now_ms()?)?,
        )
        .await
        .map_err(str::to_owned)?;
        current(generation, owner_generation)?;
        let completed = now_ms()?;
        if completed >= execution_expires
            || start_wall
                .saturating_add(start_mono.elapsed().as_millis() as u64)
                .abs_diff(completed)
                > 5_000
        {
            return Err("REMOTE_MCP_GIT_DEADLINE".into());
        }
        let registry = crate::project_registry::project_registry_load()
            .map_err(|_| "REMOTE_MCP_GIT_REGISTRY_INVALID".to_string())?
            .ok_or("REMOTE_MCP_GIT_REGISTRY_INVALID")?;
        git_status::verify_registered_root(&registry, project).map_err(str::to_owned)?;
        let result_sequence = sequence;
        let receipt = crate::mesh_rc69_result_qa::sign_git_status_result_jws(
            &PresenceContext {
                owner_id: owner,
                tenant_id: ticket.tenant_id,
                grant_id: ticket.grant_id,
                device_id: device,
                session_id: ticket.session_id,
                request_id: request.request_id,
                challenge_id: ticket.challenge_id,
                key_id: &ticket.device_key_id,
                sequence: result_sequence,
                issued_at_ms: completed as i64,
                challenge_expires_at_ms: ticket.expires_at_ms as i64,
                revoke_epoch: ticket.revoke_epoch,
                native_tool_names: &tool_names,
            },
            &result,
            &key,
        )
        .map_err(str::to_owned)?;
        current(generation, owner_generation)?;
        let sending = now_ms()?;
        if renewal_due(
            sending,
            start_wall,
            start_mono.elapsed().as_millis() as u64,
            renew_at,
        )? {
            return Err("REMOTE_MCP_GIT_DEADLINE".into());
        }
        // Do not pass a zero timeout to a ready send future: it can still be
        // polled successfully after the deadline has already elapsed.
        let send_ms = remaining_execution_ms(execution_expires, sending)?.min(5_000);
        tokio::time::timeout(
            Duration::from_millis(send_ms),
            socket.send(Message::Text(receipt)),
        )
        .await
        .map_err(|_| "REMOTE_MCP_GIT_DEADLINE".to_string())?
        .map_err(|_| "REMOTE_MCP_RELAY_DISCONNECTED".to_string())?;
        pending_result = Some((request.request_id, result_sequence, completed));
        sequence = sequence
            .checked_add(1)
            .ok_or("REMOTE_MCP_RELAY_SEQUENCE_INVALID")?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn connector_fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../tests/fixtures/beta4_relay_wire.json")).unwrap()
    }

    #[test]
    fn late_packet_rotates_before_dispatch_using_wall_and_monotonic_time() {
        assert!(!renewal_due(129_999, 100_000, 29_999, 130_000).unwrap());
        assert!(renewal_due(130_000, 100_000, 30_000, 130_000).unwrap());
        assert!(renewal_due(129_999, 100_000, 30_001, 130_000).unwrap());
        assert!(renewal_due(99_999, 100_000, 1, 130_000).is_err());
        assert!(renewal_due(135_001, 100_000, 30_000, 140_000).is_err());
    }

    #[test]
    fn expired_send_never_gets_a_zero_budget_or_a_permanent_consent_error() {
        assert_eq!(remaining_execution_ms(100, 99).unwrap(), 1);
        assert!(remaining_execution_ms(100, 100).is_err());
        assert!(remaining_execution_ms(100, 101).is_err());
        assert!(transient("REMOTE_MCP_GIT_DEADLINE"));
        assert!(!transient("REMOTE_MCP_GIT_REQUEST_REJECTED"));
    }

    #[test]
    fn production_connector_git_fixture_matches_native_scope_and_signed_result() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../tests/fixtures/beta4_native_read_wire.json"
        ))
        .unwrap();
        let now = fixture["nowMs"].as_u64().unwrap();
        let ticket: Ticket = serde_json::from_value(fixture["ticket"].clone()).unwrap();
        let device_key =
            SigningKey::from_bytes(&[fixture["deviceSeedByte"].as_u64().unwrap() as u8; 32]);
        let registry = serde_json::json!({"schemaVersion":1,"projects":[{"id":"katosync","rootPath":std::env::temp_dir(),"focus":{"status":"active"}}]});
        let projects = git_status::approve_projects(&registry, &["katosync".into()]).unwrap();
        valid_ticket(
            &ticket,
            ticket.owner_id,
            ticket.device_id,
            &device_key,
            now,
            &projects,
        )
        .unwrap();
        assert!(valid_ticket(
            &ticket,
            ticket.owner_id,
            ticket.device_id,
            &device_key,
            now,
            &[]
        )
        .is_err());
        let bytes: [u8; 32] = URL_SAFE_NO_PAD
            .decode(fixture["serverPin"]["x"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let pin = PinnedServerContext {
            kid: fixture["serverPin"]["kid"].as_str().unwrap(),
            verifying_key: VerifyingKey::from_bytes(&bytes).unwrap(),
            owner_id: ticket.owner_id,
            tenant_id: ticket.tenant_id,
            grant_id: ticket.grant_id,
            device_id: ticket.device_id,
            session_id: ticket.session_id,
        };
        let challenge = verify_rc70_challenge_packet(
            &fixture["challenge"].to_string(),
            &pin,
            ticket.challenge_id,
            ticket.revoke_epoch,
            0,
            now + 200,
        )
        .unwrap();
        let ack = verify_presence_ack(
            &fixture["ack"].to_string(),
            &pin,
            ticket.challenge_id,
            1,
            challenge.server_sequence,
            now + 1100,
            &ticket.native_tool_names,
        )
        .unwrap();
        let authority = git_status::DispatchAuthority {
            client_id: ticket.oauth_client_id.unwrap(),
            revision: ticket.authority_revision.as_deref().unwrap(),
        };
        let request = git_status::verify_request(
            fixture["gitRequestJws"].as_str().unwrap(),
            &pin,
            &authority,
            ack.server_sequence,
            now + 1600,
            ticket.expires_at_ms,
            &projects,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(request.project_id, "katosync");
        assert!(git_status::verify_request(
            fixture["gitRequestJws"].as_str().unwrap(),
            &pin,
            &git_status::DispatchAuthority {
                client_id: Uuid::new_v4(),
                revision: authority.revision
            },
            ack.server_sequence,
            now + 1600,
            ticket.expires_at_ms,
            &projects,
            &HashSet::new()
        )
        .is_err());
        assert!(git_status::verify_request(
            fixture["gitRequestJws"].as_str().unwrap(),
            &pin,
            &git_status::DispatchAuthority {
                client_id: authority.client_id,
                revision: &"f".repeat(64)
            },
            ack.server_sequence,
            now + 1600,
            ticket.expires_at_ms,
            &projects,
            &HashSet::new()
        )
        .is_err());
        let result = crate::mesh_rc69_readonly_qa::NativeGitStatus {
            project_id: "katosync".into(),
            head_sha: "a".repeat(40),
            branch: "beta/native-read".into(),
            dirty: false,
            provenance: "local_git_verified_root",
        };
        let receipt = crate::mesh_rc69_result_qa::sign_git_status_result_jws(
            &PresenceContext {
                owner_id: ticket.owner_id,
                tenant_id: ticket.tenant_id,
                grant_id: ticket.grant_id,
                device_id: ticket.device_id,
                session_id: ticket.session_id,
                request_id: request.request_id,
                challenge_id: ticket.challenge_id,
                key_id: &ticket.device_key_id,
                sequence: 2,
                issued_at_ms: (now + 1800) as i64,
                challenge_expires_at_ms: ticket.expires_at_ms as i64,
                revoke_epoch: ticket.revoke_epoch,
                native_tool_names: &[git_status::TOOL],
            },
            &result,
            &device_key,
        )
        .unwrap();
        assert_eq!(receipt, fixture["gitResultJws"].as_str().unwrap());
        let accepted = verify_signed_server_notice(
            fixture["resultAck"]["serverProofJws"].as_str().unwrap(),
            &pin,
            ExpectedServerNotice::ResultAccepted {
                request_id: request.request_id,
                device_sequence: 2,
            },
            request.sequence,
            now + 2100,
        )
        .unwrap();
        assert_eq!(accepted.server_sequence, 4);
    }

    #[test]
    fn actual_connector_codecs_match_native_ticket_challenge_heartbeat_and_ack() {
        let fixture = connector_fixture();
        let now = fixture["nowMs"].as_u64().unwrap();
        let ticket: Ticket = serde_json::from_value(fixture["ticket"].clone()).unwrap();
        let key = SigningKey::from_bytes(&[fixture["deviceSeedByte"].as_u64().unwrap() as u8; 32]);
        valid_ticket(&ticket, ticket.owner_id, ticket.device_id, &key, now, &[]).unwrap();
        assert_eq!(renewal_deadline(&ticket), now + 30_000);
        let bytes: [u8; 32] = URL_SAFE_NO_PAD
            .decode(fixture["serverPin"]["x"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let pin = PinnedServerContext {
            kid: fixture["serverPin"]["kid"].as_str().unwrap(),
            verifying_key: VerifyingKey::from_bytes(&bytes).unwrap(),
            owner_id: ticket.owner_id,
            tenant_id: ticket.tenant_id,
            grant_id: ticket.grant_id,
            device_id: ticket.device_id,
            session_id: ticket.session_id,
        };
        let challenge = verify_rc70_challenge_packet(
            &fixture["challenge"].to_string(),
            &pin,
            ticket.challenge_id,
            ticket.revoke_epoch,
            0,
            now + 200,
        )
        .unwrap();
        assert_eq!(challenge.server_sequence, 1);
        let presence = sign_presence_jws(
            &PresenceContext {
                owner_id: ticket.owner_id,
                tenant_id: ticket.tenant_id,
                grant_id: ticket.grant_id,
                device_id: ticket.device_id,
                session_id: ticket.session_id,
                request_id: Uuid::parse_str(fixture["deviceRequestId"].as_str().unwrap()).unwrap(),
                challenge_id: ticket.challenge_id,
                key_id: &ticket.device_key_id,
                sequence: 1,
                issued_at_ms: (now + 500) as i64,
                challenge_expires_at_ms: ticket.expires_at_ms as i64,
                revoke_epoch: ticket.revoke_epoch,
                native_tool_names: &[],
            },
            &key,
        )
        .unwrap();
        assert_eq!(presence, fixture["devicePresenceJws"].as_str().unwrap());
        let accepted = verify_presence_ack(
            &fixture["ack"].to_string(),
            &pin,
            ticket.challenge_id,
            1,
            challenge.server_sequence,
            now + 1100,
            &[],
        )
        .unwrap();
        assert_eq!(accepted.server_sequence, 2);
        assert_eq!(accepted.expires_at_ms, now + 15_500);
        assert!(verify_presence_ack(
            &fixture["ack"].to_string(),
            &pin,
            ticket.challenge_id,
            1,
            2,
            now + 1100,
            &[],
        )
        .is_err());

        let mut shortened = fixture["ack"].clone();
        shortened["expiresAtMs"] = serde_json::json!(now + 2500);
        assert_eq!(
            verify_presence_ack(
                &shortened.to_string(),
                &pin,
                ticket.challenge_id,
                1,
                1,
                now + 1100,
                &[],
            )
            .unwrap()
            .expires_at_ms,
            now + 2500
        );
        shortened["expiresAtMs"] = serde_json::json!(now + 120_000);
        assert_eq!(
            verify_presence_ack(
                &shortened.to_string(),
                &pin,
                ticket.challenge_id,
                1,
                1,
                now + 1100,
                &[],
            )
            .unwrap()
            .expires_at_ms,
            now + 16_000
        );
    }

    #[test]
    fn ticket_rejects_noncanonical_header_material_and_renews_before_full_heartbeat_expires() {
        let fixture = connector_fixture();
        let now = fixture["nowMs"].as_u64().unwrap();
        let key = SigningKey::from_bytes(&[19; 32]);
        let mut ticket: Ticket = serde_json::from_value(fixture["ticket"].clone()).unwrap();
        ticket.ticket = "B".repeat(64);
        assert!(valid_ticket(&ticket, ticket.owner_id, ticket.device_id, &key, now, &[]).is_err());
        ticket.ticket = "b".repeat(64);
        ticket.expires_at_ms = now + 14_000;
        ticket.ticket_expires_at_ms = ticket.expires_at_ms;
        ticket.readmit_at_ms = now + 9_000;
        valid_ticket(&ticket, ticket.owner_id, ticket.device_id, &key, now, &[]).unwrap();
        assert!(renewal_deadline(&ticket) <= now);
    }

    #[test]
    fn relay_pin_is_independent_and_valid() {
        let (kid, key) = server_key().unwrap();
        assert_eq!(kid, "katosync_beta4_relay_20261118b");
        assert_eq!(
            URL_SAFE_NO_PAD.encode(key.as_bytes()),
            "8AI4jpN5AdpR-mPLw51orqj2ZEymp4vIBGdU9mOLzps"
        );
    }
    #[test]
    fn relay_retries_network_but_not_consent_identity_or_signatures() {
        assert!(transient("REMOTE_MCP_RELAY_TIMEOUT"));
        for code in [
            "REMOTE_MCP_RELAY_CONSENT_REQUIRED",
            "REMOTE_MCP_OWNER_CHANGED",
            "REMOTE_MCP_RELAY_TICKET_INVALID",
            "RC72_SIGNED_SERVER_PROOF_NOT_VERIFIED",
        ] {
            assert!(!transient(code));
        }
    }
}
