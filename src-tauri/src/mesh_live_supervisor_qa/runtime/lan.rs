// Created by NMKato Solutions
//! Bonjour liefert nur Routinghinweise. Vertrauen entsteht ausschließlich durch Admission und mTLS.
use std::{
    net::{Ipv4Addr, SocketAddr},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::{Child, Command},
    time::timeout,
};

const SERVICE: &str = "_katosync-mesh._tcp";
const PORT: u16 = 49284;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_OUTPUT: usize = 8192;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct LanInterface {
    pub address: Ipv4Addr,
    pub name: String,
}

pub(super) fn same_private_link(local: Ipv4Addr, peer: Ipv4Addr) -> bool {
    let usable = |ip: Ipv4Addr| ip.is_private() && (1..=254).contains(&ip.octets()[3]);
    usable(local) && usable(peer) && local != peer && local.octets()[..3] == peer.octets()[..3]
}
fn interface_name(raw: &str) -> Option<String> {
    let mut found = raw
        .lines()
        .filter_map(|line| line.trim().strip_prefix("interface:").map(str::trim));
    let value = found.next()?;
    if found.next().is_some()
        || value.len() > 8
        || !value.starts_with("en")
        || value.len() <= 2
        || !value[2..].bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    Some(value.into())
}
fn service_name(pin: &str) -> Result<String, String> {
    if pin.len() != 47
        || !pin.bytes().enumerate().all(|(index, byte)| {
            if index % 3 == 2 {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit() && !byte.is_ascii_lowercase()
            }
        })
    {
        return Err("MESH_ACCOUNT_INVALID_PEER".into());
    }
    Ok(format!("KatoSync-{}", pin.replace('-', "")))
}
async fn bounded_output(executable: &str, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    let stdout = child.stdout.take().ok_or("MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    let result = timeout(COMMAND_TIMEOUT, async {
        let mut bytes = Vec::new();
        let mut bounded = stdout.take((MAX_OUTPUT + 1) as u64);
        bounded
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
        if bytes.len() > MAX_OUTPUT {
            return Err("MESH_ACCOUNT_LAN_UNAVAILABLE");
        }
        let status = child
            .wait()
            .await
            .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
        if !status.success() {
            return Err("MESH_ACCOUNT_LAN_UNAVAILABLE");
        }
        String::from_utf8(bytes).map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")
    })
    .await
    .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    result.map_err(str::to_string)
}

pub(super) async fn local_interface() -> Result<LanInterface, String> {
    if !cfg!(target_os = "macos") {
        return Err("MESH_ACCOUNT_LAN_UNAVAILABLE".into());
    }
    let route = bounded_output("/sbin/route", &["-n", "get", "default"]).await?;
    let name = interface_name(&route).ok_or("MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    let raw = bounded_output("/usr/sbin/ipconfig", &["getifaddr", &name]).await?;
    let address: Ipv4Addr = raw
        .trim()
        .parse()
        .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    if !address.is_private() || !(1..=254).contains(&address.octets()[3]) {
        return Err("MESH_ACCOUNT_LAN_UNAVAILABLE".into());
    }
    Ok(LanInterface { address, name })
}

fn resolved_host(line: &str, expected_name: &str) -> Option<String> {
    let (service, endpoint) = line.split_once(" can be reached at ")?;
    if service.split_whitespace().last()? != format!("{expected_name}.{SERVICE}.local.") {
        return None;
    }
    let endpoint = endpoint.split_whitespace().next()?;
    let (host, port) = endpoint.rsplit_once(':')?;
    if port.parse::<u16>().ok()? != PORT
        || host.len() > 253
        || !(host.ends_with(".local.") || host.ends_with(".local"))
        || !host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
    {
        return None;
    }
    Some(host.into())
}

/// Löst genau den erwarteten Geräte-Dienst auf; kein Browse aller Hosts und kein Portscan.
pub(super) async fn resolve_peer(local: &LanInterface, pin: &str) -> Result<Vec<Ipv4Addr>, String> {
    let name = service_name(pin)?;
    let mut child = Command::new("/usr/bin/dns-sd")
        .args(["-L", &name, SERVICE, "local."])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    let stdout = child.stdout.take().ok_or("MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    let host = timeout(COMMAND_TIMEOUT, async {
        let mut reader = BufReader::new(stdout.take((MAX_OUTPUT + 1) as u64));
        let mut total = 0;
        for _ in 0..64 {
            let mut line = String::new();
            let count = reader
                .read_line(&mut line)
                .await
                .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
            total += count;
            if count == 0 || total > MAX_OUTPUT {
                break;
            }
            if let Some(host) = resolved_host(&line, &name) {
                return Ok(host);
            }
        }
        Err("MESH_ACCOUNT_LAN_UNAVAILABLE")
    })
    .await
    .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?
    .map_err(str::to_string)?;
    let _ = child.start_kill();
    let _ = timeout(Duration::from_secs(1), child.wait()).await;
    let addresses = timeout(
        COMMAND_TIMEOUT,
        tokio::net::lookup_host((host.as_str(), PORT)),
    )
    .await
    .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?
    .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE")?;
    let mut peers: Vec<Ipv4Addr> = addresses
        .filter_map(|address| match address {
            SocketAddr::V4(value) if same_private_link(local.address, *value.ip()) => {
                Some(*value.ip())
            }
            _ => None,
        })
        .take(8)
        .collect();
    peers.sort_unstable();
    peers.dedup();
    if peers.is_empty() {
        return Err("MESH_ACCOUNT_LAN_UNAVAILABLE".into());
    }
    Ok(peers)
}

/// Das Kind gehört dem Listener-Lebenszyklus und endet bei Stop, Logout und Revisionwechsel.
pub(super) fn advertise(pin: &str) -> Result<Child, String> {
    let name = service_name(pin)?;
    Command::new("/usr/bin/dns-sd")
        .args(["-R", &name, SERVICE, "local.", "49284", "v=1"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "MESH_ACCOUNT_LAN_UNAVAILABLE".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn route_hints_never_allow_external_vpn_loopback_or_broad_subnet() {
        let local = "192.168.1.20".parse().unwrap();
        assert!(same_private_link(local, "192.168.1.21".parse().unwrap()));
        for denied in [
            "192.168.1.20",
            "192.168.1.0",
            "192.168.1.255",
            "192.168.2.21",
            "100.64.1.2",
            "8.8.8.8",
            "127.0.0.1",
            "0.0.0.0",
        ] {
            assert!(
                !same_private_link(local, denied.parse().unwrap()),
                "{denied}"
            );
        }
    }
    #[test]
    fn only_exact_fixed_bonjour_service_and_port_can_yield_hint() {
        let name = "KatoSync-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let valid = format!("12:00:00 {name}.{SERVICE}.local. can be reached at test-mac.local.:49284 (interface 14)");
        assert_eq!(
            resolved_host(&valid, name).as_deref(),
            Some("test-mac.local.")
        );
        assert!(resolved_host(&valid.replace(":49284", ":22"), name).is_none());
        assert!(resolved_host(&valid.replace("test-mac.local.", "evil.example."), name).is_none());
        assert!(resolved_host(&valid.replace(name, "Other"), name).is_none());
        assert_eq!(interface_name("interface: en0\n").as_deref(), Some("en0"));
        assert!(interface_name("interface: utun1\n").is_none());
        assert!(interface_name("interface: en0\ninterface: en1\n").is_none());
    }
}
