// Created by NMKato Solutions
//! Stage4AA – isolated, one-shot pinned mutual TLS over the ALREADY verified
//! Tailscale overlay. Stage4W's RFC1918 /24 policy is never changed.
//!
//! This is NOT a persistent Mesh session. It never creates or exports a
//! private key, trusts a discovery record, scans networks, installs background
//! listeners, authorizes remote jobs, writes trust or changes production.

use crate::{
    mesh_admission,
    mesh_private_lan_qa::{owner_qa_identity, read_cert, write_cert, SingleQaPermit},
};
use serde_json::Value;
use std::{
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    time::Duration,
};
use tokio::{
    net::{TcpListener, TcpSocket, TcpStream},
    process::Command,
    time::timeout,
};

const OPT_IN: &str = "KATOSYNC_STAGE4AA_TAILNET_QA_ONCE";
const OPT_IN_VALUE: &str = "OWNER_LAUNCHED_TAILNET_QA_ONLY";
const LAN_OPT_IN: &str = "KATOSYNC_STAGE4W_LAN_QA_ONCE";
const LAN_OPT_IN_VALUE: &str = "OWNER_LAUNCHED_QA_ONLY";
const TAILSCALE_MACOS_BIN: &str = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const TAILNET_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const STATUS_BYTES_MAX: usize = 131_072;
const CERT_PRELUDE_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(35);

fn gate(compiled: bool, local: Option<&str>, tailnet: Option<&str>) -> bool {
    compiled && local == Some(LAN_OPT_IN_VALUE) && tailnet == Some(OPT_IN_VALUE)
}

pub(crate) fn require_owner_opt_ins() -> Result<(), String> {
    if gate(
        cfg!(feature = "stage4j-qa"),
        std::env::var(LAN_OPT_IN).ok().as_deref(),
        std::env::var(OPT_IN).ok().as_deref(),
    ) {
        Ok(())
    } else {
        Err("MESH_STAGE4AA_EXPLICIT_TWO_FACTOR_QA_OPT_IN_REQUIRED".into())
    }
}

fn is_overlay_v4(ip: &Ipv4Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 100 && (64..=127).contains(&octets[1])
}

pub(crate) fn policy(local: &str, remote: &str, port: u16) -> Result<(Ipv4Addr, Ipv4Addr), String> {
    let local = local
        .parse::<Ipv4Addr>()
        .map_err(|_| "MESH_STAGE4AA_ADDRESS_DENIED")?;
    let remote = remote
        .parse::<Ipv4Addr>()
        .map_err(|_| "MESH_STAGE4AA_ADDRESS_DENIED")?;
    if !(1025..=65535).contains(&port)
        || !is_overlay_v4(&local)
        || !is_overlay_v4(&remote)
        || local == remote
    {
        return Err("MESH_STAGE4AA_ADDRESS_DENIED".into());
    }
    Ok((local, remote))
}

fn listed_ips(record: &Value, ip: Ipv4Addr) -> bool {
    record
        .get("TailscaleIPs")
        .and_then(Value::as_array)
        .is_some_and(|list| {
            list.iter()
                .any(|candidate| candidate.as_str() == Some(ip.to_string().as_str()))
        })
}

/// The 100.64/10 prefix by itself is NEVER trusted. Self and exact online
/// peer must be present in the live, local Tailscale daemon's inventory under
/// the same Tailscale user. KatoOS owner trust and Ed25519 pinning remain
/// entirely independent and mandatory.
fn verify_daemon_snapshot(doc: &Value, local: Ipv4Addr, remote: Ipv4Addr) -> Result<(), String> {
    let error = || "MESH_STAGE4AA_TAILSCALE_PEER_UNVERIFIED".to_string();
    if doc.get("BackendState").and_then(Value::as_str) != Some("Running") {
        return Err(error());
    }
    let own = doc
        .get("Self")
        .filter(|value| value.is_object())
        .ok_or_else(error)?;
    let self_user = own
        .get("UserID")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(error)?;
    if own.get("Online").and_then(Value::as_bool) != Some(true)
        || own.get("Expired").and_then(Value::as_bool) == Some(true)
        || !listed_ips(own, local)
    {
        return Err(error());
    }
    let peer = doc
        .get("Peer")
        .and_then(Value::as_object)
        .ok_or_else(error)?;
    let matches: Vec<&Value> = peer
        .values()
        .filter(|record| listed_ips(record, remote))
        .collect();
    if matches.len() != 1 {
        return Err(error());
    }
    let peer = matches[0];
    if peer.get("Online").and_then(Value::as_bool) != Some(true)
        || peer.get("Expired").and_then(Value::as_bool) == Some(true)
        || peer.get("UserID").and_then(Value::as_u64) != Some(self_user)
    {
        return Err(error());
    }
    Ok(())
}

