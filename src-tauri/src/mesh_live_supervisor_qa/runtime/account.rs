// Created by NMKato Solutions
//! Kontogebundene Verbindungsabsicht, explizite Gerätefreigabe und Mehrteilnehmerzustand.
pub use super::profile::ConnectionMode;
use super::{
    profile::{self, ConnectionIntent, PeerIntent},
    ConnectionRole, ConnectionStatus,
};
use crate::mesh_account_control::{VerifiedAccountConfiguration, VerifiedAccountDevice};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{Mutex, OnceLock},
    time::Instant,
};
use tokio::task::JoinHandle;

#[path = "account_transport.rs"]
mod transport;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    pub peer_device_id: String,
    pub peer_fingerprint: String,
    pub mode: ConnectionMode,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerConnection {
    pub peer_device_id: String,
    #[serde(flatten)]
    pub status: ConnectionStatus,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountConnectionSnapshot {
    pub version: u8,
    pub owner_id: Option<String>,
    pub local_device_id: Option<String>,
    pub main_device_id: Option<String>,
    pub account_revision: Option<u64>,
    pub profiles: Vec<ProfileView>,
    pub connections: Vec<PeerConnection>,
    pub server_state: &'static str,
    pub error_code: Option<String>,
    pub remote_jobs_enabled: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPeerReview {
    pub version: u8,
    pub review_id: String,
    pub peer_device_id: String,
    pub peer_fingerprint: String,
    pub expected_revision: u64,
    pub expires_at: u64,
    pub proof_ready: bool,
}
#[derive(Clone)]
struct Review {
    view: AccountPeerReview,
    intent: ConnectionIntent,
    peer: PeerIntent,
    proof_binding: String,
    epoch: u64,
    auth_generation: u64,
}
struct PeerRuntime {
    generation: u64,
    status: ConnectionStatus,
    deadline: Option<Instant>,
    task: Option<JoinHandle<()>>,
}
struct AccountRuntime {
    epoch: u64,
    owner_generation: u64,
    next_peer_generation: u64,
    intent: Option<ConnectionIntent>,
    peers: BTreeMap<String, PeerRuntime>,
    listener: Option<JoinHandle<()>>,
    server_state: &'static str,
    error_code: Option<String>,
    reviews: BTreeMap<String, Review>,
    active_review: Option<String>,
}
impl Default for AccountRuntime {
    fn default() -> Self {
        Self {
            epoch: 1,
            owner_generation: 1,
            next_peer_generation: 1,
            intent: None,
            peers: BTreeMap::new(),
            listener: None,
            server_state: "idle",
            error_code: None,
            reviews: BTreeMap::new(),
            active_review: None,
        }
    }
}
static STATE: OnceLock<Mutex<AccountRuntime>> = OnceLock::new();
static COMMANDS: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
fn state() -> &'static Mutex<AccountRuntime> {
    STATE.get_or_init(|| Mutex::new(AccountRuntime::default()))
}
fn commands() -> &'static tokio::sync::Mutex<()> {
    COMMANDS.get_or_init(|| tokio::sync::Mutex::new(()))
}
fn epoch() -> Result<u64, String> {
    state()
        .lock()
        .map(|value| value.epoch)
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE".into())
}
fn advance(value: &mut u64) {
    *value = value
        .checked_add(1)
        .expect("bounded account connection generation exhausted");
}
fn authentication_generation() -> u64 {
    crate::native_owner_session_generation()
}
fn operation_current(current: &AccountRuntime, observed: u64, auth: u64, actual_auth: u64) -> bool {
    current.epoch == observed && auth == actual_auth
}
fn clear_reviews(current: &mut AccountRuntime) {
    current.reviews.clear();
    current.active_review = None;
}
fn cancel_review_locked(current: &mut AccountRuntime, id: &str) {
    current.reviews.remove(id);
    let active = current.active_review.as_deref() == Some(id);
    if active {
        current.active_review = None;
    }
}
pub fn mesh_account_peer_cancel_review(review_id: String) -> Result<(), String> {
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    cancel_review_locked(&mut current, &review_id);
    Ok(())
}
struct ReviewLease {
    id: String,
}
impl Drop for ReviewLease {
    fn drop(&mut self) {
        if let Ok(mut current) = state().lock() {
            if current.active_review.as_deref() == Some(self.id.as_str()) {
                current.active_review = None;
            }
        }
    }
}
fn review_current(current: &AccountRuntime, review: &Review, now: u64, auth: u64) -> bool {
    operation_current(current, review.epoch, review.auth_generation, auth)
        && current.active_review.as_deref() == Some(review.view.review_id.as_str())
        && now < review.view.expires_at
}
fn verify_generation(expected: u64, auth: u64) -> Result<(), String> {
    if epoch()? != expected || authentication_generation() != auth {
        Err("MESH_ACCOUNT_OPERATION_CANCELLED".into())
    } else {
        Ok(())
    }
}

