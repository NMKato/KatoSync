// Created by NMKato Solutions
//! User-started private beta connection service. A real, still-open pinned
//! mTLS channel and a fresh heartbeat are required for every connected snapshot.
//! Account discovery, saved hub preferences and old pairing receipts never
//! create a live connection or remote-job permission.

use super::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::sync::watch;
use tokio::task::JoinHandle;
use tokio_rustls::TlsStream;

const PORT: u16 = 49284;
const TAILSCALE: &str = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const STATUS_LIMIT: usize = 131_072;
const MAX_DISCOVERY_PEERS: usize = 16;
const PUBLIC_LEASE: Duration = Duration::from_secs(20);
const SESSION_RENEWAL: Duration = Duration::from_secs(240);
const AUTH_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionRole {
    Server,
    Client,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    state: &'static str,
    role: Option<ConnectionRole>,
    peer_fingerprint: Option<String>,
    last_heartbeat_at: Option<u64>,
    expires_at: Option<u64>,
    error_code: Option<String>,
    remote_jobs_enabled: bool,
}

impl Default for ConnectionStatus {
    fn default() -> Self {
        Self {
            state: "idle",
            role: None,
            peer_fingerprint: None,
            last_heartbeat_at: None,
            expires_at: None,
            error_code: None,
            remote_jobs_enabled: false,
        }
    }
}

#[derive(Default)]
struct RuntimeState {
    generation: u64,
    status: ConnectionStatus,
    monotonic_deadline: Option<Instant>,
    cancellation: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<()>>,
}

static RUNTIME: OnceLock<Mutex<RuntimeState>> = OnceLock::new();
fn runtime() -> &'static Mutex<RuntimeState> {
    RUNTIME.get_or_init(|| Mutex::new(RuntimeState::default()))
}
fn now_ms() -> Result<u64, String> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "MESH_CONNECTION_CLOCK_UNAVAILABLE")?
        .as_millis();
    u64::try_from(millis).map_err(|_| "MESH_CONNECTION_CLOCK_UNAVAILABLE".into())
}
fn public_pin(value: &str) -> bool {
    value.len() == 47
        && value.bytes().enumerate().all(|(i, b)| {
            if i % 3 == 2 {
                b == b'-'
            } else {
                b.is_ascii_hexdigit() && !b.is_ascii_lowercase()
            }
        })
}

fn publish(generation: u64, state: &'static str, error: Option<&str>) {
    if let Ok(mut current) = runtime().lock() {
        if current.generation != generation {
            return;
        }
        current.status.state = state;
        current.status.error_code = error.map(str::to_string);
        current.status.last_heartbeat_at = None;
        current.status.expires_at = None;
        current.monotonic_deadline = None;
    }
}

fn publish_heartbeat(generation: u64, lease: &LiveTlsLease) -> Result<(), String> {
    let now = Instant::now();
    if !lease.is_live(now) {
        return Err("MESH_CONNECTION_LEASE_EXPIRED".into());
    }
    let wall = now_ms()?;
    let mut current = runtime()
        .lock()
        .map_err(|_| "MESH_CONNECTION_STATE_UNAVAILABLE")?;
    if current.generation != generation {
        return Err("MESH_CONNECTION_CANCELLED".into());
    }
    current.status.state = "connected";
    current.status.last_heartbeat_at = Some(wall);
    current.status.expires_at = Some(wall + PUBLIC_LEASE.as_millis() as u64);
    current.status.error_code = None;
    current.monotonic_deadline = Some(now + PUBLIC_LEASE);
    Ok(())
}

fn snapshot_fresh(
    status: &ConnectionStatus,
    deadline: Option<Instant>,
    now: Instant,
    wall: u64,
) -> bool {
    status.state == "connected"
        && deadline.is_some_and(|value| now < value)
        && status.last_heartbeat_at.is_some_and(|value| value <= wall)
        && status.expires_at.is_some_and(|value| wall < value)
}

