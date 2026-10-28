// Created by NMKato Solutions
//! Locally approved, revocable Ed25519 public-key pins. NOT connected peers.
//! Approval requires a fresh, signed, two-way Stage-1B proof plus typed SAS.
//! No network listener, remote job, credentials or silent device acceptance.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use ed25519_dalek::VerifyingKey;
use keyring::Entry;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};

use crate::mesh_identity::{fingerprint, same_account_still_verified};

const MAX_PEERS: usize = 10;
const MAX_PINS_BYTES: usize = 4096;
const TRUST_ACCOUNT: &str = "mesh-approved-public-pins-v1";
const PENDING_ACCOUNT: &str = "mesh-manual-approval-v1";

static MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
fn state_lock() -> &'static Mutex<()> {
    MUTEX.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PendingApproval {
    public_key: String,
    comparison_code: String,
    expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ApprovedPeer {
    pub fingerprint: String,
    pub public_key: String,
    pub approved_at: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInventory {
    pub approval_only: bool,
    pub transport_ready: bool,
    pub remote_jobs_enabled: bool,
    pub peers: Vec<ApprovedPeer>,
}

#[cfg(target_os = "macos")]
fn entry(uid: &str, prefix: &str) -> Result<Entry, String> {
    let uid = uuid::Uuid::parse_str(uid).map_err(|_| "KatoSync-Konto ungültig.")?;
    Entry::new(crate::KEYCHAIN_SERVICE, &format!("{prefix}:{uid}"))
        .map_err(|_| "macOS-Schlüsselbund nicht verfügbar.".to_string())
}
#[cfg(not(target_os = "macos"))]
fn entry(_uid: &str, _prefix: &str) -> Result<Entry, String> {
    Err("Sichere Gerätepins auf diesem Betriebssystem noch nicht freigegeben.".into())
}

fn read_raw(uid: &str, kind: &str) -> Result<Option<String>, String> {
    match entry(uid, kind)?.get_password() {
        Ok(raw) => Ok(Some(raw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Sichere Geräteverwaltung nicht lesbar.".into()),
    }
}
fn save_raw(uid: &str, kind: &str, raw: &str) -> Result<(), String> {
    entry(uid, kind)?
        .set_password(raw)
        .map_err(|_| "Sichere Geräteverwaltung nicht speicherbar.".into())
}
fn clear_raw(uid: &str, kind: &str) -> Result<(), String> {
    match entry(uid, kind)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Sichere Geräteverwaltung nicht löschbar.".into()),
    }
}

fn parse_key(s: &str) -> Result<VerifyingKey, String> {
    let raw = URL_SAFE_NO_PAD
        .decode(s)
        .map_err(|_| "Peer-Schlüssel ungültig.")?;
    let bytes: [u8; 32] = raw.try_into().map_err(|_| "Peer-Schlüssel ungültig.")?;
    VerifyingKey::from_bytes(&bytes).map_err(|_| "Peer-Schlüssel ungültig.".into())
}
fn validate_peer(peer: &ApprovedPeer) -> Result<(), String> {
    let key = parse_key(&peer.public_key)?;
    if fingerprint(&key) != peer.fingerprint
        || peer.status != "locally_approved"
        || peer.approved_at <= 0
    {
        return Err("Gespeicherte Peer-Zulassung beschädigt.".into());
    }
    Ok(())
}
/// Enforces an exact, explicitly approved local pin. An arbitrary caller
/// supplied ApprovedPeer object is never sufficient for network admission.
fn select_approved_peer(
    peers: &[ApprovedPeer],
    requested_fingerprint: &str,
    local_key: &VerifyingKey,
    now: i64,
) -> Result<ApprovedPeer, String> {
    if requested_fingerprint.len() != 47
        || !requested_fingerprint.bytes().enumerate().all(|(i, c)| {
            if i % 3 == 2 {
                c == b'-'
            } else {
                c.is_ascii_hexdigit() && !c.is_ascii_lowercase()
            }
        })
    {
        return Err("MESH_ADMISSION_BAD_FINGERPRINT".into());
    }
    let mut matches = peers
        .iter()
        .filter(|p| p.fingerprint == requested_fingerprint);
    let matched = matches
        .next()
        .ok_or_else(|| "MESH_ADMISSION_PEER_NOT_APPROVED".to_string())?;
    if matches.next().is_some()
        || validate_peer(matched).is_err()
        || matched.approved_at > now.saturating_add(5)
        || matched.public_key == URL_SAFE_NO_PAD.encode(local_key.as_bytes())
    {
        return Err("MESH_ADMISSION_PEER_INVALID".into());
    }
    Ok(matched.clone())
}

/// Native-only account-scoped Keychain read. Called immediately before and
/// after a one-shot TLS probe; never accept a pin supplied by the web UI.
pub(crate) fn approved_peer_for_account(
    owner_uid: &str,
    requested_fingerprint: &str,
    local_key: &VerifyingKey,
) -> Result<ApprovedPeer, String> {
    let _guard = state_lock()
        .lock()
        .map_err(|_| "MESH_ADMISSION_STORE_LOCKED")?;
    let peers = parse_inventory(read_raw(owner_uid, TRUST_ACCOUNT)?)
        .map_err(|_| "MESH_ADMISSION_STORE_UNAVAILABLE".to_string())?;
    select_approved_peer(
        &peers,
        requested_fingerprint,
        local_key,
        Utc::now().timestamp(),
    )
}

fn parse_inventory(raw: Option<String>) -> Result<Vec<ApprovedPeer>, String> {
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };
    if raw.len() > MAX_PINS_BYTES {
        return Err("Geräteverwaltung zu groß.".into());
    }
    let peers: Vec<ApprovedPeer> = serde_json::from_str(&raw)
        .map_err(|_| "Gespeicherte Geräteverwaltung beschädigt.".to_string())?;
    if peers.len() > MAX_PEERS {
        return Err("Zu viele Gerätepins.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for peer in &peers {
        validate_peer(peer)?;
        if !seen.insert(&peer.public_key) {
            return Err("Doppelte Gerätepins.".into());
        }
    }
    Ok(peers)
}
fn approve_peer(peers: &mut Vec<ApprovedPeer>, key: &VerifyingKey, at: i64) -> Result<(), String> {
    let encoded = URL_SAFE_NO_PAD.encode(key.as_bytes());
    if peers.iter().any(|p| p.public_key == encoded) {
        return Ok(());
    }
    if peers.len() >= MAX_PEERS {
        return Err("Maximalzahl bestätigter Geräte erreicht.".into());
    }
    peers.push(ApprovedPeer {
        fingerprint: fingerprint(key),
        public_key: encoded,
        approved_at: at,
        status: "locally_approved".into(),
    });
    Ok(())
}
fn inventory(peers: Vec<ApprovedPeer>) -> PeerInventory {
    PeerInventory {
        approval_only: true,
        transport_ready: false,
        remote_jobs_enabled: false,
        peers,
    }
}

/// Only called after the signed challenge AND response have passed Stage-1B and
/// the originating one-time offer/challenge was successfully consumed.
/// This pending record is intentionally short-lived. No trust is granted here.
pub(crate) fn stage_after_mutual_proof(
    uid: &str,
    peer: &VerifyingKey,
    sas: &str,
    expires_at: i64,
) -> Result<(), String> {
    let now = Utc::now().timestamp();
    if expires_at <= now || expires_at > now + 300 || sas.len() != 14 {
        return Err("Abgelaufener oder ungültiger Schlüsselnachweis.".into());
    }
    let _guard = state_lock().lock().map_err(|_| "Gerätezustand gesperrt.")?;
    let data = PendingApproval {
        public_key: URL_SAFE_NO_PAD.encode(peer.as_bytes()),
        comparison_code: sas.to_string(),
        expires_at,
    };
    save_raw(
        uid,
        PENDING_ACCOUNT,
        &serde_json::to_string(&data).map_err(|_| "Schlüsselnachweis ungültig.")?,
    )
}
fn confirm_pending(
    pending: &PendingApproval,
    supplied: &str,
    now: i64,
    local_key: &VerifyingKey,
    peers: &mut Vec<ApprovedPeer>,
) -> Result<(), String> {
    if now >= pending.expires_at
        || pending.expires_at > now + 300
        || pending.comparison_code != supplied
        || !valid_sas(supplied)
    {
        return Err("Sicherheitscode ungültig oder abgelaufen.".into());
    }
    let peer = parse_key(&pending.public_key)?;
    if peer == *local_key {
        return Err("Eigenes Gerät darf nicht gekoppelt werden.".into());
    }
    approve_peer(peers, &peer, now)
}
fn valid_sas(value: &str) -> bool {
    let parts: Vec<_> = value.split('-').collect();
    parts.len() == 3
        && parts.iter().all(|p| {
            p.len() == 4
                && p.bytes()
                    .all(|x| x.is_ascii_hexdigit() && !x.is_ascii_lowercase())
        })
}

#[tauri::command]
pub async fn mesh_local_approved_peers() -> Result<PeerInventory, String> {
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    let peers = {
        let _guard = state_lock().lock().map_err(|_| "Gerätezustand gesperrt.")?;
        parse_inventory(read_raw(&uid, TRUST_ACCOUNT)?)?
    };
    same_account_still_verified(&uid).await?;
    Ok(inventory(peers))
}

/// User types the SAS observed on the *other* device and explicitly clicks
/// Confirm. This is a local public-key pin only; peer transport stays disabled.
#[tauri::command]
pub async fn mesh_local_approve_peer(confirmed_code: String) -> Result<PeerInventory, String> {
    if !valid_sas(&confirmed_code) {
        return Err("Sicherheitscode ungültig.".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    let signing = crate::mesh_identity::ensure_identity(&uid)?;
    same_account_still_verified(&uid).await?;
    let peers = {
        let _guard = state_lock().lock().map_err(|_| "Gerätezustand gesperrt.")?;
        let raw = read_raw(&uid, PENDING_ACCOUNT)?
            .ok_or_else(|| "Kein bestätigbarer Schlüsselnachweis vorhanden.".to_string())?;
        let pending: PendingApproval =
            serde_json::from_str(&raw).map_err(|_| "Schlüsselnachweis beschädigt.".to_string())?;
        let mut peers = parse_inventory(read_raw(&uid, TRUST_ACCOUNT)?)?;
        confirm_pending(
            &pending,
            &confirmed_code,
            Utc::now().timestamp(),
            &signing.verifying_key(),
            &mut peers,
        )?;
        // One-time approval, no silent repeated confirmation.
        clear_raw(&uid, PENDING_ACCOUNT)?;
        save_raw(
            &uid,
            TRUST_ACCOUNT,
            &serde_json::to_string(&peers).map_err(|_| "Geräteverwaltung ungültig.")?,
        )?;
        peers
    };
    Ok(inventory(peers))
}

/// Revoke locally pinned public key; never accepts an arbitrary path, hostname or
/// account ID. The remote node will also need independent revocation later.
#[tauri::command]
pub async fn mesh_local_revoke_peer(fingerprint: String) -> Result<PeerInventory, String> {
    if fingerprint.len() != 47
        || !fingerprint
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("Gerätekennung ungültig.".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    same_account_still_verified(&uid).await?;
    let peers = {
        let _guard = state_lock().lock().map_err(|_| "Gerätezustand gesperrt.")?;
        let mut peers = parse_inventory(read_raw(&uid, TRUST_ACCOUNT)?)?;
        let previous = peers.len();
        peers.retain(|peer| peer.fingerprint != fingerprint);
        if peers.len() == previous {
            return Err("Gerätekennung nicht gefunden.".into());
        }
        save_raw(
            &uid,
            TRUST_ACCOUNT,
            &serde_json::to_string(&peers).map_err(|_| "Geräteverwaltung ungültig.")?,
        )?;
        // Revoke also invalidates pending approval to prevent immediate stale reconfirmation.
        clear_raw(&uid, PENDING_ACCOUNT)?;
        peers
    };
    Ok(inventory(peers))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key(seed: u8) -> VerifyingKey {
        ed25519_dalek::SigningKey::from_bytes(&[seed; 32]).verifying_key()
    }
    #[test]
    fn missing_store_empty_and_invalid_malformed_data_fail_closed() {
        assert!(parse_inventory(None).unwrap().is_empty());
        assert!(parse_inventory(Some("garbage".into())).is_err());
        assert!(parse_inventory(Some(format!("[{}]", "x".repeat(5000)))).is_err());
        assert!(!valid_sas("0000-AAAA-FFFF-"));
        assert!(!valid_sas("0000-aaaa-FFFF"));
        assert!(valid_sas("AB12-34CD-EF09"));
    }
    #[test]
    fn approval_requires_matching_code_fresh_proof_and_distinct_peer() {
        let pending = PendingApproval {
            public_key: URL_SAFE_NO_PAD.encode(key(2).as_bytes()),
            comparison_code: "AB12-34CD-EF09".into(),
            expires_at: 1200,
        };
        let mut peers = Vec::new();
        assert!(confirm_pending(&pending, "0000-1111-2222", 1000, &key(1), &mut peers).is_err());
        assert!(confirm_pending(&pending, "AB12-34CD-EF09", 1200, &key(1), &mut peers).is_err());
        assert!(confirm_pending(&pending, "AB12-34CD-EF09", 1000, &key(2), &mut peers).is_err());
        assert!(peers.is_empty());
        confirm_pending(&pending, "AB12-34CD-EF09", 1000, &key(1), &mut peers).unwrap();
        assert_eq!(peers.len(), 1);
        assert_eq!(peers[0].status, "locally_approved");
        assert!(!inventory(peers).transport_ready);
    }
    #[test]
    fn duplicate_public_keys_and_untrusted_metadata_rejected() {
        let mut peers = Vec::new();
        approve_peer(&mut peers, &key(3), 100).unwrap();
        approve_peer(&mut peers, &key(3), 200).unwrap();
        assert_eq!(peers.len(), 1);
        let s = serde_json::to_string(&peers).unwrap();
        assert_eq!(parse_inventory(Some(s)).unwrap().len(), 1);
        peers[0].fingerprint = "WRONG".into();
        assert!(parse_inventory(Some(serde_json::to_string(&peers).unwrap())).is_err());
    }
    #[test]
    fn native_admission_requires_exact_preapproved_nonself_pin() {
        let own = key(11);
        let friend = key(12);
        let stranger = key(13);
        let mut pins = Vec::new();
        approve_peer(&mut pins, &friend, 100).unwrap();
        let expected = fingerprint(&friend);
        assert_eq!(
            select_approved_peer(&pins, &expected, &own, 200)
                .unwrap()
                .public_key,
            URL_SAFE_NO_PAD.encode(friend.as_bytes())
        );
        assert!(select_approved_peer(&pins, &fingerprint(&stranger), &own, 200).is_err());
        assert!(select_approved_peer(&[], &expected, &own, 200).is_err());
        assert!(select_approved_peer(&pins, &expected.to_lowercase(), &own, 200).is_err());
        assert!(select_approved_peer(&pins, &expected.replace('-', ""), &own, 200).is_err());

        let mut self_pins = Vec::new();
        approve_peer(&mut self_pins, &own, 100).unwrap();
        assert!(select_approved_peer(&self_pins, &fingerprint(&own), &own, 200).is_err());
        let mut future = pins.clone();
        future[0].approved_at = 9999;
        assert!(select_approved_peer(&future, &expected, &own, 200).is_err());
        let mut tampered = pins.clone();
        tampered[0].fingerprint = fingerprint(&stranger);
        assert!(select_approved_peer(&tampered, &tampered[0].fingerprint, &own, 200).is_err());
        let mut revoked = pins.clone();
        revoked.clear();
        assert!(select_approved_peer(&revoked, &expected, &own, 200).is_err());
        let duplicated = vec![pins[0].clone(), pins[0].clone()];
        assert!(select_approved_peer(&duplicated, &expected, &own, 200).is_err());
    }

    #[test]
    fn revoke_in_memory_keeps_transport_and_remote_jobs_disabled() {
        let mut peers = Vec::new();
        approve_peer(&mut peers, &key(1), 100).unwrap();
        let fp = fingerprint(&key(1));
        peers.retain(|p| p.fingerprint != fp);
        let result = inventory(peers);
        assert!(result.peers.is_empty());
        assert!(result.approval_only);
        assert!(!result.remote_jobs_enabled);
    }
}
