// Created by NMKato Solutions
//! Ein begrenzter Hauptgeräte-Supervisor; jeder Peer besitzt eigene Sequenz, Lease und Abbruchgeneration.
use super::super::{self as legacy, lan};
use super::*;
use crate::mesh_live_supervisor_qa::{
    acknowledge_server_heartbeat_after_recheck, binding_material, client_session_init,
    heartbeat_client, new_nonce, read_cert, server_session_init, strict_client_config,
    strict_server_config, verify_heartbeat_frame, verify_live_tailnet, write_cert, ClockGapMonitor,
    LiveTlsLease, FRAME_TIMEOUT, HB_TAG, HEARTBEAT_INTERVAL, HEARTBEAT_LEN, TLS_PEER_DNS_NAME,
    TLS_TIMEOUT,
};
use crate::{
    mesh_admission::{self, NativeAdmission},
    mesh_tls::DeviceTlsIdentity,
};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4},
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpSocket, TcpStream},
    time::{sleep, timeout},
};
use tokio_rustls::{TlsAcceptor, TlsConnector, TlsStream};

#[derive(Clone)]
enum RouteKind {
    Lan(lan::LanInterface),
    Tailnet,
}
#[derive(Clone)]
struct Route {
    local: Ipv4Addr,
    peer: Ipv4Addr,
    kind: RouteKind,
}