pub fn mesh_connection_status() -> Result<ConnectionStatus, String> {
    let wall = now_ms()?;
    let mut current = runtime()
        .lock()
        .map_err(|_| "MESH_CONNECTION_STATE_UNAVAILABLE")?;
    if current.status.state == "connected"
        && (!snapshot_fresh(
            &current.status,
            current.monotonic_deadline,
            Instant::now(),
            wall,
        ) || current.task.as_ref().is_none_or(JoinHandle::is_finished))
    {
        current.status.state = "reconnecting";
        current.status.error_code = Some("MESH_CONNECTION_HEARTBEAT_EXPIRED".into());
        current.status.last_heartbeat_at = None;
        current.status.expires_at = None;
        current.monotonic_deadline = None;
    }
    Ok(current.status.clone())
}

async fn cancel_previous() -> Result<u64, String> {
    let (generation, task) = {
        let mut current = runtime()
            .lock()
            .map_err(|_| "MESH_CONNECTION_STATE_UNAVAILABLE")?;
        current.generation = current
            .generation
            .checked_add(1)
            .ok_or("MESH_CONNECTION_STATE_UNAVAILABLE")?;
        if let Some(cancel) = current.cancellation.take() {
            let _ = cancel.send(true);
        }
        current.status = ConnectionStatus::default();
        current.monotonic_deadline = None;
        (current.generation, current.task.take())
    };
    // Dropping the cancelled future also drops its TLS stream/listener. Wait
    // for that drop before returning or rebinding the same local interface.
    if let Some(task) = task {
        task.abort();
        let _ = task.await;
    }
    Ok(generation)
}

/// Native auth lifecycle hook: invalidate visible state and all in-flight
/// publications before credentials are cleared or the account is replaced.
pub(crate) fn invalidate_owner_session() {
    let mut current = match runtime().lock() {
        Ok(current) => current,
        Err(poisoned) => poisoned.into_inner(),
    };
    current.generation = current.generation.wrapping_add(1);
    current.status = ConnectionStatus::default();
    current.monotonic_deadline = None;
    if let Some(cancel) = current.cancellation.take() {
        let _ = cancel.send(true);
    }
    if let Some(task) = current.task.take() {
        task.abort();
    }
}

pub async fn mesh_connection_stop() -> Result<ConnectionStatus, String> {
    cancel_previous().await?;
    mesh_connection_status()
}

pub async fn mesh_connection_start(
    peer_fingerprint: String,
    role: ConnectionRole,
) -> Result<ConnectionStatus, String> {
    if !cfg!(all(target_os = "macos", feature = "stage4j-qa")) {
        return Err("MESH_CONNECTION_NOT_CONFIGURED".into());
    }
    if !public_pin(&peer_fingerprint) {
        return Err("MESH_CONNECTION_INVALID_PEER".into());
    }
    let generation = cancel_previous().await?;
    let (cancel, mut stopped) = watch::channel(false);
    let mut current = runtime()
        .lock()
        .map_err(|_| "MESH_CONNECTION_STATE_UNAVAILABLE")?;
    if current.generation != generation {
        return Err("MESH_CONNECTION_CANCELLED".into());
    }
    current.status = ConnectionStatus {
        state: "discovering",
        role: Some(role),
        peer_fingerprint: Some(peer_fingerprint.clone()),
        ..ConnectionStatus::default()
    };
    current.cancellation = Some(cancel);
    current.task = Some(tokio::spawn(async move {
        tokio::select! {
            _ = stopped.changed() => {},
            _ = run(generation, role, peer_fingerprint) => {},
        }
    }));
    Ok(current.status.clone())
}

