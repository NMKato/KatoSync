// Created by NMKato Solutions
//! Gespeicherte Verbindungsabsicht. Dieser Datensatz erteilt keine Aktionsrechte.
use serde::{Deserialize, Serialize};

pub(super) const MAX_PEERS: usize = 9;
const MAX_BYTES: usize = 16_384;
const ACCOUNT: &str = "mesh-account-connection-intent-v1";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionMode {
    Ask,
    Automatic,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PeerIntent {
    pub peer_device_id: String,
    pub peer_fingerprint: String,
    pub peer_public_key: String,
    pub mode: ConnectionMode,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ConnectionIntent {
    pub version: u8,
    pub owner_id: String,
    // Eine neue Anmeldung nach Logout hat eine andere serververifizierte Session.
    pub session_id: String,
    pub local_device_id: String,
    pub local_fingerprint: String,
    pub local_public_key: String,
    pub main_device_id: String,
    pub main_fingerprint: String,
    pub main_public_key: String,
    pub account_revision: u64,
    pub peers: Vec<PeerIntent>,
}

fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}
fn fingerprint(value: &str) -> bool {
    value.len() == 47
        && value.bytes().enumerate().all(|(index, byte)| {
            if index % 3 == 2 {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit() && !byte.is_ascii_lowercase()
            }
        })
}
fn key(value: &str) -> bool {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(value) else {
        return false;
    };
    let Ok(raw) = <[u8; 32]>::try_from(bytes.as_slice()) else {
        return false;
    };
    URL_SAFE_NO_PAD.encode(&bytes) == value
        && ed25519_dalek::VerifyingKey::from_bytes(&raw).is_ok_and(|key| !key.is_weak())
}
fn exact_key(public_key: &str, fp: &str) -> bool {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use sha2::{Digest, Sha256};
    if !key(public_key) || !fingerprint(fp) {
        return false;
    }
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(public_key) else {
        return false;
    };
    let digest = Sha256::digest(bytes);
    let actual = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join("-");
    actual == fp
}

impl ConnectionIntent {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || !uuid(&self.owner_id)
            || !uuid(&self.session_id)
            || !uuid(&self.local_device_id)
            || !uuid(&self.main_device_id)
            || self.account_revision == 0
            || self.account_revision > 9_007_199_254_740_991
            || !exact_key(&self.local_public_key, &self.local_fingerprint)
            || !exact_key(&self.main_public_key, &self.main_fingerprint)
            || (self.local_device_id == self.main_device_id
                && (self.local_public_key != self.main_public_key
                    || self.local_fingerprint != self.main_fingerprint))
            || self.peers.len() > MAX_PEERS
        {
            return Err("MESH_ACCOUNT_PROFILE_INVALID".into());
        }
        let mut ids = std::collections::HashSet::new();
        let mut keys = std::collections::HashSet::new();
        for peer in &self.peers {
            if !uuid(&peer.peer_device_id)
                || peer.peer_device_id == self.local_device_id
                || peer.peer_public_key == self.local_public_key
                || !exact_key(&peer.peer_public_key, &peer.peer_fingerprint)
                || !ids.insert(&peer.peer_device_id)
                || !keys.insert(&peer.peer_public_key)
                || (peer.peer_device_id == self.main_device_id
                    && (peer.peer_public_key != self.main_public_key
                        || peer.peer_fingerprint != self.main_fingerprint))
                || (self.local_device_id != self.main_device_id
                    && peer.peer_device_id != self.main_device_id)
            {
                return Err("MESH_ACCOUNT_PROFILE_INVALID".into());
            }
        }
        Ok(())
    }
    pub(super) fn same_binding(&self, other: &Self) -> bool {
        self.owner_id == other.owner_id
            && self.session_id == other.session_id
            && self.local_device_id == other.local_device_id
            && self.local_public_key == other.local_public_key
            && self.local_fingerprint == other.local_fingerprint
            && self.main_device_id == other.main_device_id
            && self.main_public_key == other.main_public_key
            && self.main_fingerprint == other.main_fingerprint
            && self.account_revision == other.account_revision
    }
    pub(super) fn automatic_peers(&self) -> impl Iterator<Item = &PeerIntent> {
        self.peers
            .iter()
            .filter(|peer| peer.enabled && peer.mode == ConnectionMode::Automatic)
    }
    pub(super) fn disable(&mut self, peer_device_id: &str) {
        if let Some(peer) = self
            .peers
            .iter_mut()
            .find(|peer| peer.peer_device_id == peer_device_id)
        {
            peer.enabled = false;
        }
    }
}

pub(super) fn decode(raw: &str) -> Result<ConnectionIntent, String> {
    if raw.len() > MAX_BYTES {
        return Err("MESH_ACCOUNT_PROFILE_INVALID".into());
    }
    let profile: ConnectionIntent =
        serde_json::from_str(raw).map_err(|_| "MESH_ACCOUNT_PROFILE_INVALID")?;
    profile.validate()?;
    Ok(profile)
}