/// Fixed, non-shell command and bounded result; no path from CLI input.
pub(crate) async fn verify_live_tailnet(local: Ipv4Addr, remote: Ipv4Addr) -> Result<(), String> {
    let output = timeout(
        TAILNET_STATUS_TIMEOUT,
        Command::new(TAILSCALE_MACOS_BIN)
            .arg("status")
            .arg("--json")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "MESH_STAGE4AA_TAILSCALE_UNAVAILABLE".to_string())?
    .map_err(|_| "MESH_STAGE4AA_TAILSCALE_UNAVAILABLE".to_string())?;
    if !output.status.success() || output.stdout.len() > STATUS_BYTES_MAX {
        return Err("MESH_STAGE4AA_TAILSCALE_UNAVAILABLE".into());
    }
    let snapshot: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| "MESH_STAGE4AA_TAILSCALE_UNAVAILABLE".to_string())?;
    verify_daemon_snapshot(&snapshot, local, remote)
}

async fn serve_once(local: Ipv4Addr, remote: Ipv4Addr, port: u16, pin: &str) -> Result<(), String> {
    verify_live_tailnet(local, remote).await?;
    let identity = owner_qa_identity(pin).await?;
    // Recheck live overlay after owner/network/Keychain authorization.
    verify_live_tailnet(local, remote).await?;
    let bind = SocketAddr::V4(SocketAddrV4::new(local, port));
    let listener = TcpListener::bind(bind)
        .await
        .map_err(|_| "MESH_STAGE4AA_LISTEN_DENIED".to_string())?;
    let (mut socket, source) = timeout(ACCEPT_TIMEOUT, listener.accept())
        .await
        .map_err(|_| "MESH_STAGE4AA_ACCEPT_TIMEOUT".to_string())?
        .map_err(|_| "MESH_STAGE4AA_ACCEPT_FAILED".to_string())?;
    drop(listener);
    if source.ip() != std::net::IpAddr::V4(remote) {
        return Err("MESH_STAGE4AA_SOURCE_IP_DENIED".into());
    }
    verify_live_tailnet(local, remote).await?;
    let public_der = timeout(CERT_PRELUDE_TIMEOUT, read_cert(&mut socket))
        .await
        .map_err(|_| "MESH_STAGE4AA_CERT_TIMEOUT".to_string())??;
    timeout(
        CERT_PRELUDE_TIMEOUT,
        write_cert(&mut socket, identity.certificate_der()),
    )
    .await
    .map_err(|_| "MESH_STAGE4AA_CERT_TIMEOUT".to_string())??;
    mesh_admission::probe_server_after_approval(socket, pin, &public_der)
        .await
        .map_err(|_| "MESH_STAGE4AA_PINNED_MTLS_DENIED".to_string())?;
    verify_live_tailnet(local, remote).await
}

async fn connect_once(
    local: Ipv4Addr,
    remote: Ipv4Addr,
    port: u16,
    pin: &str,
) -> Result<(), String> {
    verify_live_tailnet(local, remote).await?;
    let identity = owner_qa_identity(pin).await?;
    verify_live_tailnet(local, remote).await?;
    let socket = TcpSocket::new_v4().map_err(|_| "MESH_STAGE4AA_SOCKET_DENIED".to_string())?;
    socket
        .bind(SocketAddr::V4(SocketAddrV4::new(local, 0)))
        .map_err(|_| "MESH_STAGE4AA_BIND_DENIED".to_string())?;
    let endpoint = SocketAddr::V4(SocketAddrV4::new(remote, port));
    let mut socket: TcpStream = timeout(CONNECT_TIMEOUT, socket.connect(endpoint))
        .await
        .map_err(|_| "MESH_STAGE4AA_CONNECT_TIMEOUT".to_string())?
        .map_err(|_| "MESH_STAGE4AA_CONNECT_FAILED".to_string())?;
    if socket.local_addr().map(|a| a.ip()).ok() != Some(std::net::IpAddr::V4(local))
        || socket.peer_addr().map(|a| a.ip()).ok() != Some(std::net::IpAddr::V4(remote))
    {
        return Err("MESH_STAGE4AA_SOURCE_ADDRESS_DENIED".into());
    }
    verify_live_tailnet(local, remote).await?;
    timeout(
        CERT_PRELUDE_TIMEOUT,
        write_cert(&mut socket, identity.certificate_der()),
    )
    .await
    .map_err(|_| "MESH_STAGE4AA_CERT_TIMEOUT".to_string())??;
    let public_der = timeout(CERT_PRELUDE_TIMEOUT, read_cert(&mut socket))
        .await
        .map_err(|_| "MESH_STAGE4AA_CERT_TIMEOUT".to_string())??;
    mesh_admission::probe_client_after_approval(socket, pin, &public_der)
        .await
        .map_err(|_| "MESH_STAGE4AA_PINNED_MTLS_DENIED".to_string())?;
    verify_live_tailnet(local, remote).await
}