struct TailnetDiscovery {
    local: Ipv4Addr,
    peers: Vec<Ipv4Addr>,
}
fn overlay(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}
fn record_ips(record: &Value) -> Vec<Ipv4Addr> {
    record
        .get("TailscaleIPs")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str()?.parse().ok())
                .filter(|v| overlay(*v))
                .collect()
        })
        .unwrap_or_default()
}
fn parse_discovery(value: &Value) -> Result<TailnetDiscovery, String> {
    let denied = || "MESH_CONNECTION_NETWORK_UNAVAILABLE".to_string();
    if value.get("BackendState").and_then(Value::as_str) != Some("Running") {
        return Err(denied());
    }
    let own = value.get("Self").ok_or_else(denied)?;
    let owner = own
        .get("UserID")
        .and_then(Value::as_u64)
        .filter(|n| *n > 0)
        .ok_or_else(denied)?;
    if own.get("Online").and_then(Value::as_bool) != Some(true)
        || own.get("Expired").and_then(Value::as_bool) == Some(true)
    {
        return Err(denied());
    }
    let own_ips = record_ips(own);
    if own_ips.len() != 1 {
        return Err(denied());
    }
    let mut peers: Vec<Ipv4Addr> = value
        .get("Peer")
        .and_then(Value::as_object)
        .ok_or_else(denied)?
        .values()
        .filter(|peer| {
            peer.get("UserID").and_then(Value::as_u64) == Some(owner)
                && peer.get("Online").and_then(Value::as_bool) == Some(true)
                && peer.get("Expired").and_then(Value::as_bool) != Some(true)
        })
        .flat_map(record_ips)
        .filter(|ip| *ip != own_ips[0])
        .collect();
    peers.sort_unstable();
    peers.dedup();
    if peers.len() > MAX_DISCOVERY_PEERS {
        return Err("MESH_CONNECTION_DISCOVERY_LIMIT".into());
    }
    Ok(TailnetDiscovery {
        local: own_ips[0],
        peers,
    })
}
async fn discover() -> Result<TailnetDiscovery, String> {
    let output = timeout(
        Duration::from_secs(5),
        Command::new(TAILSCALE)
            .args(["status", "--json"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_NETWORK_UNAVAILABLE")?
    .map_err(|_| "MESH_CONNECTION_NETWORK_UNAVAILABLE")?;
    if !output.status.success() || output.stdout.len() > STATUS_LIMIT {
        return Err("MESH_CONNECTION_NETWORK_UNAVAILABLE".into());
    }
    let document = serde_json::from_slice(&output.stdout)
        .map_err(|_| "MESH_CONNECTION_NETWORK_UNAVAILABLE")?;
    parse_discovery(&document)
}

async fn authorize_peer(pin: &str) -> Result<NativeAdmission, String> {
    timeout(AUTH_TIMEOUT, mesh_admission::authorize(pin))
        .await
        .map_err(|_| "MESH_CONNECTION_AUTHORITY_TIMEOUT")?
}
async fn recheck(admitted: &NativeAdmission, pin: &str) -> Result<(), String> {
    timeout(
        AUTH_TIMEOUT,
        mesh_admission::recheck_after_probe(admitted, pin),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_AUTHORITY_TIMEOUT")?
}

async fn open_client(
    local: Ipv4Addr,
    peer: Ipv4Addr,
    admitted: &NativeAdmission,
) -> Result<TlsStream<TcpStream>, String> {
    verify_live_tailnet(local, peer).await?;
    let identity = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_CONNECTION_LOCAL_IDENTITY_UNAVAILABLE")?;
    let socket = TcpSocket::new_v4().map_err(|_| "MESH_CONNECTION_NETWORK_UNAVAILABLE")?;
    socket
        .bind(SocketAddr::V4(SocketAddrV4::new(local, 0)))
        .map_err(|_| "MESH_CONNECTION_NETWORK_UNAVAILABLE")?;
    let mut socket = timeout(
        Duration::from_secs(3),
        socket.connect(SocketAddr::V4(SocketAddrV4::new(peer, PORT))),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_NO_PEER")?
    .map_err(|_| "MESH_CONNECTION_NO_PEER")?;
    if socket.local_addr().map(|v| v.ip()).ok() != Some(IpAddr::V4(local))
        || socket.peer_addr().map(|v| v.ip()).ok() != Some(IpAddr::V4(peer))
    {
        return Err("MESH_CONNECTION_ADDRESS_DENIED".into());
    }
    let server_cert = timeout(Duration::from_secs(5), async {
        write_cert(&mut socket, identity.certificate_der()).await?;
        read_cert(&mut socket).await
    })
    .await
    .map_err(|_| "MESH_CONNECTION_NO_PEER")??;
    // Discovery only supplies candidate routes. Exact KatoOS-approved public
    // key pin and real private-key possession are mandatory before admission.
    let config = strict_client_config(&identity, &admitted.approved_peer, &server_cert)
        .map_err(|_| "MESH_CONNECTION_PEER_PIN_MISMATCH")?;
    let name = rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME)
        .map_err(|_| "MESH_CONNECTION_TLS_DENIED")?;
    let tls = timeout(
        TLS_TIMEOUT,
        TlsConnector::from(Arc::new(config)).connect(name, socket),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_NO_PEER")?
    .map_err(|_| "MESH_CONNECTION_TLS_DENIED")?;
    if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err("MESH_CONNECTION_TLS_DENIED".into());
    }
    Ok(TlsStream::Client(tls))
}

async fn open_server(
    route: &TailnetDiscovery,
    admitted: &NativeAdmission,
) -> Result<(TlsStream<TcpStream>, Ipv4Addr), String> {
    // Bind only the locally verified overlay address, never 0.0.0.0 or an
    // address supplied by the frontend. Every accepted source is rechecked.
    let listener = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(route.local, PORT)))
        .await
        .map_err(|_| "MESH_CONNECTION_LISTEN_UNAVAILABLE")?;
    let identity = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_CONNECTION_LOCAL_IDENTITY_UNAVAILABLE")?;
    for _ in 0..MAX_DISCOVERY_PEERS {
        let (mut socket, source) = timeout(Duration::from_secs(30), listener.accept())
            .await
            .map_err(|_| "MESH_CONNECTION_NO_PEER")?
            .map_err(|_| "MESH_CONNECTION_NETWORK_UNAVAILABLE")?;
        let IpAddr::V4(peer) = source.ip() else {
            continue;
        };
        if !route.peers.contains(&peer) {
            continue;
        }
        verify_live_tailnet(route.local, peer).await?;
        let client_cert = match timeout(Duration::from_secs(5), read_cert(&mut socket)).await {
            Ok(Ok(cert)) => cert,
            _ => continue,
        };
        let Ok(config) = strict_server_config(&identity, &admitted.approved_peer, &client_cert)
        else {
            continue;
        };
        if !matches!(
            timeout(
                Duration::from_secs(5),
                write_cert(&mut socket, identity.certificate_der())
            )
            .await,
            Ok(Ok(()))
        ) {
            continue;
        }
        let tls = match timeout(
            TLS_TIMEOUT,
            TlsAcceptor::from(Arc::new(config)).accept(socket),
        )
        .await
        {
            Ok(Ok(tls)) => tls,
            _ => continue,
        };
        if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
            continue;
        }
        return Ok((TlsStream::Server(tls), peer));
    }
    Err("MESH_CONNECTION_NO_PEER".into())
}

async fn connected_session(
    generation: u64,
    role: ConnectionRole,
    pin: &str,
    local: Ipv4Addr,
    peer: Ipv4Addr,
    admitted: NativeAdmission,
    mut tls: TlsStream<TcpStream>,
) -> Result<(), String> {
    let session = match role {
        ConnectionRole::Server => server_session_init(&mut tls, new_nonce()).await?,
        ConnectionRole::Client => client_session_init(&mut tls, new_nonce()).await?,
    };
    recheck(&admitted, pin).await?;
    let (owner, local_key, peer_key) = binding_material(&admitted)?;
    let started = Instant::now();
    let mut lease =
        LiveTlsLease::after_verified_open_channel(owner, local_key, peer_key, session, started)?;
    let mut clock = ClockGapMonitor::capture();
    let mut sequence = 0_u64;
    while started.elapsed() < SESSION_RENEWAL {
        clock
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        if !lease.is_live(Instant::now()) {
            return Err("MESH_CONNECTION_HEARTBEAT_EXPIRED".into());
        }
        verify_live_tailnet(local, peer).await?;
        recheck(&admitted, pin).await?;
        sequence = sequence
            .checked_add(1)
            .ok_or("MESH_CONNECTION_SEQUENCE_EXHAUSTED")?;
        match role {
            ConnectionRole::Client => heartbeat_client(&mut tls, sequence, &session).await?,
            ConnectionRole::Server => {
                heartbeat_server(&mut tls, sequence, &session, &admitted, pin).await?
            }
        }
        clock
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        recheck(&admitted, pin).await?;
        clock
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        let refreshed_at = Instant::now();
        if !lease.is_live(refreshed_at) {
            return Err("MESH_CONNECTION_HEARTBEAT_EXPIRED".into());
        }
        lease.verified_in_channel_heartbeat(sequence, refreshed_at)?;
        publish_heartbeat(generation, &lease)?;
        if role == ConnectionRole::Client {
            sleep(HEARTBEAT_INTERVAL).await;
        }
    }
    // Absolute session age is never extended. A fresh connection, owner
    // admission, TLS handshake and nonces are required for renewal.
    lease.close();
    publish(generation, "reconnecting", None);
    let _ = timeout(Duration::from_secs(1), tls.shutdown()).await;
    Ok(())
}

async fn cycle(generation: u64, role: ConnectionRole, pin: &str) -> Result<(), String> {
    publish(generation, "discovering", None);
    let admitted = authorize_peer(pin).await?;
    let route = discover().await?;
    if route.peers.is_empty() {
        return Err("MESH_CONNECTION_NO_PEER".into());
    }
    let (tls, peer) = match role {
        ConnectionRole::Server => {
            publish(generation, "listening", None);
            open_server(&route, &admitted).await?
        }
        ConnectionRole::Client => {
            publish(generation, "connecting", None);
            let mut found = None;
            for peer in &route.peers {
                recheck(&admitted, pin).await?;
                match open_client(route.local, *peer, &admitted).await {
                    Ok(tls) => {
                        found = Some((tls, *peer));
                        break;
                    }
                    Err(error)
                        if matches!(
                            error.as_str(),
                            "MESH_CONNECTION_NO_PEER"
                                | "MESH_CONNECTION_PEER_PIN_MISMATCH"
                                | "MESH_CONNECTION_TLS_DENIED"
                        ) => {}
                    Err(error) => return Err(error),
                }
            }
            found.ok_or("MESH_CONNECTION_NO_PEER")?
        }
    };
    connected_session(generation, role, pin, route.local, peer, admitted, tls).await
}

fn retryable(error: &str) -> bool {
    matches!(
        error,
        "MESH_ADMISSION_AUTHORITY_UNAVAILABLE"
            | "MESH_CONNECTION_NETWORK_UNAVAILABLE"
            | "MESH_CONNECTION_NO_PEER"
            | "MESH_CONNECTION_LISTEN_UNAVAILABLE"
            | "MESH_CONNECTION_AUTHORITY_TIMEOUT"
            | "MESH_CONNECTION_HEARTBEAT_EXPIRED"
            | "MESH_STAGE4AA_TAILSCALE_UNAVAILABLE"
            | "MESH_STAGE4AA_TAILSCALE_PEER_UNVERIFIED"
            | "MESH_STAGE4AB2_INIT_IO"
            | "MESH_STAGE4AB2_INIT_TIMEOUT"
            | "MESH_STAGE4AB2_HEARTBEAT_IO"
            | "MESH_STAGE4AB2_HEARTBEAT_TIMEOUT"
            | "MESH_STAGE4AB32B_CLOCK_OR_SLEEP_GAP_DENIED"
    )
}
async fn run(generation: u64, role: ConnectionRole, pin: String) {
    let mut attempt = 0_u32;
    loop {
        match cycle(generation, role, &pin).await {
            Ok(()) => attempt = 0,
            Err(error) if retryable(&error) => {
                publish(generation, "reconnecting", Some(&error));
                let seconds = 2_u64.saturating_pow(attempt.min(3) + 1).min(16);
                attempt = attempt.saturating_add(1);
                sleep(Duration::from_secs(seconds)).await;
            }
            Err(error) => {
                publish(generation, "blocked", Some(&error));
                return;
            }
        }
    }
}

/// Bounded physical acceptance entry. It calls the exact UI runtime and
/// reports only state and heartbeat counts, never credentials or device IDs.
pub async fn run_smoke(args: Vec<String>) -> Result<(), String> {
    if args.len() != 3 {
        return Err("MESH_CONNECTION_SMOKE_ARGUMENTS".into());
    }
    let role = match args[0].as_str() {
        "server" => ConnectionRole::Server,
        "client" => ConnectionRole::Client,
        _ => return Err("MESH_CONNECTION_INVALID_ROLE".into()),
    };
    let seconds = args[2]
        .parse::<u64>()
        .map_err(|_| "MESH_CONNECTION_SMOKE_DURATION")?;
    if !(30..=300).contains(&seconds) {
        return Err("MESH_CONNECTION_SMOKE_DURATION".into());
    }
    let pin = if args[1] == "paired" {
        let inventory = timeout(AUTH_TIMEOUT, crate::mesh_trust::mesh_local_approved_peers())
            .await
            .map_err(|_| "MESH_CONNECTION_AUTHORITY_TIMEOUT")??;
        if inventory.peers.len() != 1 {
            return Err("MESH_CONNECTION_SMOKE_SELECT_EXACT_PEER".into());
        }
        inventory.peers[0].fingerprint.clone()
    } else {
        args[1].clone()
    };
    mesh_connection_start(pin, role).await?;
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut previous_state = "";
    let mut previous_heartbeat = None;
    let mut heartbeats = 0_u64;
    let mut final_error = None;
    while Instant::now() < deadline {
        let snapshot = match mesh_connection_status() {
            Ok(status) => status,
            Err(error) => {
                final_error = Some(error);
                break;
            }
        };
        if snapshot.state != previous_state {
            println!("MESH_BETA_STATE {}", snapshot.state);
            previous_state = snapshot.state;
        }
        if snapshot.state == "connected" && snapshot.last_heartbeat_at != previous_heartbeat {
            heartbeats += 1;
            previous_heartbeat = snapshot.last_heartbeat_at;
            println!("MESH_BETA_VERIFIED_HEARTBEATS {heartbeats}");
        }
        if snapshot.state == "blocked" {
            final_error = snapshot.error_code;
            break;
        }
        sleep(Duration::from_secs(2)).await;
    }
    let ended_connected = mesh_connection_status().is_ok_and(|status| status.state == "connected");
    let stopped = mesh_connection_stop().await?;
    if stopped.state != "idle"
        || stopped.last_heartbeat_at.is_some()
        || stopped.expires_at.is_some()
    {
        return Err("MESH_CONNECTION_STOP_NOT_CONFIRMED".into());
    }
    println!("MESH_BETA_STOP_CONFIRMED");
    if let Some(error) = final_error {
        return Err(error);
    }
    if heartbeats < 3 {
        return Err("MESH_CONNECTION_SMOKE_INSUFFICIENT_HEARTBEATS".into());
    }
    if !ended_connected {
        return Err("MESH_CONNECTION_SMOKE_ENDED_WITHOUT_LIVE_CHANNEL".into());
    }
    println!("MESH_BETA_RUNTIME_PASS_NO_REMOTE_JOBS");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn inventory() -> Value {
        json!({"BackendState":"Running","Self":{"UserID":7,"Online":true,"Expired":false,"TailscaleIPs":["100.100.0.1"]},"Peer":{
            "own":{"UserID":7,"Online":true,"Expired":false,"TailscaleIPs":["100.100.0.2"]},
            "other":{"UserID":8,"Online":true,"TailscaleIPs":["100.100.0.3"]},
            "offline":{"UserID":7,"Online":false,"TailscaleIPs":["100.100.0.4"]},
            "expired":{"UserID":7,"Online":true,"Expired":true,"TailscaleIPs":["100.100.0.5"]},
            "public":{"UserID":7,"Online":true,"TailscaleIPs":["8.8.8.8"]}
        }})
    }

    #[test]
    fn discovery_limits_candidates_to_live_same_user_private_overlay() {
        let parsed = parse_discovery(&inventory()).unwrap();
        assert_eq!(parsed.local, Ipv4Addr::new(100, 100, 0, 1));
        assert_eq!(parsed.peers, [Ipv4Addr::new(100, 100, 0, 2)]);
        let mut stopped = inventory();
        stopped["BackendState"] = json!("Stopped");
        assert!(parse_discovery(&stopped).is_err());
        let mut expired = inventory();
        expired["Self"]["Expired"] = json!(true);
        assert!(parse_discovery(&expired).is_err());
    }

    #[test]
    fn snapshots_expire_on_both_clocks_and_cannot_survive_clock_rollback() {
        let now = Instant::now();
        let status = ConnectionStatus {
            state: "connected",
            last_heartbeat_at: Some(1_000),
            expires_at: Some(21_000),
            ..ConnectionStatus::default()
        };
        let deadline = Some(now + PUBLIC_LEASE);
        assert!(snapshot_fresh(&status, deadline, now, 1_000));
        assert!(!snapshot_fresh(&status, deadline, now, 999));
        assert!(!snapshot_fresh(&status, deadline, now, 21_000));
        assert!(!snapshot_fresh(
            &status,
            deadline,
            now + PUBLIC_LEASE,
            1_001
        ));
        assert!(!snapshot_fresh(
            &ConnectionStatus::default(),
            deadline,
            now,
            1_000
        ));
    }

    #[test]
    fn owner_invalidation_fences_delayed_connected_publications() {
        let generation = runtime().lock().unwrap().generation;
        let now = Instant::now();
        let lease =
            LiveTlsLease::after_verified_open_channel([1; 16], [2; 32], [3; 32], [4; 32], now)
                .unwrap();
        publish_heartbeat(generation, &lease).unwrap();
        invalidate_owner_session();
        assert!(publish_heartbeat(generation, &lease).is_err());
        let current = runtime().lock().unwrap();
        assert_eq!(current.status.state, "idle");
        assert!(current.status.last_heartbeat_at.is_none());
        assert!(current.status.expires_at.is_none());
        assert!(current.status.peer_fingerprint.is_none());
        assert!(!current.status.remote_jobs_enabled);
    }

    #[test]
    fn only_proven_temporary_authority_transport_and_clock_faults_retry_with_fresh_admission() {
        assert!(retryable("MESH_ADMISSION_AUTHORITY_UNAVAILABLE"));
        assert!(retryable("MESH_STAGE4AB2_HEARTBEAT_IO"));
        assert!(retryable("MESH_STAGE4AB32B_CLOCK_OR_SLEEP_GAP_DENIED"));
        for error in [
            "MESH_STAGE4AB2_OWNER_OR_PIN_REVOKED",
            "MESH_ADMISSION_LOGIN_REQUIRED",
            "MESH_ADMISSION_PEER_REVOKED",
            "MESH_ADMISSION_PEER_CHANGED",
            "MESH_ADMISSION_ACCOUNT_CHANGED",
            "MESH_ADMISSION_LOCAL_IDENTITY_CHANGED",
            "MESH_ADMISSION_ENROLLMENT_REVOKED",
            "MESH_STAGE4AB2_HEARTBEAT_DENIED",
            "MESH_ADMISSION_AUTHORITY_UNAVAILABLE: revoked",
            "SESSION_EXPIRED",
            "unknown",
        ] {
            assert!(!retryable(error));
        }
    }
}