fn entry() -> Result<keyring::Entry, String> {
    if !cfg!(all(target_os = "macos", feature = "stage4j-qa")) {
        return Err("MESH_ACCOUNT_PROFILE_NOT_CONFIGURED".into());
    }
    keyring::Entry::new(crate::KEYCHAIN_SERVICE, ACCOUNT)
        .map_err(|_| "MESH_ACCOUNT_PROFILE_UNAVAILABLE".into())
}
pub(super) fn load() -> Result<Option<ConnectionIntent>, String> {
    match entry()?.get_password() {
        Ok(raw) => decode(&raw).map(Some),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("MESH_ACCOUNT_PROFILE_UNAVAILABLE".into()),
    }
}
pub(super) fn save(profile: &ConnectionIntent) -> Result<(), String> {
    profile.validate()?;
    let raw = serde_json::to_string(profile).map_err(|_| "MESH_ACCOUNT_PROFILE_INVALID")?;
    if raw.len() > MAX_BYTES {
        return Err("MESH_ACCOUNT_PROFILE_INVALID".into());
    }
    entry()?
        .set_password(&raw)
        .map_err(|_| "MESH_ACCOUNT_PROFILE_UNAVAILABLE")?;
    if load()?.as_ref() != Some(profile) {
        return Err("MESH_ACCOUNT_PROFILE_READBACK_FAILED".into());
    }
    Ok(())
}
pub(super) fn clear() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("MESH_ACCOUNT_PROFILE_UNAVAILABLE".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use sha2::{Digest, Sha256};
    fn material(byte: u8) -> (String, String) {
        let key = ed25519_dalek::SigningKey::from_bytes(&[byte; 32])
            .verifying_key()
            .to_bytes();
        let digest = Sha256::digest(key);
        (
            URL_SAFE_NO_PAD.encode(key),
            digest[..16]
                .iter()
                .map(|b| format!("{b:02X}"))
                .collect::<Vec<_>>()
                .join("-"),
        )
    }
    fn intent() -> ConnectionIntent {
        let (local_key, local_fp) = material(19);
        let (peer_key, peer_fp) = material(23);
        ConnectionIntent {
            version: 1,
            owner_id: "11111111-1111-4111-8111-111111111111".into(),
            session_id: "22222222-2222-4222-8222-222222222222".into(),
            local_device_id: "33333333-3333-4333-8333-333333333333".into(),
            local_fingerprint: local_fp.clone(),
            local_public_key: local_key.clone(),
            main_device_id: "33333333-3333-4333-8333-333333333333".into(),
            main_fingerprint: local_fp,
            main_public_key: local_key,
            account_revision: 2,
            peers: vec![PeerIntent {
                peer_device_id: "44444444-4444-4444-8444-444444444444".into(),
                peer_fingerprint: peer_fp,
                peer_public_key: peer_key,
                mode: ConnectionMode::Automatic,
                enabled: true,
            }],
        }
    }
    #[test]
    fn stored_intent_roundtrip_binds_real_key_material_and_no_authority_fields() {
        let value = intent();
        value.validate().unwrap();
        let raw = serde_json::to_string(&value).unwrap();
        assert_eq!(decode(&raw).unwrap(), value);
        let mut tampered: serde_json::Value = serde_json::from_str(&raw).unwrap();
        tampered["remoteJobsEnabled"] = true.into();
        assert!(decode(&tampered.to_string()).is_err());
        tampered
            .as_object_mut()
            .unwrap()
            .remove("remoteJobsEnabled");
        tampered["peers"][0]["peerFingerprint"] = value.local_fingerprint.into();
        assert!(decode(&tampered.to_string()).is_err());
    }
    #[test]
    fn explicit_stop_and_ask_mode_never_resume() {
        let mut value = intent();
        assert_eq!(value.automatic_peers().count(), 1);
        value.peers[0].mode = ConnectionMode::Ask;
        assert_eq!(value.automatic_peers().count(), 0);
        value.peers[0].mode = ConnectionMode::Automatic;
        let id = value.peers[0].peer_device_id.clone();
        value.disable(&id);
        let restored = decode(&serde_json::to_string(&value).unwrap()).unwrap();
        assert_eq!(restored.automatic_peers().count(), 0);
        assert_eq!(restored.peers[0].mode, ConnectionMode::Automatic);
    }
    #[test]
    fn logout_new_session_main_key_owner_and_revision_changes_are_not_resume_bindings() {
        let original = intent();
        for field in [
            "ownerId",
            "sessionId",
            "mainDeviceId",
            "localDeviceId",
            "accountRevision",
            "mainPublicKey",
        ] {
            let mut value = serde_json::to_value(&original).unwrap();
            value[field] = if field == "accountRevision" {
                3.into()
            } else {
                "changed".into()
            };
            let changed: ConnectionIntent = serde_json::from_value(value).unwrap();
            assert!(!original.same_binding(&changed), "{field}");
        }
    }
    #[test]
    fn one_participant_cannot_target_another_participant_or_duplicate_peer() {
        let mut value = intent();
        value.peers.push(value.peers[0].clone());
        assert!(value.validate().is_err());
        value.peers.pop();
        value.main_device_id = "55555555-5555-4555-8555-555555555555".into();
        assert!(value.validate().is_err());
    }
}