async fn fresh(intent: &ConnectionIntent, peer: Option<&PeerIntent>) -> Result<(), String> {
    let config = crate::mesh_account_control::verified_configuration().await?;
    if !intent.same_binding(&binding(&config)?) {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    if let Some(peer) = peer {
        let device = target(
            &config,
            &peer.peer_device_id,
            &peer.peer_fingerprint,
            intent.account_revision,
        )?;
        if device.public_key != peer.peer_public_key {
            return Err("MESH_ACCOUNT_PEER_CHANGED".into());
        }
    }
    Ok(())
}
async fn route_live(route: &Route) -> Result<(), String> {
    match &route.kind {
        RouteKind::Lan(expected) => {
            if !lan::same_private_link(route.local, route.peer)
                || lan::local_interface().await? != *expected
            {
                return Err("MESH_ACCOUNT_LAN_UNAVAILABLE".into());
            }
            Ok(())
        }
        RouteKind::Tailnet => verify_live_tailnet(route.local, route.peer).await,
    }
}
fn current(owner: u64, peer_generation: u64, peer_id: &str) -> bool {
    state()
        .lock()
        .is_ok_and(|value| peer_current(&value, owner, peer_id, peer_generation))
}
fn owner_current(owner: u64) -> bool {
    state()
        .lock()
        .is_ok_and(|value| value.owner_generation == owner && value.intent.is_some())
}
fn transient(error: &str) -> bool {
    legacy::retryable(error)
        || matches!(
            error,
            "MESH_ACCOUNT_LAN_UNAVAILABLE"
                | "MESH_ACCOUNT_NETWORK_UNAVAILABLE"
                | "MESH_ACCOUNT_UNAVAILABLE"
                | "MESH_ACCOUNT_AUTHORITY_UNAVAILABLE"
        )
}
fn ensure_admission(
    intent: &ConnectionIntent,
    peer: &PeerIntent,
    admitted: &NativeAdmission,
) -> Result<(), String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    if admitted.owner_uid != intent.owner_id
        || admitted.approved_peer.public_key != peer.peer_public_key
        || admitted.approved_peer.fingerprint != peer.peer_fingerprint
        || URL_SAFE_NO_PAD.encode(admitted.local_signing.verifying_key().as_bytes())
            != intent.local_public_key
    {
        return Err("MESH_ACCOUNT_PEER_CHANGED".into());
    }
    Ok(())
}
async fn open_client(
    route: &Route,
    admitted: &NativeAdmission,
) -> Result<TlsStream<TcpStream>, String> {
    route_live(route).await?;
    let identity = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_CONNECTION_LOCAL_IDENTITY_UNAVAILABLE")?;
    let socket = TcpSocket::new_v4().map_err(|_| "MESH_ACCOUNT_NETWORK_UNAVAILABLE")?;
    socket
        .bind(SocketAddr::V4(SocketAddrV4::new(route.local, 0)))
        .map_err(|_| "MESH_ACCOUNT_NETWORK_UNAVAILABLE")?;
    let mut socket = timeout(
        Duration::from_secs(3),
        socket.connect(SocketAddr::V4(SocketAddrV4::new(route.peer, legacy::PORT))),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_NO_PEER")?
    .map_err(|_| "MESH_CONNECTION_NO_PEER")?;
    if socket.local_addr().map(|value| value.ip()).ok() != Some(IpAddr::V4(route.local))
        || socket.peer_addr().map(|value| value.ip()).ok() != Some(IpAddr::V4(route.peer))
    {
        return Err("MESH_CONNECTION_ADDRESS_DENIED".into());
    }
    let certificate = timeout(Duration::from_secs(5), async {
        write_cert(&mut socket, identity.certificate_der()).await?;
        read_cert(&mut socket).await
    })
    .await
    .map_err(|_| "MESH_CONNECTION_NO_PEER")??;
    let config = strict_client_config(&identity, &admitted.approved_peer, &certificate)
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

async fn server_heartbeat(
    tls: &mut TlsStream<TcpStream>,
    sequence: u64,
    session: &[u8; 32],
    intent: &ConnectionIntent,
    peer: &PeerIntent,
    admitted: &NativeAdmission,
) -> Result<(), String> {
    timeout(FRAME_TIMEOUT, async {
        let mut request = [0u8; HEARTBEAT_LEN];
        tls.read_exact(&mut request)
            .await
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_IO".to_string())?;
        verify_heartbeat_frame(&request, HB_TAG, sequence, session)
            .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_DENIED".to_string())?;
        // Auch die Hauptgeräte-Revision muss unmittelbar vor dem ACK noch gelten.
        fresh(intent, Some(peer)).await?;
        let authority = mesh_admission::recheck_after_probe(admitted, &peer.peer_fingerprint).await;
        acknowledge_server_heartbeat_after_recheck(tls, sequence, session, authority)
            .await
            .map_err(str::to_string)
    })
    .await
    .map_err(|_| "MESH_STAGE4AB2_HEARTBEAT_TIMEOUT".to_string())?
}
async fn connected(
    owner: u64,
    generation: u64,
    intent: &ConnectionIntent,
    peer: &PeerIntent,
    route: Route,
    admitted: NativeAdmission,
    mut tls: TlsStream<TcpStream>,
    role: ConnectionRole,
) -> Result<(), String> {
    if !current(owner, generation, &peer.peer_device_id) {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    let session = match role {
        ConnectionRole::Server => server_session_init(&mut tls, new_nonce()).await?,
        ConnectionRole::Client => client_session_init(&mut tls, new_nonce()).await?,
    };
    fresh(intent, Some(peer)).await?;
    mesh_admission::recheck_after_probe(&admitted, &peer.peer_fingerprint).await?;
    let (owner_key, local_key, peer_key) = binding_material(&admitted)?;
    let started = Instant::now();
    let mut lease = LiveTlsLease::after_verified_open_channel(
        owner_key, local_key, peer_key, session, started,
    )?;
    let mut clock = ClockGapMonitor::capture();
    let mut sequence = 0u64;
    while started.elapsed() < legacy::SESSION_RENEWAL {
        if !current(owner, generation, &peer.peer_device_id) {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        clock
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        if !lease.is_live(Instant::now()) {
            return Err("MESH_CONNECTION_HEARTBEAT_EXPIRED".into());
        }
        route_live(&route).await?;
        fresh(intent, Some(peer)).await?;
        mesh_admission::recheck_after_probe(&admitted, &peer.peer_fingerprint).await?;
        sequence = sequence
            .checked_add(1)
            .ok_or("MESH_CONNECTION_SEQUENCE_EXHAUSTED")?;
        match role {
            ConnectionRole::Client => heartbeat_client(&mut tls, sequence, &session).await?,
            ConnectionRole::Server => {
                server_heartbeat(&mut tls, sequence, &session, intent, peer, &admitted).await?
            }
        }
        clock
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        fresh(intent, Some(peer)).await?;
        mesh_admission::recheck_after_probe(&admitted, &peer.peer_fingerprint).await?;
        clock
            .check_or_invalidate(&mut lease)
            .map_err(str::to_string)?;
        let now = Instant::now();
        if !lease.is_live(now) {
            return Err("MESH_CONNECTION_HEARTBEAT_EXPIRED".into());
        }
        lease.verified_in_channel_heartbeat(sequence, now)?;
        let wall = legacy::now_ms()?;
        {
            let mut value = state()
                .lock()
                .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
            if !peer_current(&value, owner, &peer.peer_device_id, generation) {
                return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
            }
            let entry = value.peers.get_mut(&peer.peer_device_id).unwrap();
            entry.status.state = "connected";
            entry.status.last_heartbeat_at = Some(wall);
            entry.status.expires_at = Some(wall + legacy::PUBLIC_LEASE.as_millis() as u64);
            entry.status.error_code = None;
            entry.deadline = Some(now + legacy::PUBLIC_LEASE);
        }
        if role == ConnectionRole::Client {
            sleep(HEARTBEAT_INTERVAL).await;
        }
    }
    lease.close();
    publish_peer(
        owner,
        generation,
        &peer.peer_device_id,
        "reconnecting",
        None,
    );
    let _ = timeout(Duration::from_secs(1), tls.shutdown()).await;
    Ok(())
}

async fn client_cycle(
    owner: u64,
    generation: u64,
    intent: &ConnectionIntent,
    peer: &PeerIntent,
) -> Result<(), String> {
    fresh(intent, Some(peer)).await?;
    let admitted = legacy::authorize_peer(&peer.peer_fingerprint).await?;
    ensure_admission(intent, peer, &admitted)?;
    publish_peer(owner, generation, &peer.peer_device_id, "discovering", None);
    let mut routes = Vec::new();
    if let Ok(local) = lan::local_interface().await {
        if let Ok(peers) = lan::resolve_peer(&local, &peer.peer_fingerprint).await {
            routes.extend(peers.into_iter().map(|remote| Route {
                local: local.address,
                peer: remote,
                kind: RouteKind::Lan(local.clone()),
            }));
        }
    }
    // Optionaler bestehender privater Overlaypfad, kein notwendiges VPN-Setup.
    if let Ok(tailnet) = legacy::discover().await {
        routes.extend(tailnet.peers.into_iter().map(|remote| Route {
            local: tailnet.local,
            peer: remote,
            kind: RouteKind::Tailnet,
        }));
    }
    if routes.is_empty() {
        return Err("MESH_ACCOUNT_NETWORK_UNAVAILABLE".into());
    }
    for route in routes {
        if !current(owner, generation, &peer.peer_device_id) {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        fresh(intent, Some(peer)).await?;
        mesh_admission::recheck_after_probe(&admitted, &peer.peer_fingerprint).await?;
        publish_peer(owner, generation, &peer.peer_device_id, "connecting", None);
        match open_client(&route, &admitted).await {
            Ok(tls) => {
                return connected(
                    owner,
                    generation,
                    intent,
                    peer,
                    route,
                    admitted,
                    tls,
                    ConnectionRole::Client,
                )
                .await
            }
            Err(error)
                if transient(&error)
                    || matches!(
                        error.as_str(),
                        "MESH_CONNECTION_PEER_PIN_MISMATCH" | "MESH_CONNECTION_TLS_DENIED"
                    ) => {}
            Err(error) => return Err(error),
        }
    }
    Err("MESH_CONNECTION_NO_PEER".into())
}
pub(super) async fn client_loop(
    owner: u64,
    generation: u64,
    intent: ConnectionIntent,
    peer: PeerIntent,
) {
    let mut attempt = 0u32;
    while current(owner, generation, &peer.peer_device_id) {
        match client_cycle(owner, generation, &intent, &peer).await {
            Ok(()) => attempt = 0,
            Err(error) if transient(&error) => {
                publish_peer(
                    owner,
                    generation,
                    &peer.peer_device_id,
                    "reconnecting",
                    Some(&error),
                );
                sleep(Duration::from_secs(
                    2u64.saturating_pow(attempt.min(3) + 1).min(16),
                ))
                .await;
                attempt = attempt.saturating_add(1);
            }
            Err(error) => {
                terminal_peer_failure(owner, generation, &peer.peer_device_id, &error);
                return;
            }
        }
    }
}

fn active_server_peers(owner: u64) -> Result<Vec<(PeerIntent, u64)>, String> {
    let value = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    if value.owner_generation != owner {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    let intent = value
        .intent
        .as_ref()
        .ok_or("MESH_ACCOUNT_OPERATION_CANCELLED")?;
    Ok(intent
        .peers
        .iter()
        .filter(|peer| peer.enabled)
        .filter_map(|peer| {
            let runtime = value.peers.get(&peer.peer_device_id)?;
            if runtime
                .task
                .as_ref()
                .is_some_and(|task| !task.is_finished())
            {
                return None;
            }
            Some((peer.clone(), runtime.generation))
        })
        .take(profile::MAX_PEERS)
        .collect())
}
async fn accept_peer(
    owner: u64,
    intent: &ConnectionIntent,
    mut socket: TcpStream,
    route: Route,
) -> Result<(PeerIntent, u64, NativeAdmission, TlsStream<TcpStream>), String> {
    route_live(&route).await?;
    fresh(intent, None).await?;
    if socket.local_addr().map(|value| value.ip()).ok() != Some(IpAddr::V4(route.local))
        || socket.peer_addr().map(|value| value.ip()).ok() != Some(IpAddr::V4(route.peer))
    {
        return Err("MESH_CONNECTION_ADDRESS_DENIED".into());
    }
    let certificate = timeout(Duration::from_secs(5), read_cert(&mut socket))
        .await
        .map_err(|_| "MESH_CONNECTION_TLS_DENIED")??;
    let local = crate::mesh_identity::existing_identity(&intent.owner_id)
        .map_err(|_| "MESH_ACCOUNT_LOCAL_IDENTITY_CHANGED")?;
    let identity = DeviceTlsIdentity::from_signing_key(&local)
        .map_err(|_| "MESH_ACCOUNT_LOCAL_IDENTITY_CHANGED")?;
    let mut selected = None;
    // Nur bereits tatsächlich lokal genehmigte Pins dienen dem Zertifikatsvergleich.
    for (peer, generation) in active_server_peers(owner)? {
        let Ok(pin) = crate::mesh_trust::approved_peer_for_account(
            &intent.owner_id,
            &peer.peer_fingerprint,
            &local.verifying_key(),
        ) else {
            continue;
        };
        if pin.public_key != peer.peer_public_key {
            continue;
        }
        if strict_server_config(&identity, &pin, &certificate).is_ok() {
            selected = Some((peer, generation));
            break;
        }
    }
    let (peer, generation) = selected.ok_or("MESH_CONNECTION_PEER_PIN_MISMATCH")?;
    fresh(intent, Some(&peer)).await?;
    let admitted = legacy::authorize_peer(&peer.peer_fingerprint).await?;
    ensure_admission(intent, &peer, &admitted)?;
    if !current(owner, generation, &peer.peer_device_id) {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    let identity = DeviceTlsIdentity::from_signing_key(&admitted.local_signing)
        .map_err(|_| "MESH_ACCOUNT_LOCAL_IDENTITY_CHANGED")?;
    let config = strict_server_config(&identity, &admitted.approved_peer, &certificate)
        .map_err(|_| "MESH_CONNECTION_TLS_DENIED")?;
    timeout(
        Duration::from_secs(5),
        write_cert(&mut socket, identity.certificate_der()),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_TLS_DENIED")??;
    let tls = timeout(
        TLS_TIMEOUT,
        TlsAcceptor::from(Arc::new(config)).accept(socket),
    )
    .await
    .map_err(|_| "MESH_CONNECTION_TLS_DENIED")?
    .map_err(|_| "MESH_CONNECTION_TLS_DENIED")?;
    if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err("MESH_CONNECTION_TLS_DENIED".into());
    }
    fresh(intent, Some(&peer)).await?;
    Ok((peer, generation, admitted, TlsStream::Server(tls)))
}

struct BoundListener {
    listener: TcpListener,
    local: Ipv4Addr,
    kind: RouteKind,
}
async fn bind_listeners() -> Result<Vec<BoundListener>, String> {
    let mut result = Vec::new();
    if let Ok(local) = lan::local_interface().await {
        if let Ok(listener) = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(
            local.address,
            legacy::PORT,
        )))
        .await
        {
            result.push(BoundListener {
                listener,
                local: local.address,
                kind: RouteKind::Lan(local),
            });
        }
    }
    if let Ok(tailnet) = legacy::discover().await {
        if result.iter().all(|entry| entry.local != tailnet.local) {
            if let Ok(listener) = TcpListener::bind(SocketAddr::V4(SocketAddrV4::new(
                tailnet.local,
                legacy::PORT,
            )))
            .await
            {
                result.push(BoundListener {
                    listener,
                    local: tailnet.local,
                    kind: RouteKind::Tailnet,
                });
            }
        }
    }
    if result.is_empty() {
        return Err("MESH_ACCOUNT_NETWORK_UNAVAILABLE".into());
    }
    Ok(result)
}
async fn server_cycle(owner: u64, intent: &ConnectionIntent) -> Result<(), String> {
    fresh(intent, None).await?;
    if intent.local_device_id != intent.main_device_id {
        return Err("MESH_ACCOUNT_ROLE_FROM_MAIN_ONLY".into());
    }
    let listeners = bind_listeners().await?;
    // Ein Supervisor, höchstens je ein konkret gebundener LAN-/Overlaylistener;
    // keine neue Portbindung pro Teilnehmer und niemals eine Wildcardadresse.
    let _bonjour = if listeners
        .iter()
        .any(|entry| matches!(&entry.kind, RouteKind::Lan(_)))
    {
        Some(lan::advertise(&intent.local_fingerprint)?)
    } else {
        None
    };
    {
        let mut value = state()
            .lock()
            .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
        if value.owner_generation != owner {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        value.server_state = "listening";
        value.error_code = None;
    }
    loop {
        if !owner_current(owner) {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        let secondary = async {
            if let Some(listener) = listeners.get(1) {
                listener.listener.accept().await
            } else {
                std::future::pending().await
            }
        };
        let event = tokio::select! {
            result = listeners[0].listener.accept() => Some((0, result)),
            result = secondary => Some((1, result)),
            _ = sleep(Duration::from_secs(10)) => None,
        };
        fresh(intent, None).await?;
        let Some((index, result)) = event else {
            continue;
        };
        let (socket, source) = result.map_err(|_| "MESH_ACCOUNT_NETWORK_UNAVAILABLE")?;
        let IpAddr::V4(peer_ip) = source.ip() else {
            continue;
        };
        let listener = &listeners[index];
        let route = Route {
            local: listener.local,
            peer: peer_ip,
            kind: listener.kind.clone(),
        };
        // Ein unbestätigter Handshake auf einmal, höchstens 9 aktive Teilnehmer.
        let outcome = timeout(
            Duration::from_secs(20),
            accept_peer(owner, intent, socket, route.clone()),
        )
        .await;
        let Ok(Ok((peer, generation, admitted, tls))) = outcome else {
            continue;
        };
        let mut value = state()
            .lock()
            .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
        if !peer_current(&value, owner, &peer.peer_device_id, generation) {
            continue;
        }
        if value.peers[&peer.peer_device_id]
            .task
            .as_ref()
            .is_some_and(|task| !task.is_finished())
        {
            continue;
        }
        advance(&mut value.next_peer_generation);
        let generation = value.next_peer_generation;
        let entry = value.peers.get_mut(&peer.peer_device_id).unwrap();
        entry.generation = generation;
        entry.status.state = "connecting";
        let saved_intent = intent.clone();
        let id = peer.peer_device_id.clone();
        entry.task = Some(tokio::spawn(async move {
            match connected(
                owner,
                generation,
                &saved_intent,
                &peer,
                route,
                admitted,
                tls,
                ConnectionRole::Server,
            )
            .await
            {
                Ok(()) => publish_peer(owner, generation, &id, "listening", None),
                Err(error) if transient(&error) => {
                    publish_peer(owner, generation, &id, "listening", Some(&error))
                }
                Err(error) => terminal_peer_failure(owner, generation, &id, &error),
            }
        }));
    }
}
pub(super) async fn server_loop(owner: u64, intent: ConnectionIntent) {
    let mut attempt = 0u32;
    while owner_current(owner) {
        match server_cycle(owner, &intent).await {
            Ok(()) => attempt = 0,
            Err(error) if transient(&error) => {
                if let Ok(mut value) = state().lock() {
                    if value.owner_generation != owner {
                        return;
                    }
                    value.server_state = "blocked";
                    value.error_code = Some(error);
                }
                sleep(Duration::from_secs(
                    2u64.saturating_pow(attempt.min(3) + 1).min(16),
                ))
                .await;
                attempt = attempt.saturating_add(1);
            }
            Err(error) => {
                if let Ok(mut value) = state().lock() {
                    if value.owner_generation != owner {
                        return;
                    }
                    if let Some(intent) = value.intent.as_mut() {
                        for peer in &mut intent.peers {
                            peer.enabled = false;
                        }
                        let _ = profile::save(intent);
                    }
                    // Fremde spätere Peer-Callbacks können den Eigentümerwechsel nicht zurücknehmen.
                    advance(&mut value.owner_generation);
                    advance(&mut value.epoch);
                    for (_, mut peer) in std::mem::take(&mut value.peers) {
                        if let Some(task) = peer.task.take() {
                            task.abort();
                        }
                    }
                    value.reviews.clear();
                    value.server_state = "blocked";
                    value.error_code = Some(error);
                }
                return;
            }
        }
    }
}
