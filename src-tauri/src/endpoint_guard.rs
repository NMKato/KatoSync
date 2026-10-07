//! Netzwerkgrenze fuer benutzerdefinierte Modell-Endpunkte (Local-Lane und API-Lane).
//!
//! Regeln (fail-closed):
//! - Klartext-HTTP nur fuer exakte Loopback-Ziele (`localhost`, 127.0.0.0/8, `::1`).
//! - Alles andere braucht HTTPS und muss auf oeffentliche Unicast-Adressen aufloesen.
//! - Private/RFC1918/CGNAT/ULA, Link-Local, Cloud-Metadaten, Multicast, Broadcast,
//!   unspezifizierte und reservierte Bereiche sind blockiert. LAN-Endpunkte sind in diesem
//!   Release bewusst nicht freischaltbar.
//! - Geprueft wird nicht nur der Hostname-Text, sondern jede DNS-Aufloesung beim Verbindungsaufbau
//!   (eigener Resolver -> der Client verbindet nur zu den geprueften Adressen; DNS-Rebinding
//!   zwischen Pruefung und Verbindung ist damit ausgeschlossen).
//! - Keine Redirects, kein Proxy: Credentials verlassen nie den validierten Origin.
//!
//! (Created by NMKato Solutions)

use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    redirect::Policy,
    Url,
};
use std::{
    fmt,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};

/// Netzklasse einer konkreten IP-Adresse.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpClass {
    Loopback,
    /// RFC1918, CGNAT, ULA: LAN-Ziele, im Release immer blockiert.
    Private,
    /// Link-Local, Metadaten, Multicast, Broadcast, unspezifiziert, Doku-/Reserve-Bereiche.
    Blocked,
    Public,
}

/// Wohin ein validierter Endpunkt zeigen darf.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetKind {
    /// Exakter Loopback-Host; HTTP erlaubt, Aufloesung muss ausschliesslich Loopback liefern.
    Loopback,
    /// HTTPS, Aufloesung muss ausschliesslich oeffentliche Adressen liefern.
    Public,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointRejection {
    Missing,
    Invalid,
    /// Nicht-Loopback-Ziel ohne HTTPS.
    HttpsRequired,
    /// Ziel liegt (textuell oder aufgeloest) in einem gesperrten Netzbereich.
    BlockedNetwork,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedEndpoint {
    pub url: Url,
    pub target: TargetKind,
}

impl ValidatedEndpoint {
    /// Exakter, normalisierter Origin (Schema + Host + effektiver Port) fuer die Key-Bindung.
    pub fn origin(&self) -> String {
        self.url.origin().ascii_serialization()
    }

    /// Secrets nie im Klartext uebertragen – ausser an exakte Loopback-Ziele.
    pub fn key_transport_allowed(&self) -> bool {
        self.url.scheme() == "https" || self.target == TargetKind::Loopback
    }
}

/// Bekannte Metadaten-Endpunkte, die nicht schon ueber ihren Bereich blockiert sind.
const METADATA_V4: [Ipv4Addr; 2] = [
    // Azure WireServer (oeffentlicher Bereich, aber nur VM-intern sinnvoll).
    Ipv4Addr::new(168, 63, 129, 16),
    // Alibaba Cloud Metadata (CGNAT-Bereich; explizit, damit es nie als "nur LAN" gilt).
    Ipv4Addr::new(100, 100, 100, 200),
];
/// AWS IMDS ueber IPv6 (ULA-Bereich; explizit gesperrt).
const METADATA_V6: [Ipv6Addr; 1] = [Ipv6Addr::new(0xfd00, 0x0ec2, 0, 0, 0, 0, 0, 0x0254)];

pub fn classify_ip(ip: IpAddr) -> IpClass {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => classify_v6(v6),
    }
}

fn classify_v4(ip: Ipv4Addr) -> IpClass {
    let [a, b, c, _] = ip.octets();
    if ip.is_loopback() {
        return IpClass::Loopback;
    }
    if METADATA_V4.contains(&ip)
        || a == 0 // 0.0.0.0/8 inkl. unspezifiziert
        || ip.is_link_local() // 169.254.0.0/16 inkl. 169.254.169.254
        || ip.is_multicast()
        || ip.is_broadcast()
        || a >= 240 // reserviert
        || ip.is_documentation()
        || (a == 192 && b == 0 && c == 0) // IETF-Protokollzuweisungen
        || (a == 192 && b == 88 && c == 99) // 6to4-Relay-Anycast
        || (a == 198 && (b & 0xfe) == 18)
    // Benchmarking 198.18.0.0/15
    {
        return IpClass::Blocked;
    }
    if ip.is_private() || (a == 100 && (b & 0xc0) == 64) {
        // RFC1918 + CGNAT 100.64.0.0/10
        return IpClass::Private;
    }
    IpClass::Public
}

