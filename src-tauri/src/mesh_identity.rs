// Created by NMKato Solutions
//! Explicit, owner-scoped identity and signed invite: no listener or implicit pairing.
//! Credentials remain exclusively in the OS keychain. No secret appears in IPC or logs.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

pub(crate) const OFFER_LIFETIME_SECS: i64 = 300;
const CLOCK_SKEW_SECS: i64 = 10;
const ACCOUNT_PREFIX: &str = "mesh-ed25519-v1:";
const PROTOCOL: &str = "katosync-mesh-pairing-v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshIdentityStatus {
    pub fingerprint: String,
    pub algorithm: &'static str,
    pub paired: bool,
    pub peer_count: u8,
    pub transport_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MeshOffer {
    pub protocol: String,
    pub public_key: String,
    pub nonce: String,
    pub expires_at: i64,
    pub account_scope: String,
    pub signature: String,
}

pub(crate) fn scope(uid: &str) -> String {
    let mut h = Sha256::new();
    h.update(b"katosync-mesh-v1-account-scope:");
    h.update(crate::KATOSYNC_AUTH_URL.as_bytes());
    h.update(b":");
    h.update(uid.as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

fn key_entry(uid: &str) -> Result<Entry, String> {
    let uid = uuid::Uuid::parse_str(uid)
        .map_err(|_| "Ungültige überprüfte Benutzeridentität.".to_string())?;
    Entry::new(crate::KEYCHAIN_SERVICE, &format!("{ACCOUNT_PREFIX}{uid}"))
        .map_err(|_| "Betriebssystem-Schlüsselbund nicht verfügbar.".to_string())
}

fn open_identity(uid: &str) -> Result<Option<SigningKey>, String> {
    let entry = key_entry(uid)?;
    let mut encoded = match entry.get_password() {
        Ok(v) => v,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err("Geräteschlüssel im Schlüsselbund nicht lesbar.".into()),
    };
    let decoded = URL_SAFE_NO_PAD
        .decode(&encoded)
        .map_err(|_| "Gespeicherte Geräteidentität ungültig.".to_string());
    encoded.zeroize();
    let mut bytes = decoded?;
    if bytes.len() != 32 {
        bytes.zeroize();
        return Err("Gespeicherte Geräteidentität ungültig.".into());
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&bytes);
    bytes.zeroize();
    let signing = SigningKey::from_bytes(&seed);
    seed.zeroize();
    Ok(Some(signing))
}

pub(crate) fn ensure_identity(uid: &str) -> Result<SigningKey, String> {
    if let Some(x) = open_identity(uid)? {
        return Ok(x);
    }
    let mut seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    let mut encoded = URL_SAFE_NO_PAD.encode(seed);
    let signing = SigningKey::from_bytes(&seed);
    seed.zeroize();
    let entry = key_entry(uid)?;
    let stored = entry.set_password(&encoded);
    encoded.zeroize();
    stored.map_err(|_| "Geräteidentität konnte nicht sicher gespeichert werden.".to_string())?;
    // Confirm that the keychain actually persisted the expected identity.
    let restored = open_identity(uid)?
        .ok_or_else(|| "Geräteidentität wurde nicht gespeichert.".to_string())?;
    if restored.verifying_key() != signing.verifying_key() {
        return Err("Geräteschlüssel stimmt nach Speicherung nicht überein.".into());
    }
    Ok(restored)
}

pub(crate) fn fingerprint(key: &VerifyingKey) -> String {
    let h = Sha256::digest(key.as_bytes());
    h[..16]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join("-")
}

fn offer_message(offer: &MeshOffer) -> Vec<u8> {
    format!(
        "{}|{}|{}|{}|{}",
        offer.protocol, offer.account_scope, offer.public_key, offer.nonce, offer.expires_at
    )
    .into_bytes()
}
#[cfg(test)]
pub(crate) fn make_test_offer(signing: &SigningKey, uid: &str, now: i64) -> MeshOffer {
    generate_offer(signing, uid, now)
}
fn generate_offer(signing: &SigningKey, uid: &str, now: i64) -> MeshOffer {
    let mut random = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let mut offer = MeshOffer {
        protocol: PROTOCOL.to_string(),
        public_key: URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes()),
        nonce: URL_SAFE_NO_PAD.encode(random),
        expires_at: now + OFFER_LIFETIME_SECS,
        account_scope: scope(uid),
        signature: String::new(),
    };
    random.zeroize();
    offer.signature = URL_SAFE_NO_PAD.encode(signing.sign(&offer_message(&offer)).to_bytes());
    offer
}

fn decode_key(value: &str) -> Result<VerifyingKey, &'static str> {
    let raw = URL_SAFE_NO_PAD.decode(value).map_err(|_| "bad_key")?;
    let arr: [u8; 32] = raw.try_into().map_err(|_| "bad_key")?;
    VerifyingKey::from_bytes(&arr).map_err(|_| "bad_key")
}
pub(crate) fn verify_offer(
    offer: &MeshOffer,
    uid: &str,
    now: i64,
) -> Result<VerifyingKey, &'static str> {
    if offer.protocol != PROTOCOL || offer.account_scope != scope(uid) {
        return Err("wrong_scope");
    }
    if offer.expires_at <= now || offer.expires_at > now + OFFER_LIFETIME_SECS + CLOCK_SKEW_SECS {
        return Err("expired");
    }
    let nonce = URL_SAFE_NO_PAD
        .decode(&offer.nonce)
        .map_err(|_| "bad_nonce")?;
    if nonce.len() != 32 {
        return Err("bad_nonce");
    }
    let key = decode_key(&offer.public_key)?;
    let raw = URL_SAFE_NO_PAD
        .decode(&offer.signature)
        .map_err(|_| "bad_signature")?;
    let signature = Signature::from_slice(&raw).map_err(|_| "bad_signature")?;
    key.verify(&offer_message(offer), &signature)
        .map_err(|_| "bad_signature")?;
    Ok(key)
}