fn binding(config: &VerifiedAccountConfiguration) -> Result<ConnectionIntent, String> {
    let main_id = config
        .main_device_id
        .as_deref()
        .ok_or("MESH_ACCOUNT_MAIN_REQUIRED")?;
    if !config.main_device_available {
        return Err("MESH_ACCOUNT_MAIN_UNAVAILABLE".into());
    }
    let main = config
        .eligible_device(main_id)
        .ok_or("MESH_ACCOUNT_MAIN_UNAVAILABLE")?;
    let local = config
        .eligible_device(&config.local_device_id)
        .ok_or("MESH_ACCOUNT_LOCAL_DEVICE_UNAVAILABLE")?;
    if local.public_key != config.local_public_key || local.fingerprint != config.local_fingerprint
    {
        return Err("MESH_ACCOUNT_LOCAL_IDENTITY_CHANGED".into());
    }
    let result = ConnectionIntent {
        version: 1,
        owner_id: config.owner_id.clone(),
        session_id: config.session_id.clone(),
        local_device_id: config.local_device_id.clone(),
        local_fingerprint: config.local_fingerprint.clone(),
        local_public_key: config.local_public_key.clone(),
        main_device_id: main_id.into(),
        main_fingerprint: main.fingerprint.clone(),
        main_public_key: main.public_key.clone(),
        account_revision: config.account_revision,
        peers: Vec::new(),
    };
    result.validate()?;
    Ok(result)
}
fn target<'a>(
    config: &'a VerifiedAccountConfiguration,
    id: &str,
    fp: &str,
    revision: u64,
) -> Result<&'a VerifiedAccountDevice, String> {
    if config.account_revision != revision {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    let base = binding(config)?;
    let peer = config
        .eligible_device(id)
        .ok_or("MESH_ACCOUNT_PEER_REVOKED")?;
    if id == config.local_device_id
        || fp != peer.fingerprint
        || peer.public_key == config.local_public_key
    {
        return Err("MESH_ACCOUNT_PEER_CHANGED".into());
    }
    if base.local_device_id != base.main_device_id && id != base.main_device_id {
        return Err("MESH_ACCOUNT_SELECT_MAIN_DEVICE".into());
    }
    Ok(peer)
}
fn peer_intent(peer: &VerifiedAccountDevice, mode: ConnectionMode) -> PeerIntent {
    PeerIntent {
        peer_device_id: peer.device_id.clone(),
        peer_fingerprint: peer.fingerprint.clone(),
        peer_public_key: peer.public_key.clone(),
        mode,
        enabled: true,
    }
}
fn snapshot_locked(current: &mut AccountRuntime) -> Result<AccountConnectionSnapshot, String> {
    let wall = super::now_ms()?;
    let now = Instant::now();
    let connections = current
        .peers
        .iter_mut()
        .map(|(id, peer)| {
            if peer.status.state == "connected"
                && (!super::snapshot_fresh(&peer.status, peer.deadline, now, wall)
                    || peer.task.as_ref().is_none_or(JoinHandle::is_finished))
            {
                peer.status.state = "reconnecting";
                peer.status.last_heartbeat_at = None;
                peer.status.expires_at = None;
                peer.status.error_code = Some("MESH_CONNECTION_HEARTBEAT_EXPIRED".into());
                peer.deadline = None;
            }
            PeerConnection {
                peer_device_id: id.clone(),
                status: peer.status.clone(),
            }
        })
        .collect();
    Ok(AccountConnectionSnapshot {
        version: 1,
        owner_id: current.intent.as_ref().map(|value| value.owner_id.clone()),
        local_device_id: current
            .intent
            .as_ref()
            .map(|value| value.local_device_id.clone()),
        main_device_id: current
            .intent
            .as_ref()
            .map(|value| value.main_device_id.clone()),
        account_revision: current.intent.as_ref().map(|value| value.account_revision),
        profiles: current
            .intent
            .as_ref()
            .map(|value| {
                value
                    .peers
                    .iter()
                    .map(|peer| ProfileView {
                        peer_device_id: peer.peer_device_id.clone(),
                        peer_fingerprint: peer.peer_fingerprint.clone(),
                        mode: peer.mode,
                        enabled: peer.enabled,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        connections,
        server_state: current.server_state,
        error_code: current.error_code.clone(),
        remote_jobs_enabled: false,
    })
}
pub fn mesh_account_connection_status() -> Result<AccountConnectionSnapshot, String> {
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    snapshot_locked(&mut current)
}
fn cancel_peer(current: &mut AccountRuntime, id: &str) {
    if let Some(mut peer) = current.peers.remove(id) {
        if let Some(task) = peer.task.take() {
            task.abort();
        }
    }
}
fn cancel_all(current: &mut AccountRuntime) {
    advance(&mut current.owner_generation);
    for (_, mut peer) in std::mem::take(&mut current.peers) {
        if let Some(task) = peer.task.take() {
            task.abort();
        }
    }
    if let Some(listener) = current.listener.take() {
        listener.abort();
    }
    current.server_state = "idle";
}
fn install_empty_binding(current: &mut AccountRuntime, base: ConnectionIntent) {
    if current
        .intent
        .as_ref()
        .is_none_or(|old| !old.same_binding(&base))
    {
        cancel_all(current);
        advance(&mut current.epoch);
        clear_reviews(current);
        current.intent = Some(base);
    }
}

/// Logout sperrt laufende Veröffentlichungen zuerst. Eine neue Login-Session kann
/// die alte persistierte Absicht selbst bei einem Keychain-Löschfehler nicht nutzen.
pub(crate) fn invalidate_owner_session() {
    if let Ok(mut current) = state().lock() {
        advance(&mut current.epoch);
        cancel_all(&mut current);
        clear_reviews(&mut current);
        current.intent = None;
        current.error_code = profile::clear().err();
    }
}
pub async fn mesh_account_connection_stop(
    peer_device_id: String,
) -> Result<AccountConnectionSnapshot, String> {
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    advance(&mut current.epoch);
    clear_reviews(&mut current);
    cancel_peer(&mut current, &peer_device_id);
    // Stop darf auch eine noch laufende Wiederaufnahme vor deren Readback sperren.
    let saved = if current.intent.is_none() {
        profile::load()?
    } else {
        None
    };
    if let Some(mut intent) = current.intent.clone().or(saved) {
        intent.disable(&peer_device_id);
        current.intent = Some(intent.clone());
        if !intent.peers.iter().any(|peer| peer.enabled) {
            cancel_all(&mut current);
        }
        if let Err(error) = profile::save(&intent) {
            current.error_code = Some(error.clone());
            return Err(error);
        }
    }
    snapshot_locked(&mut current)
}
pub(crate) async fn stop_all() -> Result<(), String> {
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    advance(&mut current.epoch);
    cancel_all(&mut current);
    clear_reviews(&mut current);
    if let Some(intent) = current.intent.as_mut() {
        for peer in &mut intent.peers {
            peer.enabled = false;
        }
    }
    profile::clear()?;
    Ok(())
}

async fn admitted(
    config: &VerifiedAccountConfiguration,
    peer: &VerifiedAccountDevice,
) -> Result<(), String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let admission = super::authorize_peer(&peer.fingerprint).await?;
    if admission.owner_uid != config.owner_id
        || admission.approved_peer.public_key != peer.public_key
        || URL_SAFE_NO_PAD.encode(admission.local_signing.verifying_key().as_bytes())
            != config.local_public_key
    {
        return Err("MESH_ACCOUNT_PEER_CHANGED".into());
    }
    Ok(())
}
fn commit_start(
    config: &VerifiedAccountConfiguration,
    peer: PeerIntent,
    observed_epoch: u64,
    auth: u64,
    saved: Option<ConnectionIntent>,
    review_id: Option<&str>,
) -> Result<AccountConnectionSnapshot, String> {
    let base = binding(config)?;
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    if !operation_current(&current, observed_epoch, auth, authentication_generation()) {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    if review_id.is_some_and(|id| current.active_review.as_deref() != Some(id)) {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    let mut intent = current
        .intent
        .clone()
        .or(saved)
        .filter(|old| old.same_binding(&base))
        .unwrap_or(base);
    if let Some(old) = intent
        .peers
        .iter_mut()
        .find(|old| old.peer_device_id == peer.peer_device_id)
    {
        *old = peer.clone();
    } else {
        intent.peers.push(peer.clone());
    }
    intent.validate()?;
    // Kein task/start vor dem bestätigten persistenten Readback.
    profile::save(&intent)?;
    if !operation_current(&current, observed_epoch, auth, authentication_generation()) {
        let _ = profile::clear();
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    let changed_binding = current
        .intent
        .as_ref()
        .is_none_or(|old| !old.same_binding(&intent));
    if changed_binding {
        cancel_all(&mut current);
    }
    current.intent = Some(intent);
    current.error_code = None;
    advance(&mut current.epoch);
    clear_reviews(&mut current);
    ensure_peer_locked(&mut current, &peer.peer_device_id)?;
    snapshot_locked(&mut current)
}
fn ensure_peer_locked(current: &mut AccountRuntime, peer_id: &str) -> Result<(), String> {
    let intent = current
        .intent
        .as_ref()
        .ok_or("MESH_ACCOUNT_PROFILE_INVALID")?
        .clone();
    let peer = intent
        .peers
        .iter()
        .find(|peer| peer.peer_device_id == peer_id && peer.enabled)
        .ok_or("MESH_ACCOUNT_PROFILE_INVALID")?
        .clone();
    let server = intent.local_device_id == intent.main_device_id;
    if current.peers.get(peer_id).is_some_and(|peer| {
        peer.task.as_ref().is_some_and(|task| !task.is_finished())
            || (server && peer.status.state == "listening")
    }) {
        return Ok(());
    }
    cancel_peer(current, peer_id);
    advance(&mut current.next_peer_generation);
    let generation = current.next_peer_generation;
    let role = if server {
        ConnectionRole::Server
    } else {
        ConnectionRole::Client
    };
    current.peers.insert(
        peer_id.into(),
        PeerRuntime {
            generation,
            status: ConnectionStatus {
                state: if server { "listening" } else { "discovering" },
                role: Some(role),
                peer_fingerprint: Some(peer.peer_fingerprint.clone()),
                ..ConnectionStatus::default()
            },
            deadline: None,
            task: None,
        },
    );
    if server {
        if current
            .listener
            .as_ref()
            .is_none_or(JoinHandle::is_finished)
        {
            let owner_generation = current.owner_generation;
            current.listener = Some(tokio::spawn(transport::server_loop(
                owner_generation,
                intent,
            )));
        }
    } else {
        let owner_generation = current.owner_generation;
        let task = tokio::spawn(transport::client_loop(
            owner_generation,
            generation,
            intent,
            peer,
        ));
        current.peers.get_mut(peer_id).unwrap().task = Some(task);
    }
    Ok(())
}

pub async fn mesh_account_connection_start(
    peer_device_id: String,
    peer_fingerprint: String,
    expected_revision: u64,
    mode: ConnectionMode,
) -> Result<AccountConnectionSnapshot, String> {
    let _command = commands().lock().await;
    let observed = epoch()?;
    let auth = authentication_generation();
    let saved = profile::load()?;
    let config = crate::mesh_account_control::verified_configuration().await?;
    let peer = target(
        &config,
        &peer_device_id,
        &peer_fingerprint,
        expected_revision,
    )?;
    admitted(&config, peer).await?;
    verify_generation(observed, auth)?;
    let fresh = crate::mesh_account_control::verified_configuration().await?;
    if !binding(&config)?.same_binding(&binding(&fresh)?) {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    let peer = target(
        &fresh,
        &peer_device_id,
        &peer_fingerprint,
        expected_revision,
    )?;
    commit_start(&fresh, peer_intent(peer, mode), observed, auth, saved, None)
}

pub async fn mesh_account_connection_resume() -> Result<AccountConnectionSnapshot, String> {
    let _command = commands().lock().await;
    let observed = epoch()?;
    let auth = authentication_generation();
    let saved = profile::load()?;
    let config = crate::mesh_account_control::verified_configuration().await?;
    let base = match binding(&config) {
        Ok(base) => base,
        Err(error) => {
            let mut current = state()
                .lock()
                .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
            if !operation_current(&current, observed, auth, authentication_generation()) {
                return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
            }
            cancel_all(&mut current);
            advance(&mut current.epoch);
            clear_reviews(&mut current);
            current.intent = None;
            profile::clear()?;
            current.error_code = Some(error.clone());
            return Err(error);
        }
    };
    let Some(mut intent) = saved else {
        verify_generation(observed, auth)?;
        let mut current = state()
            .lock()
            .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
        if !operation_current(&current, observed, auth, authentication_generation()) {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        install_empty_binding(&mut current, base);
        return snapshot_locked(&mut current);
    };
    if !intent.same_binding(&base) {
        let mut current = state()
            .lock()
            .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
        if current.epoch != observed || authentication_generation() != auth {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        cancel_all(&mut current);
        advance(&mut current.epoch);
        current.intent = Some(base);
        clear_reviews(&mut current);
        profile::clear()?;
        current.error_code = Some("MESH_ACCOUNT_CONFIRM_CONNECTION_REQUIRED".into());
        return snapshot_locked(&mut current);
    }
    let requested: Vec<_> = intent.automatic_peers().cloned().collect();
    let mut allowed = Vec::new();
    for peer in requested {
        match target(
            &config,
            &peer.peer_device_id,
            &peer.peer_fingerprint,
            intent.account_revision,
        ) {
            Ok(device) if device.public_key == peer.peer_public_key => {
                match admitted(&config, device).await {
                    Ok(()) => allowed.push(peer.peer_device_id.clone()),
                    Err(error) if super::retryable(&error) => return Err(error),
                    Err(_) => intent.disable(&peer.peer_device_id),
                }
            }
            _ => intent.disable(&peer.peer_device_id),
        }
    }
    let fresh = crate::mesh_account_control::verified_configuration().await?;
    if !intent.same_binding(&binding(&fresh)?) {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    for id in &allowed {
        let peer = intent
            .peers
            .iter()
            .find(|peer| &peer.peer_device_id == id)
            .unwrap();
        let device = target(&fresh, id, &peer.peer_fingerprint, intent.account_revision)?;
        if device.public_key != peer.peer_public_key {
            return Err("MESH_ACCOUNT_PEER_CHANGED".into());
        }
    }
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    if current.epoch != observed || authentication_generation() != auth {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    profile::save(&intent)?;
    if !operation_current(&current, observed, auth, authentication_generation()) {
        let _ = profile::clear();
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    if current
        .intent
        .as_ref()
        .is_some_and(|old| !old.same_binding(&intent))
    {
        cancel_all(&mut current);
    }
    current.intent = Some(intent);
    advance(&mut current.epoch);
    current.error_code = None;
    for id in allowed {
        ensure_peer_locked(&mut current, &id)?;
    }
    snapshot_locked(&mut current)
}

pub async fn mesh_account_connection_set_mode(
    peer_device_id: String,
    peer_fingerprint: String,
    expected_revision: u64,
    mode: ConnectionMode,
) -> Result<AccountConnectionSnapshot, String> {
    let _command = commands().lock().await;
    let observed = epoch()?;
    let auth = authentication_generation();
    // Weniger automatische Verbindung bleibt auch bei Netzausfall möglich.
    let verified = if mode == ConnectionMode::Automatic {
        let config = crate::mesh_account_control::verified_configuration().await?;
        let device = target(
            &config,
            &peer_device_id,
            &peer_fingerprint,
            expected_revision,
        )?;
        admitted(&config, device).await?;
        let fresh = crate::mesh_account_control::verified_configuration().await?;
        if !binding(&config)?.same_binding(&binding(&fresh)?) {
            return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
        }
        let peer = target(
            &fresh,
            &peer_device_id,
            &peer_fingerprint,
            expected_revision,
        )?;
        Some((binding(&fresh)?, peer.public_key.clone()))
    } else {
        None
    };
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    if current.epoch != observed || authentication_generation() != auth {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    let mut intent = current
        .intent
        .clone()
        .ok_or("MESH_ACCOUNT_PROFILE_REQUIRED")?;
    if intent.account_revision != expected_revision {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    if verified
        .as_ref()
        .is_some_and(|(base, _)| !intent.same_binding(base))
    {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    let peer = intent
        .peers
        .iter_mut()
        .find(|peer| {
            peer.peer_device_id == peer_device_id && peer.peer_fingerprint == peer_fingerprint
        })
        .ok_or("MESH_ACCOUNT_PROFILE_REQUIRED")?;
    if verified
        .as_ref()
        .is_some_and(|(_, key)| &peer.peer_public_key != key)
    {
        return Err("MESH_ACCOUNT_PEER_CHANGED".into());
    }
    peer.mode = mode;
    profile::save(&intent)?;
    if !operation_current(&current, observed, auth, authentication_generation()) {
        let _ = profile::clear();
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    current.intent = Some(intent);
    advance(&mut current.epoch);
    clear_reviews(&mut current);
    snapshot_locked(&mut current)
}

pub async fn mesh_account_peer_review(
    peer_device_id: String,
    peer_fingerprint: String,
    expected_revision: u64,
) -> Result<AccountPeerReview, String> {
    let _command = commands().lock().await;
    let observed = epoch()?;
    let auth = authentication_generation();
    let config = crate::mesh_account_control::verified_configuration().await?;
    let peer = target(
        &config,
        &peer_device_id,
        &peer_fingerprint,
        expected_revision,
    )?;
    let proof = crate::mesh_trust::account_pending_proof(&config.owner_id, &peer.public_key)?;
    if proof.public_key != peer.public_key || proof.fingerprint != peer.fingerprint {
        return Err("MESH_ACCOUNT_PROOF_CHANGED".into());
    }
    let now = super::now_ms()?;
    let view = AccountPeerReview {
        version: 1,
        review_id: uuid::Uuid::new_v4().to_string(),
        peer_device_id,
        peer_fingerprint,
        expected_revision,
        expires_at: proof.expires_at_ms.min(now + 120_000),
        proof_ready: true,
    };
    if view.expires_at <= now {
        return Err("MESH_ACCOUNT_PROOF_EXPIRED".into());
    }
    let review = Review {
        view: view.clone(),
        intent: binding(&config)?,
        peer: peer_intent(peer, ConnectionMode::Ask),
        proof_binding: proof.binding,
        epoch: observed,
        auth_generation: auth,
    };
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    if current.epoch != observed || authentication_generation() != auth {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    current
        .reviews
        .retain(|_, value| value.view.expires_at > now);
    // Ein neuer Dialog ersetzt nur die alte Prüfung desselben Geräts.
    current
        .reviews
        .retain(|_, value| value.view.peer_device_id != view.peer_device_id);
    if current.reviews.len() >= 4 {
        return Err("MESH_ACCOUNT_REVIEW_LIMIT".into());
    }
    current.reviews.insert(view.review_id.clone(), review);
    Ok(view)
}
pub async fn mesh_account_peer_approve(
    review_id: String,
    peer_device_id: String,
    peer_fingerprint: String,
    expected_revision: u64,
    mode: ConnectionMode,
) -> Result<AccountConnectionSnapshot, String> {
    let _command = commands().lock().await;
    let review = {
        let mut current = state()
            .lock()
            .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
        let review = current
            .reviews
            .remove(&review_id)
            .ok_or("MESH_ACCOUNT_REVIEW_EXPIRED")?;
        current.active_review = Some(review_id.clone());
        review
    };
    let _lease = ReviewLease { id: review_id };
    if review.view.expires_at <= super::now_ms()?
        || review.view.peer_device_id != peer_device_id
        || review.view.peer_fingerprint != peer_fingerprint
        || review.view.expected_revision != expected_revision
    {
        return Err("MESH_ACCOUNT_REVIEW_CHANGED".into());
    }
    let config = crate::mesh_account_control::verified_configuration().await?;
    let peer = target(
        &config,
        &peer_device_id,
        &peer_fingerprint,
        expected_revision,
    )?;
    if !review.intent.same_binding(&binding(&config)?)
        || review.peer.peer_public_key != peer.public_key
    {
        return Err("MESH_ACCOUNT_REVIEW_CHANGED".into());
    }
    let saved = profile::load()?;
    {
        let current = state()
            .lock()
            .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
        if !review_current(
            &current,
            &review,
            super::now_ms()?,
            authentication_generation(),
        ) {
            return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
        }
        crate::mesh_trust::approve_account_pending(
            &config.owner_id,
            &peer.public_key,
            &review.proof_binding,
        )?;
    }
    // Ein angenommener Pin ist noch kein Verbindungs-/Profil-Erfolg.
    admitted(&config, peer)
        .await
        .map_err(|_| "MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED")?;
    let fresh = crate::mesh_account_control::verified_configuration()
        .await
        .map_err(|_| "MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED")?;
    let fresh_binding =
        binding(&fresh).map_err(|_| "MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED")?;
    if !review.intent.same_binding(&fresh_binding) {
        return Err("MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED".into());
    }
    let peer = target(
        &fresh,
        &peer_device_id,
        &peer_fingerprint,
        expected_revision,
    )
    .map_err(|_| "MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED")?;
    commit_start(
        &fresh,
        peer_intent(peer, mode),
        review.epoch,
        review.auth_generation,
        saved,
        Some(&review.view.review_id),
    )
    .map_err(|_| "MESH_ACCOUNT_PIN_APPROVED_CONNECTION_NOT_STARTED".into())
}
pub async fn mesh_account_peer_revoke(
    peer_device_id: String,
    peer_fingerprint: String,
    expected_revision: u64,
) -> Result<AccountConnectionSnapshot, String> {
    // Lokaler Stop kommt zuerst; ein späteres Auth-/Cloudproblem reaktiviert nichts.
    mesh_account_connection_stop(peer_device_id.clone()).await?;
    let _command = commands().lock().await;
    let observed = epoch()?;
    let auth = authentication_generation();
    let config = crate::mesh_account_control::verified_configuration().await?;
    let peer = config
        .device(&peer_device_id)
        .ok_or("MESH_ACCOUNT_PEER_CHANGED")?;
    if config.account_revision != expected_revision || peer.fingerprint != peer_fingerprint {
        return Err("MESH_ACCOUNT_REVISION_CHANGED".into());
    }
    let mut current = state()
        .lock()
        .map_err(|_| "MESH_ACCOUNT_STATE_UNAVAILABLE")?;
    if !operation_current(&current, observed, auth, authentication_generation()) {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    if let Some(intent) = &current.intent {
        if intent.owner_id != config.owner_id
            || intent.session_id != config.session_id
            || intent.local_public_key != config.local_public_key
        {
            return Err("MESH_ACCOUNT_SESSION_CHANGED".into());
        }
    }
    crate::mesh_trust::revoke_account_peer(&config.owner_id, &peer.public_key, &peer_fingerprint)?;
    if !operation_current(&current, observed, auth, authentication_generation()) {
        return Err("MESH_ACCOUNT_OPERATION_CANCELLED".into());
    }
    if let Some(mut intent) = current.intent.clone() {
        intent
            .peers
            .retain(|peer| peer.peer_device_id != peer_device_id);
        profile::save(&intent)?;
        current.intent = Some(intent);
    }
    advance(&mut current.epoch);
    clear_reviews(&mut current);
    snapshot_locked(&mut current)
}

pub(crate) async fn start_legacy(
    pin: String,
    role: ConnectionRole,
) -> Result<ConnectionStatus, String> {
    let config = crate::mesh_account_control::verified_configuration().await?;
    let base = binding(&config)?;
    let actual = if base.local_device_id == base.main_device_id {
        ConnectionRole::Server
    } else {
        ConnectionRole::Client
    };
    if role != actual {
        return Err("MESH_ACCOUNT_ROLE_FROM_MAIN_ONLY".into());
    }
    let peer = config
        .devices
        .iter()
        .find(|peer| peer.fingerprint == pin)
        .ok_or("MESH_ACCOUNT_PEER_CHANGED")?;
    let id = peer.device_id.clone();
    let snapshot = mesh_account_connection_start(
        id.clone(),
        pin,
        config.account_revision,
        ConnectionMode::Ask,
    )
    .await?;
    snapshot
        .connections
        .into_iter()
        .find(|peer| peer.peer_device_id == id)
        .map(|peer| peer.status)
        .ok_or("MESH_ACCOUNT_CONNECTION_NOT_STARTED".into())
}
pub(crate) fn legacy_status() -> Option<ConnectionStatus> {
    let mut current = state().lock().ok()?;
    if current.intent.is_none() {
        return None;
    }
    let snapshot = snapshot_locked(&mut current).ok()?;
    snapshot
        .connections
        .into_iter()
        .next()
        .map(|peer| peer.status)
        .or_else(|| Some(ConnectionStatus::default()))
}

fn peer_current(
    current: &AccountRuntime,
    owner_generation: u64,
    peer_id: &str,
    peer_generation: u64,
) -> bool {
    current.owner_generation == owner_generation
        && current
            .peers
            .get(peer_id)
            .is_some_and(|peer| peer.generation == peer_generation)
        && current.intent.as_ref().is_some_and(|intent| {
            intent
                .peers
                .iter()
                .any(|peer| peer.peer_device_id == peer_id && peer.enabled)
        })
}
fn publish_peer(
    owner_generation: u64,
    peer_generation: u64,
    peer_id: &str,
    label: &'static str,
    error: Option<&str>,
) {
    if let Ok(mut current) = state().lock() {
        if !peer_current(&current, owner_generation, peer_id, peer_generation) {
            return;
        }
        let peer = current.peers.get_mut(peer_id).unwrap();
        peer.status.state = label;
        peer.status.error_code = error.map(str::to_string);
        peer.status.last_heartbeat_at = None;
        peer.status.expires_at = None;
        peer.deadline = None;
    }
}
fn terminal_peer_failure(owner_generation: u64, peer_generation: u64, id: &str, error: &str) {
    if let Ok(mut current) = state().lock() {
        if !peer_current(&current, owner_generation, id, peer_generation) {
            return;
        }
        if let Some(intent) = current.intent.as_mut() {
            intent.disable(id);
            let _ = profile::save(intent);
        }
        let peer = current.peers.get_mut(id).unwrap();
        peer.status.state = "blocked";
        peer.status.error_code = Some(error.into());
        peer.status.last_heartbeat_at = None;
        peer.status.expires_at = None;
        peer.deadline = None;
        current.error_code = Some(error.into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    fn device(byte: u8) -> VerifiedAccountDevice {
        let key = ed25519_dalek::SigningKey::from_bytes(&[byte; 32]).verifying_key();
        VerifiedAccountDevice {
            device_id: uuid::Uuid::from_u128(1000 + u128::from(byte)).to_string(),
            owner_user_id: uuid::Uuid::from_u128(1).to_string(),
            fingerprint: crate::mesh_identity::fingerprint(&key),
            public_key: URL_SAFE_NO_PAD.encode(key.as_bytes()),
            membership_state: "discovered".into(),
            revoked: false,
            display_name: format!("Device {byte}"),
            persona_name: None,
            platform_os: "macos".into(),
            last_seen_at: None,
        }
    }
    fn config() -> VerifiedAccountConfiguration {
        let local = device(19);
        VerifiedAccountConfiguration {
            owner_id: local.owner_user_id.clone(),
            session_id: uuid::Uuid::from_u128(2).to_string(),
            local_device_id: local.device_id.clone(),
            local_fingerprint: local.fingerprint.clone(),
            local_public_key: local.public_key.clone(),
            main_device_id: Some(local.device_id.clone()),
            main_device_available: true,
            account_revision: 1,
            devices: vec![local, device(23), device(29)],
        }
    }
    fn review(current: &AccountRuntime, config: &VerifiedAccountConfiguration, id: &str) -> Review {
        let peer = &config.devices[1];
        Review {
            view: AccountPeerReview {
                version: 1,
                review_id: id.into(),
                peer_device_id: peer.device_id.clone(),
                peer_fingerprint: peer.fingerprint.clone(),
                expected_revision: config.account_revision,
                expires_at: 10_000,
                proof_ready: true,
            },
            intent: binding(config).unwrap(),
            peer: peer_intent(peer, ConnectionMode::Ask),
            proof_binding: "synthetic-proof-digest".into(),
            epoch: current.epoch,
            auth_generation: 7,
        }
    }
    #[test]
    fn stopping_one_peer_does_not_change_other_peer_generation() {
        let mut current = AccountRuntime::default();
        for (id, generation) in [("one", 10), ("two", 20)] {
            current.peers.insert(
                id.into(),
                PeerRuntime {
                    generation,
                    status: ConnectionStatus::default(),
                    deadline: None,
                    task: None,
                },
            );
        }
        let owner = current.owner_generation;
        cancel_peer(&mut current, "one");
        assert!(!current.peers.contains_key("one"));
        assert_eq!(current.peers["two"].generation, 20);
        assert_eq!(current.owner_generation, owner);
        cancel_all(&mut current);
        assert!(current.peers.is_empty());
        assert_ne!(current.owner_generation, owner);
    }
    #[test]
    fn cancel_after_review_take_blocks_pin_commit_and_delayed_connection_without_affecting_new_review(
    ) {
        let mut current = AccountRuntime::default();
        let config = config();
        let original = review(&current, &config, "first");
        current.reviews.insert("first".into(), original.clone());
        let pending = current.reviews.remove("first").unwrap();
        current.active_review = Some("first".into());
        assert!(review_current(&current, &pending, 1000, 7));
        cancel_review_locked(&mut current, "first");
        assert!(!review_current(&current, &pending, 1001, 7));
        assert!(current.active_review.is_none());
        let next = review(&current, &config, "second");
        current.active_review = Some("second".into());
        cancel_review_locked(&mut current, "first");
        assert!(review_current(&current, &next, 1002, 7));
        assert!(!review_current(&current, &next, 10_000, 7));
        assert!(!review_current(&current, &next, 1002, 8));
        advance(&mut current.epoch);
        assert!(!review_current(&current, &next, 1002, 7));
    }
    #[test]
    fn main_revision_revocation_and_participant_topology_are_cloud_bound() {
        let mut config = config();
        let peer = config.devices[1].clone();
        let other = config.devices[2].clone();
        assert!(target(&config, &peer.device_id, &peer.fingerprint, 1).is_ok());
        assert!(target(&config, &peer.device_id, &peer.fingerprint, 2).is_err());
        config.main_device_id = Some(peer.device_id.clone());
        config.account_revision = 2;
        assert!(target(&config, &peer.device_id, &peer.fingerprint, 2).is_ok());
        assert_eq!(
            target(&config, &other.device_id, &other.fingerprint, 2).unwrap_err(),
            "MESH_ACCOUNT_SELECT_MAIN_DEVICE"
        );
        config.devices[1].revoked = true;
        config.devices[1].membership_state = "revoked".into();
        config.main_device_available = false;
        assert!(binding(&config).is_err());
        assert!(target(&config, &peer.device_id, &peer.fingerprint, 2).is_err());
    }
    #[test]
    fn empty_resume_after_main_change_invalidates_old_channels_and_late_completions() {
        let mut current = AccountRuntime::default();
        let mut config = config();
        install_empty_binding(&mut current, binding(&config).unwrap());
        let observed = current.epoch;
        let owner = current.owner_generation;
        current.peers.insert(
            "old".into(),
            PeerRuntime {
                generation: 10,
                status: ConnectionStatus::default(),
                deadline: None,
                task: None,
            },
        );
        config.main_device_id = Some(config.devices[1].device_id.clone());
        config.account_revision = 2;
        install_empty_binding(&mut current, binding(&config).unwrap());
        assert!(current.peers.is_empty());
        assert_ne!(current.owner_generation, owner);
        assert!(!operation_current(&current, observed, 7, 7));
        assert_eq!(current.intent.as_ref().unwrap().account_revision, 2);
        assert_eq!(
            current.intent.as_ref().unwrap().main_device_id,
            config.devices[1].device_id
        );
        assert!(!operation_current(&current, current.epoch, 7, 8));
    }
    #[test]
    fn stopped_peer_cannot_publish_after_reconnect_and_other_peer_stays_current() {
        let config = config();
        let mut intent = binding(&config).unwrap();
        intent.peers = config.devices[1..]
            .iter()
            .map(|p| peer_intent(p, ConnectionMode::Automatic))
            .collect();
        let one = intent.peers[0].peer_device_id.clone();
        let two = intent.peers[1].peer_device_id.clone();
        let mut current = AccountRuntime {
            intent: Some(intent),
            ..AccountRuntime::default()
        };
        for (id, generation) in [(&one, 10), (&two, 20)] {
            current.peers.insert(
                id.clone(),
                PeerRuntime {
                    generation,
                    status: ConnectionStatus::default(),
                    deadline: None,
                    task: None,
                },
            );
        }
        let owner = current.owner_generation;
        assert!(peer_current(&current, owner, &one, 10));
        assert!(peer_current(&current, owner, &two, 20));
        cancel_peer(&mut current, &one);
        current.intent.as_mut().unwrap().disable(&one);
        assert!(!peer_current(&current, owner, &one, 10));
        assert!(peer_current(&current, owner, &two, 20));
        current.peers.insert(
            one.clone(),
            PeerRuntime {
                generation: 30,
                status: ConnectionStatus::default(),
                deadline: None,
                task: None,
            },
        );
        current.intent.as_mut().unwrap().peers[0].enabled = true;
        assert!(!peer_current(&current, owner, &one, 10));
        assert!(peer_current(&current, owner, &one, 30));
        cancel_all(&mut current);
        assert!(!peer_current(&current, owner, &two, 20));
    }
}