fn classify_v6(ip: Ipv6Addr) -> IpClass {
    if ip.is_loopback() {
        return IpClass::Loopback;
    }
    if METADATA_V6.contains(&ip) {
        return IpClass::Blocked;
    }
    // ::ffff:a.b.c.d -> wie die eingebettete IPv4-Adresse behandeln.
    if let Some(v4) = ip.to_ipv4_mapped() {
        return classify_v4(v4);
    }
    let seg = ip.segments();
    // :: (unspezifiziert) und veraltete IPv4-kompatible ::a.b.c.d.
    if seg[..6].iter().all(|value| *value == 0) {
        return IpClass::Blocked;
    }
    // NAT64 64:ff9b::/96 -> eingebettete IPv4-Adresse pruefen.
    if seg[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        return classify_v4(embedded_v4(seg[6], seg[7]));
    }
    // 6to4 2002::/16 -> eingebettete IPv4-Adresse pruefen.
    if seg[0] == 0x2002 {
        return match classify_v4(embedded_v4(seg[1], seg[2])) {
            IpClass::Public => IpClass::Public,
            _ => IpClass::Blocked,
        };
    }
    if (seg[0] & 0xfe00) == 0xfc00 {
        return IpClass::Private; // ULA fc00::/7
    }
    let global_unicast = (seg[0] & 0xe000) == 0x2000; // 2000::/3
    let special = (seg[0] == 0x2001 && seg[1] == 0x0db8) // Dokumentation
        || (seg[0] & 0xfff0) == 0x3ff0 // Dokumentation 3fff::/20
        || (seg[0] == 0x2001 && seg[1] < 0x0200); // IETF 2001::/23 inkl. Teredo 2001::/32
    if global_unicast && !special {
        IpClass::Public
    } else {
        // Link-Local, Site-Local, Multicast, 64:ff9b:1::/48, Discard und alles Reservierte.
        IpClass::Blocked
    }
}

fn embedded_v4(high: u16, low: u16) -> Ipv4Addr {
    let [a, b] = high.to_be_bytes();
    let [c, d] = low.to_be_bytes();
    Ipv4Addr::new(a, b, c, d)
}

/// Hostnamen, die per Definition nur im lokalen Netz/Suchdomaenen aufgeloest werden.
const LAN_SUFFIXES: [&str; 9] = [
    ".local",
    ".lan",
    ".home",
    ".home.arpa",
    ".internal",
    ".intranet",
    ".corp",
    ".localdomain",
    ".localhost",
];

fn domain_is_exact_loopback(host: &str) -> bool {
    host == "localhost"
}

fn domain_is_lan(host: &str) -> bool {
    // Einzelne Labels ("router", "metadata") laufen ueber Suchdomaenen ins LAN.
    !host.contains('.') || LAN_SUFFIXES.iter().any(|suffix| host.ends_with(suffix))
}

/// Validiert eine Endpoint-URL vollstaendig textuell. `allow_loopback` ist nur fuer die
/// Local-Lane gesetzt; die API-Lane akzeptiert ausschliesslich oeffentliche HTTPS-Ziele.
pub fn validate_endpoint(
    value: &str,
    allow_loopback: bool,
) -> Result<ValidatedEndpoint, EndpointRejection> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(EndpointRejection::Missing);
    }
    if trimmed.len() > 2048 || trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(EndpointRejection::Invalid);
    }
    // Auch ein leeres "user@" ist ein Credential-Versuch und wird abgelehnt.
    let authority = trimmed
        .split_once("://")
        .map(|(_, rest)| rest.split(['/', '?', '#']).next().unwrap_or(""))
        .unwrap_or("");
    if authority.contains('@') {
        return Err(EndpointRejection::Invalid);
    }
    let url = Url::parse(trimmed).map_err(|_| EndpointRejection::Invalid)?;
    let syntax_ok = matches!(url.scheme(), "http" | "https")
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none();
    if !syntax_ok {
        return Err(EndpointRejection::Invalid);
    }
    // Der URL-Parser kanonisiert IP-Literale (auch Kurzformen wie 0x7f.1 oder 2130706433).
    let raw_host = url.host_str().ok_or(EndpointRejection::Invalid)?;
    let literal = raw_host
        .strip_prefix('[')
        .and_then(|host| host.strip_suffix(']'))
        .unwrap_or(raw_host);
    let class = match literal.parse::<IpAddr>() {
        Ok(ip) => classify_ip(ip),
        Err(_) => {
            let host = raw_host.trim_end_matches('.').to_ascii_lowercase();
            if host.is_empty() {
                return Err(EndpointRejection::Invalid);
            }
            if domain_is_exact_loopback(&host) {
                IpClass::Loopback
            } else if domain_is_lan(&host) {
                IpClass::Private
            } else {
                IpClass::Public
            }
        }
    };
    let target = match class {
        IpClass::Loopback if allow_loopback => TargetKind::Loopback,
        IpClass::Public => TargetKind::Public,
        _ => return Err(EndpointRejection::BlockedNetwork),
    };
    if target == TargetKind::Public && url.scheme() != "https" {
        return Err(EndpointRejection::HttpsRequired);
    }
    Ok(ValidatedEndpoint { url, target })
}