pub(crate) async fn same_account_still_verified(uid: &str) -> Result<(), String> {
    let current = crate::github_app_auth::verified_katosync_user().await?;
    if current != uid {
        return Err("KatoSync-Konto während der Geräteprüfung gewechselt.".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn mesh_device_identity_prepare() -> Result<MeshIdentityStatus, String> {
    let uid = crate::github_app_auth::verified_katosync_user()
        .await
        .map_err(|_| "MESH_IDENTITY_ACCOUNT_UNVERIFIED".to_string())?;
    // Diagnostic only: stable categories, no account IDs, keychain attributes,
    // seed values or inner OS error messages cross Tauri IPC.
    let identity = ensure_identity(&uid).map_err(|error| {
        match error.as_str() {
            "Betriebssystem-Schlüsselbund nicht verfügbar." => "MESH_IDENTITY_STORE_INIT",
            "Geräteschlüssel im Schlüsselbund nicht lesbar." => "MESH_IDENTITY_STORE_READ",
            "Geräteidentität konnte nicht sicher gespeichert werden." => {
                "MESH_IDENTITY_STORE_WRITE"
            }
            "Geräteidentität wurde nicht gespeichert." => "MESH_IDENTITY_STORE_READBACK",
            "Geräteschlüssel stimmt nach Speicherung nicht überein." => {
                "MESH_IDENTITY_STORE_MISMATCH"
            }
            "Gespeicherte Geräteidentität ungültig." => "MESH_IDENTITY_STORE_CORRUPT",
            _ => "MESH_IDENTITY_UNKNOWN",
        }
        .to_string()
    })?;
    same_account_still_verified(&uid)
        .await
        .map_err(|_| "MESH_IDENTITY_ACCOUNT_CHANGED".to_string())?;
    Ok(MeshIdentityStatus {
        fingerprint: fingerprint(&identity.verifying_key()),
        algorithm: "Ed25519 · SHA-256",
        paired: false,
        peer_count: 0,
        transport_ready: false,
    })
}

#[tauri::command]
pub async fn mesh_pairing_offer_create() -> Result<MeshOffer, String> {
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    // User presses a button to produce an invitation, not auto-on-start.
    let identity = ensure_identity(&uid)?;
    same_account_still_verified(&uid).await?;
    let offer = generate_offer(&identity, &uid, Utc::now().timestamp());
    crate::mesh_handshake::store_outbound_offer(&uid, &offer)?;
    Ok(offer)
}

#[tauri::command]
pub async fn mesh_pairing_offer_inspect(offer_json: String) -> Result<MeshIdentityStatus, String> {
    if offer_json.len() > 2048 {
        return Err("Pairing-Einladung zu lang.".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    let offer: MeshOffer =
        serde_json::from_str(&offer_json).map_err(|_| "Pairing-Einladung ungültig.".to_string())?;
    let peer = verify_offer(&offer, &uid, Utc::now().timestamp())
        .map_err(|_| "Pairing-Einladung ungültig, abgelaufen oder fremdes Konto.".to_string())?;
    same_account_still_verified(&uid).await?;
    Ok(MeshIdentityStatus {
        fingerprint: fingerprint(&peer),
        algorithm: "Ed25519 · SHA-256",
        paired: false,
        peer_count: 0,
        transport_ready: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const OWNER: &str = "819d749b-f932-44b9-90b7-8b27684e5efe";
    const OTHER: &str = "9a1ee918-6af6-4109-a50f-31c01abf789c";
    fn signing(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }
    #[test]
    fn signed_invitation_verifies_but_never_authorizes_remote_use() {
        let key = signing(7);
        let offer = generate_offer(&key, OWNER, 1_800_000_000);
        let verified = verify_offer(&offer, OWNER, 1_800_000_005).unwrap();
        assert_eq!(verified, key.verifying_key());
        assert_ne!(
            fingerprint(&verified),
            fingerprint(&signing(9).verifying_key())
        );
    }
    #[test]
    fn expired_and_far_future_invites_fail_closed() {
        let offer = generate_offer(&signing(8), OWNER, 1_800_000_000);
        assert_eq!(verify_offer(&offer, OWNER, 1_800_000_301), Err("expired"));
        assert_eq!(
            verify_offer(&offer, OWNER, 1_800_000_000 - 30),
            Err("expired")
        );
    }
    #[test]
    fn wrong_account_and_tampered_signature_rejected() {
        let offer = generate_offer(&signing(1), OWNER, 1_800_000_000);
        assert_eq!(
            verify_offer(&offer, OTHER, 1_800_000_004),
            Err("wrong_scope")
        );
        let mut broken = offer.clone();
        broken.nonce = URL_SAFE_NO_PAD.encode([5u8; 32]);
        assert_eq!(
            verify_offer(&broken, OWNER, 1_800_000_004),
            Err("bad_signature")
        );
        broken = offer.clone();
        broken.public_key = URL_SAFE_NO_PAD.encode(signing(4).verifying_key().as_bytes());
        assert_eq!(
            verify_offer(&broken, OWNER, 1_800_000_004),
            Err("bad_signature")
        );
    }
    #[test]
    fn malformed_material_and_reused_prefix_are_not_trusted() {
        let mut offer = generate_offer(&signing(1), OWNER, 1_800_000_000);
        offer.protocol = "unknown-protocol".into();
        assert_eq!(
            verify_offer(&offer, OWNER, 1_800_000_004),
            Err("wrong_scope")
        );
        offer.protocol = PROTOCOL.into();
        offer.nonce = "!".into();
        assert_eq!(verify_offer(&offer, OWNER, 1_800_000_004), Err("bad_nonce"));
    }
}