/// Never use this function through Tauri IPC; only the explicitly gated CLI
/// calls it. The stream, if opened, is closed before returning.
pub(crate) async fn run_once(args: Vec<String>) -> Result<(), String> {
    require_owner_opt_ins()?;
    let _permit =
        SingleQaPermit::acquire().map_err(|_| "MESH_STAGE4AA_ALREADY_RUNNING".to_string())?;
    if args.len() != 5 {
        return Err("MESH_STAGE4AA_ARGUMENTS_DENIED".into());
    }
    let role = args[0].as_str();
    let port = args[3]
        .parse::<u16>()
        .map_err(|_| "MESH_STAGE4AA_ARGUMENTS_DENIED".to_string())?;
    let (local, remote) = policy(&args[1], &args[2], port)?;
    match role {
        "listen" => serve_once(local, remote, port, &args[4]).await,
        "connect" => connect_once(local, remote, port, &args[4]).await,
        _ => Err("MESH_STAGE4AA_ROLE_DENIED".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn live_status(local: &str, remote: &str) -> Value {
        serde_json::json!({
            "BackendState":"Running",
            "Self":{"UserID":77,"Online":true,"TailscaleIPs":[local]},
            "Peer":{"peer-id":{"UserID":77,"Online":true,"TailscaleIPs":[remote]}}
        })
    }
    #[test]
    fn two_explicit_owner_flags_and_qa_feature_are_mandatory() {
        assert!(!gate(false, Some(LAN_OPT_IN_VALUE), Some(OPT_IN_VALUE)));
        assert!(!gate(true, None, Some(OPT_IN_VALUE)));
        assert!(!gate(true, Some(LAN_OPT_IN_VALUE), None));
        assert!(!gate(true, Some("true"), Some(OPT_IN_VALUE)));
        assert!(!gate(true, Some(LAN_OPT_IN_VALUE), Some("true")));
        assert!(gate(true, Some(LAN_OPT_IN_VALUE), Some(OPT_IN_VALUE)));
    }
    #[test]
    fn only_distinct_tailnet_ips_and_ephemeral_unprivileged_ports() {
        assert!(policy("100.85.168.23", "100.117.12.92", 39402).is_ok());
        for (a, b, port) in [
            ("100.85.168.23", "100.85.168.23", 39402),
            ("100.85.168.23", "100.117.12.92", 443),
            ("0.0.0.0", "100.117.12.92", 39402),
            ("127.0.0.1", "100.117.12.92", 39402),
            ("192.168.178.97", "100.117.12.92", 39402),
            ("100.85.168.23", "8.8.8.8", 39402),
            ("100.85.168.23", "100.128.0.1", 39402),
            ("100.85.168.23", "100.63.255.255", 39402),
        ] {
            assert!(policy(a, b, port).is_err(), "{a}:{b}:{port}");
        }
    }
    #[test]
    fn daemon_snapshot_requires_live_self_exact_online_peer_and_same_user() {
        let (local, remote) = policy("100.85.168.23", "100.117.12.92", 39402).unwrap();
        let mut status = live_status("100.85.168.23", "100.117.12.92");
        assert!(verify_daemon_snapshot(&status, local, remote).is_ok());
        status["Peer"]["peer-id"]["Online"] = serde_json::json!(false);
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
        status["Peer"]["peer-id"]["Online"] = serde_json::json!(true);
        status["Peer"]["peer-id"]["UserID"] = serde_json::json!(11);
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
        status["Peer"]["peer-id"]["UserID"] = serde_json::json!(77);
        status["Self"]["TailscaleIPs"] = serde_json::json!(["100.85.168.24"]);
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
        status["Self"]["TailscaleIPs"] = serde_json::json!(["100.85.168.23"]);
        status["Peer"]["peer-id"]["TailscaleIPs"] = serde_json::json!(["100.117.12.93"]);
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
    }
    #[test]
    fn duplicate_peer_ip_spoof_expired_or_disabled_tailnet_fail_closed() {
        let (local, remote) = policy("100.85.168.23", "100.117.12.92", 39402).unwrap();
        let mut status = live_status("100.85.168.23", "100.117.12.92");
        status["Peer"]["duplicate"] = status["Peer"]["peer-id"].clone();
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
        status["Peer"].as_object_mut().unwrap().remove("duplicate");
        status["Peer"]["peer-id"]["Expired"] = serde_json::json!(true);
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
        status["Peer"]["peer-id"]["Expired"] = serde_json::json!(false);
        status["BackendState"] = serde_json::json!("Stopped");
        assert!(verify_daemon_snapshot(&status, local, remote).is_err());
    }
}