/// Prueft eine konkrete Aufloesung. Gemischte Antworten werden komplett verworfen (fail-closed).
pub fn resolved_addresses_allowed(target: TargetKind, addrs: &[SocketAddr]) -> bool {
    !addrs.is_empty()
        && addrs.iter().all(|addr| {
            let class = classify_ip(addr.ip());
            match target {
                TargetKind::Loopback => class == IpClass::Loopback,
                TargetKind::Public => class == IpClass::Public,
            }
        })
}

/// Fehlermarker im reqwest-Fehlerbaum, damit gesperrte Ziele als solche gemeldet werden.
#[derive(Debug)]
pub struct BlockedTarget;

impl fmt::Display for BlockedTarget {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("endpoint resolves to a blocked network range")
    }
}

impl std::error::Error for BlockedTarget {}

/// Durchsucht die Fehlerkette eines Requests nach einer Resolver-Sperre.
pub fn is_blocked_target(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(err) = current {
        if err.is::<BlockedTarget>() {
            return true;
        }
        current = err.source();
    }
    false
}

/// Resolver, der jede Aufloesung beim Verbindungsaufbau gegen die Zielklasse prueft. Der Client
/// verbindet ausschliesslich zu den hier freigegebenen Adressen.
#[derive(Debug, Clone, Copy)]
pub struct GuardedResolver {
    target: TargetKind,
}

impl GuardedResolver {
    pub fn new(target: TargetKind) -> Self {
        Self { target }
    }
}

