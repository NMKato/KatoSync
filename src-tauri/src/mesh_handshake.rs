// Created by NMKato Solutions
//! Offline, manually exchanged two-way possession proof. Explicitly NO peer trust.
//! Peer authorization, transport, dispatch and write privileges remain disabled.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::Utc;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use crate::mesh_identity::{
    ensure_identity, fingerprint, same_account_still_verified, verify_offer, MeshOffer,
    OFFER_LIFETIME_SECS,
};

const CHALLENGE_PROTOCOL: &str = "katosync-mesh-challenge-v1";
const RESPONSE_PROTOCOL: &str = "katosync-mesh-response-v1";
const STATE_OFFER: &str = "mesh-outbound-offer-v1";
const STATE_CHALLENGE: &str = "mesh-pending-challenge-v1";
const MAX_MESSAGE_BYTES: usize = 8192;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingChallenge {
    protocol: String,
    offer: MeshOffer,
    responder_public_key: String,
    responder_nonce: String,
    expires_at: i64,
    signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairingResponse {
    protocol: String,
    challenge: PairingChallenge,
    signature: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingProof {
    fingerprint: String,
    comparison_code: String,
    /// Always false until independent user approval plus authenticated transport.
    paired: bool,
    peer_count: u8,
    transport_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    digest: String,
    expires_at: i64,
}

fn pending_entry(uid: &str, kind: &str) -> Result<Entry, String> {
    let id = uuid::Uuid::parse_str(uid).map_err(|_| "Benutzerkonto nicht verifiziert.")?;
    Entry::new(crate::KEYCHAIN_SERVICE, &format!("{kind}:{id}"))
        .map_err(|_| "Schlüsselbund nicht verfügbar.".to_string())
}
fn digest(value: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(value))
}
fn pending_read(uid: &str, kind: &str) -> Result<Option<Pending>, String> {
    let entry = pending_entry(uid, kind)?;
    let raw = match entry.get_password() {
        Ok(x) => x,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err("Pairing-Status im Schlüsselbund nicht lesbar.".into()),
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|_| "Pairing-Status im Schlüsselbund beschädigt.".into())
}
fn pending_save(uid: &str, kind: &str, data: &Pending) -> Result<(), String> {
    let entry = pending_entry(uid, kind)?;
    let mut json = serde_json::to_string(data).map_err(|_| "Ungültiger Pairing-Status.")?;
    let outcome = entry
        .set_password(&json)
        .map_err(|_| "Pairing-Status konnte nicht sicher gespeichert werden.".to_string());
    json.zeroize();
    outcome
}
fn pending_consume(uid: &str, kind: &str, expected: &str, now: i64) -> Result<(), String> {
    let prior = pending_read(uid, kind)?
        .ok_or_else(|| "Keine offene Einladung für dieses Gerät.".to_string())?;
    if prior.expires_at <= now || prior.digest != expected {
        return Err("Pairing-Einladung stimmt nicht überein oder ist abgelaufen.".into());
    }
    pending_entry(uid, kind)?
        .delete_credential()
        .map_err(|_| "Einmalige Pairing-Einladung konnte nicht verbraucht werden.".to_string())
}
fn pending_verify(uid: &str, kind: &str, expected: &str, now: i64) -> Result<(), String> {
    let prior = pending_read(uid, kind)?
        .ok_or_else(|| "Keine offene Pairing-Prüfung vorhanden.".to_string())?;
    if prior.expires_at <= now || prior.digest != expected {
        return Err("Pairing-Prüfung abgelaufen oder bereits ersetzt.".into());
    }
    Ok(())
}
pub(crate) fn store_outbound_offer(uid: &str, offer: &MeshOffer) -> Result<(), String> {
    pending_save(
        uid,
        STATE_OFFER,
        &Pending {
            digest: digest(&serde_json::to_vec(offer).map_err(|_| "Ungültige Einladung.")?),
            expires_at: offer.expires_at,
        },
    )
}
fn fresh_nonce() -> String {
    let mut random = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut random);
    let encoded = URL_SAFE_NO_PAD.encode(random);
    random.zeroize();
    encoded
}
fn get_key(encoded: &str) -> Result<VerifyingKey, String> {
    let decoded = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "Ungültiger öffentlicher Schlüssel.")?;
    let raw: [u8; 32] = decoded
        .try_into()
        .map_err(|_| "Ungültiger öffentlicher Schlüssel.")?;
    VerifyingKey::from_bytes(&raw).map_err(|_| "Ungültiger öffentlicher Schlüssel.".into())
}
fn challenge_payload(challenge: &PairingChallenge) -> Vec<u8> {
    // Fixed typed fields with version/domain separation; never sign arbitrary JS/JSON.
    format!(
        "{}|{}|{}|{}|{}|{}",
        challenge.protocol,
        digest(&serde_json::to_vec(&challenge.offer).unwrap_or_default()),
        challenge.offer.account_scope,
        challenge.responder_public_key,
        challenge.responder_nonce,
        challenge.expires_at
    )
    .into_bytes()
}
fn response_payload(challenge: &PairingChallenge) -> Vec<u8> {
    format!(
        "{RESPONSE_PROTOCOL}|{}",
        digest(&serde_json::to_vec(challenge).unwrap_or_default())
    )
    .into_bytes()
}
fn safety_code(challenge: &PairingChallenge) -> String {
    let mut sha = Sha256::new();
    sha.update(b"katosync-mesh-human-sas-v1:");
    sha.update(response_payload(challenge));
    let bytes = sha.finalize();
    format!(
        "{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]
    )
}
fn generate_challenge(offer: MeshOffer, responder: &SigningKey, now: i64) -> PairingChallenge {
    let mut value = PairingChallenge {
        protocol: CHALLENGE_PROTOCOL.to_string(),
        responder_public_key: URL_SAFE_NO_PAD.encode(responder.verifying_key().as_bytes()),
        responder_nonce: fresh_nonce(),
        expires_at: offer.expires_at.min(now + OFFER_LIFETIME_SECS),
        offer,
        signature: String::new(),
    };
    value.signature = URL_SAFE_NO_PAD.encode(responder.sign(&challenge_payload(&value)).to_bytes());
    value
}
fn verify_challenge(
    challenge: &PairingChallenge,
    uid: &str,
    now: i64,
) -> Result<(VerifyingKey, VerifyingKey), String> {
    if challenge.protocol != CHALLENGE_PROTOCOL {
        return Err("Unbekanntes Pairing-Protokoll.".into());
    }
    let initiator = verify_offer(&challenge.offer, uid, now)
        .map_err(|_| "Einladung abgelaufen oder ungültig.".to_string())?;
    if challenge.expires_at <= now
        || challenge.expires_at > challenge.offer.expires_at
        || challenge.expires_at > now + OFFER_LIFETIME_SECS + 10
    {
        return Err("Challenge abgelaufen oder unplausibel.".into());
    }
    let nonce = URL_SAFE_NO_PAD
        .decode(&challenge.responder_nonce)
        .map_err(|_| "Challenge-Nonce ungültig.")?;
    if nonce.len() != 32 {
        return Err("Challenge-Nonce ungültig.".into());
    }
    let responder = get_key(&challenge.responder_public_key)?;
    if initiator == responder {
        return Err("Ein Gerät kann sich nicht selbst koppeln.".into());
    }
    let raw = URL_SAFE_NO_PAD
        .decode(&challenge.signature)
        .map_err(|_| "Challenge-Signatur ungültig.")?;
    let signature = Signature::from_slice(&raw).map_err(|_| "Challenge-Signatur ungültig.")?;
    responder
        .verify(&challenge_payload(challenge), &signature)
        .map_err(|_| "Challenge-Signatur ungültig.")?;
    Ok((initiator, responder))
}
fn generate_response(challenge: PairingChallenge, initiator: &SigningKey) -> PairingResponse {
    PairingResponse {
        signature: URL_SAFE_NO_PAD.encode(initiator.sign(&response_payload(&challenge)).to_bytes()),
        protocol: RESPONSE_PROTOCOL.to_string(),
        challenge,
    }
}
fn verify_response(
    response: &PairingResponse,
    uid: &str,
    now: i64,
) -> Result<VerifyingKey, String> {
    if response.protocol != RESPONSE_PROTOCOL {
        return Err("Unbekanntes Pairing-Protokoll.".into());
    }
    let (initiator, responder) = verify_challenge(&response.challenge, uid, now)?;
    let raw = URL_SAFE_NO_PAD
        .decode(&response.signature)
        .map_err(|_| "Antwortsignatur ungültig.")?;
    let signature = Signature::from_slice(&raw).map_err(|_| "Antwortsignatur ungültig.")?;
    initiator
        .verify(&response_payload(&response.challenge), &signature)
        .map_err(|_| "Antwortsignatur ungültig.")?;
    Ok(responder)
}
fn proof(peer: VerifyingKey, challenge: &PairingChallenge) -> PairingProof {
    PairingProof {
        fingerprint: fingerprint(&peer),
        comparison_code: safety_code(challenge),
        paired: false,
        peer_count: 0,
        transport_ready: false,
    }
}