impl Resolve for GuardedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let target = self.target;
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs = tokio::net::lookup_host((host.as_str(), 0))
                .await?
                .collect::<Vec<_>>();
            if !resolved_addresses_allowed(target, &addrs) {
                return Err(Box::new(BlockedTarget) as Box<dyn std::error::Error + Send + Sync>);
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// HTTP-Client fuer genau ein validiertes Ziel: geprueftes DNS, keine Redirects, kein Proxy
/// (ein Proxy wuerde die Aufloesung und damit die Adresspruefung umgehen).
pub fn guarded_client(endpoint: &ValidatedEndpoint, limit: Duration) -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(limit)
        .redirect(Policy::none())
        .no_proxy()
        .dns_resolver(Arc::new(GuardedResolver::new(endpoint.target)))
        .build()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    fn ip(value: &str) -> IpClass {
        classify_ip(value.parse().unwrap())
    }

    #[test]
    fn metadata_addresses_are_blocked_including_ipv6_forms() {
        for value in [
            "169.254.169.254",
            "169.254.170.2",
            "168.63.129.16",
            "100.100.100.200",
            "::ffff:169.254.169.254",
            "::ffff:a9fe:a9fe",
            "64:ff9b::a9fe:a9fe",
            "2002:a9fe:a9fe::1",
            "fd00:ec2::254",
            "fe80::a9fe:a9fe",
        ] {
            assert_eq!(ip(value), IpClass::Blocked, "{value}");
        }
    }

    #[test]
    fn special_ranges_are_never_public() {
        for value in [
            "0.0.0.0",
            "0.1.2.3",
            "224.0.0.1",
            "239.255.255.250",
            "255.255.255.255",
            "240.0.0.1",
            "192.0.2.10",
            "198.18.0.1",
            "::",
            "::1.2.3.4",
            "ff02::1",
            "fec0::1",
            "2001:db8::1",
            "2001::1",
            "100::1",
        ] {
            assert_eq!(ip(value), IpClass::Blocked, "{value}");
        }
        for value in [
            "10.0.0.5",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.20",
            "100.64.0.1",
            "fd12:3456::1",
            "::ffff:10.0.0.1",
            "64:ff9b::a00:1",
        ] {
            assert_eq!(ip(value), IpClass::Private, "{value}");
        }
        for value in ["127.0.0.1", "127.8.9.10", "::1", "::ffff:127.0.0.1"] {
            assert_eq!(ip(value), IpClass::Loopback, "{value}");
        }
        for value in [
            "1.1.1.1",
            "172.40.0.5",
            "2606:4700::1111",
            "64:ff9b::101:101",
        ] {
            assert_eq!(ip(value), IpClass::Public, "{value}");
        }
        // 6to4 mit privater Einbettung ist nie oeffentlich.
        assert_eq!(ip("2002:c0a8:0101::1"), IpClass::Blocked);
    }

    #[test]
    fn private_link_local_and_metadata_urls_are_blocked_by_default() {
        for allow_loopback in [true, false] {
            for value in [
                "http://169.254.169.254/latest/meta-data",
                "https://169.254.169.254/v1",
                "https://[fd00:ec2::254]/v1",
                "https://[::ffff:169.254.169.254]/v1",
                "https://[fe80::1]/v1",
                "http://10.0.0.5:8000",
                "https://192.168.1.20:11434",
                "https://172.20.0.5",
                "https://[fd00::1]:1234",
                "https://100.64.1.1",
                "https://0.0.0.0:11434",
                "https://224.0.0.1",
                "https://255.255.255.255",
                "https://studio.local:1234",
                "https://metadata.google.internal/computeMetadata/v1",
                "https://router.home.arpa",
                "https://ollama:11434",
                "https://foo.localhost",
                // WHATWG-IPv4-Kurzformen werden vom Parser kanonisiert und ebenfalls erkannt.
                "https://0xa9fea9fe/",
                "https://2852039166/",
            ] {
                assert_eq!(
                    validate_endpoint(value, allow_loopback).err(),
                    Some(EndpointRejection::BlockedNetwork),
                    "{value} allow_loopback={allow_loopback}"
                );
            }
        }
    }

    #[test]
    fn loopback_http_only_for_exact_loopback_and_only_where_intended() {
        for value in [
            "http://127.0.0.1:11434",
            "http://localhost:1234/v1",
            "http://LOCALHOST.:1234",
            "http://[::1]:1234/v1",
            "https://127.0.0.1:8443",
            "http://2130706433:11434",
        ] {
            let endpoint = validate_endpoint(value, true).unwrap();
            assert_eq!(endpoint.target, TargetKind::Loopback, "{value}");
            assert!(endpoint.key_transport_allowed(), "{value}");
            // Die API-Lane akzeptiert Loopback nie.
            assert_eq!(
                validate_endpoint(value, false).err(),
                Some(EndpointRejection::BlockedNetwork),
                "{value}"
            );
        }
        // Breiteres LAN bekommt nie HTTP – auch nicht mit Loopback-Freigabe.
        assert_eq!(
            validate_endpoint("http://192.168.1.5:8000", true).err(),
            Some(EndpointRejection::BlockedNetwork)
        );
    }

    #[test]
    fn public_endpoints_require_https_and_reject_userinfo() {
        let endpoint = validate_endpoint("https://gateway.example.com/v1", false).unwrap();
        assert_eq!(endpoint.target, TargetKind::Public);
        assert_eq!(endpoint.origin(), "https://gateway.example.com");
        assert!(endpoint.key_transport_allowed());
        assert_eq!(
            validate_endpoint("https://gateway.example.com:443/v1", false)
                .unwrap()
                .origin(),
            "https://gateway.example.com"
        );
        assert_eq!(
            validate_endpoint("http://gateway.example.com/v1", true).err(),
            Some(EndpointRejection::HttpsRequired)
        );
        for value in [
            "https://user:pw@gateway.example.com/v1",
            "https://user@gateway.example.com/v1",
            "https://@gateway.example.com/v1",
            "https://gateway.example.com@169.254.169.254/",
            "https://gateway.example.com/v1?key=x",
            "https://gateway.example.com/v1#x",
            "ftp://gateway.example.com",
            "file:///etc/passwd",
            "https://gateway.example.com/\nHost: evil",
        ] {
            assert_eq!(
                validate_endpoint(value, true).err(),
                Some(EndpointRejection::Invalid),
                "{value}"
            );
        }
        assert_eq!(
            validate_endpoint("  ", true).err(),
            Some(EndpointRejection::Missing)
        );
    }

    #[test]
    fn mixed_or_empty_resolutions_are_rejected() {
        let public: SocketAddr = "93.184.216.34:0".parse().unwrap();
        let private: SocketAddr = "10.0.0.1:0".parse().unwrap();
        let metadata: SocketAddr = "[::ffff:169.254.169.254]:0".parse().unwrap();
        let loopback: SocketAddr = "127.0.0.1:0".parse().unwrap();
        assert!(resolved_addresses_allowed(TargetKind::Public, &[public]));
        assert!(!resolved_addresses_allowed(TargetKind::Public, &[]));
        assert!(!resolved_addresses_allowed(
            TargetKind::Public,
            &[public, private]
        ));
        assert!(!resolved_addresses_allowed(TargetKind::Public, &[metadata]));
        assert!(!resolved_addresses_allowed(TargetKind::Public, &[loopback]));
        assert!(resolved_addresses_allowed(
            TargetKind::Loopback,
            &[loopback]
        ));
        assert!(!resolved_addresses_allowed(
            TargetKind::Loopback,
            &[loopback, public]
        ));
    }

    #[tokio::test]
    async fn hostname_resolving_to_blocked_ip_is_rejected_by_resolver() {
        // "localhost" loest real auf Loopback auf: fuer ein oeffentliches Ziel gesperrt.
        let name = Name::from_str("localhost").unwrap();
        let blocked = GuardedResolver::new(TargetKind::Public).resolve(name).await;
        let error = blocked.err().expect("loopback resolution must be blocked");
        assert!(is_blocked_target(error.as_ref()));
        let name = Name::from_str("localhost").unwrap();
        let allowed = GuardedResolver::new(TargetKind::Loopback)
            .resolve(name)
            .await
            .expect("loopback target may resolve localhost");
        assert!(allowed.into_iter().all(|addr| addr.ip().is_loopback()));
    }

    async fn accept_count(listener: TcpListener, wait: Duration) -> usize {
        let mut count = 0;
        while let Ok(Ok((mut socket, _))) = tokio::time::timeout(wait, listener.accept()).await {
            count += 1;
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
        }
        count
    }

    #[tokio::test]
    async fn client_never_connects_when_resolution_is_blocked() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let watcher = tokio::spawn(accept_count(listener, Duration::from_millis(400)));
        // Simuliert DNS-Rebinding: ein als oeffentlich validiertes Ziel loest auf Loopback auf.
        let endpoint = ValidatedEndpoint {
            url: Url::parse("https://public.example.test").unwrap(),
            target: TargetKind::Public,
        };
        let client = guarded_client(&endpoint, Duration::from_secs(2)).unwrap();
        let error = client
            .get(format!("http://localhost:{port}/v1/models"))
            .bearer_auth("sk-test-never-sent")
            .send()
            .await
            .expect_err("blocked resolution must fail");
        assert!(is_blocked_target(&error));
        // Fehlerketten (Display/Debug, wie sie in Logs landen koennten) enthalten nie den Key.
        for rendered in [
            error.to_string(),
            format!("{error:?}"),
            format!("{error:#}"),
        ] {
            assert!(!rendered.contains("sk-test-never-sent"), "{rendered}");
        }
        assert_eq!(watcher.await.unwrap(), 0, "no TCP connection may be opened");
    }

    #[tokio::test]
    async fn redirects_are_not_followed_and_credentials_never_forwarded() {
        let first = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let first_port = first.local_addr().unwrap().port();
        let second = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let second_port = second.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = first.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = socket.read(&mut buf).await;
            let response = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{second_port}/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = socket.write_all(response.as_bytes()).await;
        });
        let watcher = tokio::spawn(accept_count(second, Duration::from_millis(400)));
        let endpoint = validate_endpoint(&format!("http://127.0.0.1:{first_port}"), true).unwrap();
        let client = guarded_client(&endpoint, Duration::from_secs(2)).unwrap();
        let response = client
            .get(format!("http://127.0.0.1:{first_port}/v1/models"))
            .bearer_auth("sk-test-redirect")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 302);
        assert_eq!(
            watcher.await.unwrap(),
            0,
            "redirect target must never be contacted"
        );

        // Auch ein Redirect auf einen Metadaten-Origin wird nie verfolgt.
        let third = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let third_port = third.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut socket, _) = third.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = socket.read(&mut buf).await;
            let _ = socket
                .write_all(b"HTTP/1.1 307 Temporary Redirect\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await;
        });
        let endpoint = validate_endpoint(&format!("http://127.0.0.1:{third_port}"), true).unwrap();
        let client = guarded_client(&endpoint, Duration::from_secs(2)).unwrap();
        let response = client
            .get(format!("http://127.0.0.1:{third_port}/v1/models"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 307);
    }
}