/// On B: pasting A's invite creates and securely records a one-time signed reply.
#[tauri::command]
pub async fn mesh_pairing_challenge_create(offer_json: String) -> Result<String, String> {
    if offer_json.len() > MAX_MESSAGE_BYTES {
        return Err("Einladung zu lang.".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    let offer: MeshOffer = serde_json::from_str(&offer_json).map_err(|_| "Einladung ungültig.")?;
    let initiator = verify_offer(&offer, &uid, Utc::now().timestamp())
        .map_err(|_| "Einladung abgelaufen oder ungültig.".to_string())?;
    let signing = ensure_identity(&uid)?;
    if signing.verifying_key() == initiator {
        return Err("Ein Gerät kann nicht seine eigene Einladung beantworten.".into());
    }
    let challenge = generate_challenge(offer, &signing, Utc::now().timestamp());
    same_account_still_verified(&uid).await?;
    pending_save(
        &uid,
        STATE_CHALLENGE,
        &Pending {
            digest: digest(&serde_json::to_vec(&challenge).map_err(|_| "Ungültige Challenge.")?),
            expires_at: challenge.expires_at,
        },
    )?;
    serde_json::to_string(&challenge).map_err(|_| "Challenge konnte nicht erzeugt werden.".into())
}

/// On A: B's signed challenge is valid only for A's locally issued, unused offer.
#[tauri::command]
pub async fn mesh_pairing_response_create(
    challenge_json: String,
) -> Result<(String, PairingProof), String> {
    if challenge_json.len() > MAX_MESSAGE_BYTES {
        return Err("Challenge zu lang.".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    let challenge: PairingChallenge =
        serde_json::from_str(&challenge_json).map_err(|_| "Challenge ungültig.")?;
    let (initiator, responder) = verify_challenge(&challenge, &uid, Utc::now().timestamp())?;
    let signing = ensure_identity(&uid)?;
    if initiator != signing.verifying_key() {
        return Err("Einladung gehört nicht zu diesem lokalen Gerät.".into());
    }
    let issued_digest =
        digest(&serde_json::to_vec(&challenge.offer).map_err(|_| "Einladung ungültig.")?);
    pending_verify(&uid, STATE_OFFER, &issued_digest, Utc::now().timestamp())?;
    let response = generate_response(challenge.clone(), &signing);
    let public_response = serde_json::to_string(&response).map_err(|_| "Antwort ungültig.")?;
    same_account_still_verified(&uid).await?;
    pending_consume(&uid, STATE_OFFER, &issued_digest, Utc::now().timestamp())?;
    Ok((public_response, proof(responder, &challenge)))
}

/// On B: verifies A's fresh possession proof against B's OWN pending challenge.
/// Consumes the challenge, so a replay fails even before any transport exists.
#[tauri::command]
pub async fn mesh_pairing_response_verify(response_json: String) -> Result<PairingProof, String> {
    if response_json.len() > MAX_MESSAGE_BYTES {
        return Err("Antwort zu lang.".into());
    }
    let uid = crate::github_app_auth::verified_katosync_user().await?;
    let response: PairingResponse =
        serde_json::from_str(&response_json).map_err(|_| "Antwort ungültig.")?;
    let responder = verify_response(&response, &uid, Utc::now().timestamp())?;
    let signing = ensure_identity(&uid)?;
    if responder != signing.verifying_key() {
        return Err("Challenge stammt nicht von diesem lokalen Gerät.".into());
    }
    let challenge_digest =
        digest(&serde_json::to_vec(&response.challenge).map_err(|_| "Challenge ungültig.")?);
    pending_verify(
        &uid,
        STATE_CHALLENGE,
        &challenge_digest,
        Utc::now().timestamp(),
    )?;
    let initiator = get_key(&response.challenge.offer.public_key)?;
    same_account_still_verified(&uid).await?;
    pending_consume(
        &uid,
        STATE_CHALLENGE,
        &challenge_digest,
        Utc::now().timestamp(),
    )?;
    Ok(proof(initiator, &response.challenge))
}

#[cfg(test)]
mod tests {
    use super::*;
    const USER: &str = "819d749b-f932-44b9-90b7-8b27684e5efe";
    const OTHER: &str = "9a1ee918-6af6-4109-a50f-31c01abf789c";
    fn signing(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }
    fn invitation(initiator: &SigningKey, now: i64) -> MeshOffer {
        // Reuse the exact signed fixture from the previous stage.
        super::super::mesh_identity::make_test_offer(initiator, USER, now)
    }
    #[test]
    fn mutual_keys_both_prove_possession_and_sas_matches() {
        let a = signing(1);
        let b = signing(2);
        let c = generate_challenge(invitation(&a, 1_800_000_000), &b, 1_800_000_001);
        let (verified_a, verified_b) = verify_challenge(&c, USER, 1_800_000_002).unwrap();
        assert_eq!(verified_a, a.verifying_key());
        assert_eq!(verified_b, b.verifying_key());
        let response = generate_response(c.clone(), &a);
        assert_eq!(
            verify_response(&response, USER, 1_800_000_003).unwrap(),
            b.verifying_key()
        );
        let proof_a = proof(b.verifying_key(), &c);
        let proof_b = proof(a.verifying_key(), &c);
        assert_eq!(proof_a.comparison_code, proof_b.comparison_code);
        assert!(!proof_a.paired);
        assert_eq!(proof_b.peer_count, 0);
        assert!(!proof_b.transport_ready);
    }
    #[test]
    fn tampered_challenge_and_answer_fail_closed() {
        let a = signing(3);
        let b = signing(4);
        let c = generate_challenge(invitation(&a, 1_800_000_000), &b, 1_800_000_001);
        let mut tampered = c.clone();
        tampered.responder_nonce = URL_SAFE_NO_PAD.encode([3u8; 32]);
        assert!(verify_challenge(&tampered, USER, 1_800_000_002).is_err());
        let mut response = generate_response(c, &a);
        response.signature = URL_SAFE_NO_PAD.encode([0u8; 64]);
        assert!(verify_response(&response, USER, 1_800_000_002).is_err());
    }
    #[test]
    fn wrong_owner_self_pairing_and_expired_challenge_rejected() {
        let a = signing(7);
        let b = signing(8);
        let invite = invitation(&a, 1_800_000_000);
        let c = generate_challenge(invite.clone(), &b, 1_800_000_001);
        assert!(verify_challenge(&c, OTHER, 1_800_000_002).is_err());
        assert!(verify_challenge(&c, USER, 1_800_000_301).is_err());
        let self_challenge = generate_challenge(invite, &a, 1_800_000_001);
        assert!(verify_challenge(&self_challenge, USER, 1_800_000_002).is_err());
    }
}
