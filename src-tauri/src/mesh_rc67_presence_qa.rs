// Created by NMKato Solutions
//! RC67/RC68 source-level Desktop wire contract for future outbound DO-WSS.
//! Signing is not a connection, owner grant, native-handler registration or online proof.
//! Runtime callers MUST bind a real server-issued challenge and an authenticated WSS
//! session to the existing device identity before using the codec.
//! No Tauri IPC command, socket, token refresh, device write or new signing key here.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use uuid::Uuid;

const TTL_MS: i64 = 15_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const JWS_TYP: &str = "katosync-rc67-duplex-relay+jws";
const CONTRACT: &str = "rc67-beta-native-v1";
const READ_ONLY_NAMES: &[&str] = &[
    "katosync_git_status",
    "katosync_mesh_peers",
    "katosync_list_directory",
    "katosync_read_file",
    "katosync_project_checkpoint",
    // Eigenes festes CLI-Profil; allgemeine Shell-Tools bleiben ausgeschlossen.
    "katosync_run_terminal_profile",
];

/// Values must come from a server-verified, current owner/tenant/client-grant
/// and device session, never from frontend/LLM/remote request parameters.
pub(crate) struct PresenceContext<'a> {
    pub owner_id: Uuid,
    pub tenant_id: Uuid,
    pub grant_id: Uuid,
    pub device_id: Uuid,
    pub session_id: Uuid,
    pub request_id: Uuid,
    pub challenge_id: Uuid,
    pub key_id: &'a str,
    pub sequence: u64,
    pub issued_at_ms: i64,
    pub challenge_expires_at_ms: i64,
    pub revoke_epoch: u64,
    /// Expose ONLY native handlers separately registered and read-authorized.
    pub native_tool_names: &'a [&'a str],
}

#[derive(Serialize)]
struct JwsHeader<'a> {
    alg: &'static str,
    kid: &'a str,
    typ: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PresenceBody<'a> {
    challenge_id: Uuid,
    protocol: &'static str,
    transport: &'static str,
    state: &'static str,
    revoke_epoch: u64,
    native_tool_names: &'a [&'a str],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedFrame<'a> {
    version: u8,
    direction: &'static str,
    kind: &'static str,
    owner_id: Uuid,
    tenant_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    session_id: Uuid,
    request_id: Uuid,
    sequence: u64,
    issued_at_ms: i64,
    expires_at_ms: i64,
    body: PresenceBody<'a>,
}

fn valid_uuid(value: Uuid) -> bool {
    let version = value.get_version_num();
    (1..=8).contains(&version) && matches!(value.get_variant(), uuid::Variant::RFC4122)
}

fn validate(ctx: &PresenceContext<'_>) -> Result<(), &'static str> {
    if ![
        ctx.owner_id,
        ctx.tenant_id,
        ctx.grant_id,
        ctx.device_id,
        ctx.session_id,
        ctx.request_id,
        ctx.challenge_id,
    ]
    .into_iter()
    .all(valid_uuid)
    {
        return Err("RC67_INVALID_IDENTITY");
    }
    if !(8..=80).contains(&ctx.key_id.len())
        || !ctx
            .key_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("RC67_INVALID_PINNED_KID");
    }
    if ctx.sequence == 0
        || ctx.sequence > MAX_SAFE_INTEGER
        || ctx.revoke_epoch > MAX_SAFE_INTEGER
        || ctx.issued_at_ms <= 0
        || (ctx.issued_at_ms as u64) > MAX_SAFE_INTEGER - TTL_MS as u64
        || ctx.challenge_expires_at_ms <= ctx.issued_at_ms
        || (ctx.challenge_expires_at_ms as u64) > MAX_SAFE_INTEGER
    {
        return Err("RC67_INVALID_SESSION_BOUNDARY");
    }
    if ctx.native_tool_names.len() > READ_ONLY_NAMES.len() {
        return Err("RC67_CAPABILITY_NOT_ADMITTED");
    }
    let mut admitted = std::collections::HashSet::new();
    if !ctx
        .native_tool_names
        .iter()
        .all(|name| READ_ONLY_NAMES.contains(name) && admitted.insert(*name))
    {
        return Err("RC67_CAPABILITY_NOT_ADMITTED");
    }
    Ok(())
}

/// Produces the exact JOSE compact JWS expected by RC67's `compactVerify`.
/// The signing key is borrowed from the ALREADY-existing OS-Keychain identity
/// via `mesh_identity::existing_identity` by a future verified WSS supervisor.
pub(crate) fn sign_presence_jws(
    ctx: &PresenceContext<'_>,
    existing_device_key: &SigningKey,
) -> Result<String, &'static str> {
    validate(ctx)?;
    let frame = SignedFrame {
        version: 1,
        direction: "device_to_cloud",
        kind: "presence.heartbeat",
        owner_id: ctx.owner_id,
        tenant_id: ctx.tenant_id,
        grant_id: ctx.grant_id,
        device_id: ctx.device_id,
        session_id: ctx.session_id,
        request_id: ctx.request_id,
        sequence: ctx.sequence,
        issued_at_ms: ctx.issued_at_ms,
        expires_at_ms: ctx.issued_at_ms + TTL_MS,
        body: PresenceBody {
            challenge_id: ctx.challenge_id,
            protocol: CONTRACT,
            transport: "outbound-wss",
            state: "connected_authenticated",
            revoke_epoch: ctx.revoke_epoch,
            native_tool_names: ctx.native_tool_names,
        },
    };
    sign_compact_wire_frame(&frame, ctx.key_id, existing_device_key)
}

/// Shared encoder for the already specified RC67 device_to_cloud JWS envelope.
/// It does NOT attest a session, identify a remote caller or grant device access.
/// The future WSS supervisor must verify the server challenge and signed request
/// before passing either a heartbeat or a native result to this helper.
pub(crate) fn sign_compact_wire_frame<T: Serialize>(
    frame: &T,
    pinned_key_id: &str,
    existing_device_key: &SigningKey,
) -> Result<String, &'static str> {
    if !(8..=80).contains(&pinned_key_id.len())
        || !pinned_key_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("RC67_INVALID_PINNED_KID");
    }
    let header = JwsHeader {
        alg: "EdDSA",
        kid: pinned_key_id,
        typ: JWS_TYP,
    };
    let header = serde_json::to_vec(&header).map_err(|_| "RC67_SERIALIZATION_FAILED")?;
    let payload = serde_json::to_vec(frame).map_err(|_| "RC67_SERIALIZATION_FAILED")?;
    if payload.len() > 16_384 {
        return Err("RC67_FRAME_TOO_LARGE");
    }
    let signing_input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header),
        URL_SAFE_NO_PAD.encode(payload)
    );
    let signature = existing_device_key.sign(signing_input.as_bytes());
    Ok(format!(
        "{}.{}",
        signing_input,
        URL_SAFE_NO_PAD.encode(signature.to_bytes())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ed25519_dalek::{Signature, Verifier};
    use serde_json::Value;

    fn context<'a>(names: &'a [&'a str]) -> PresenceContext<'a> {
        PresenceContext {
            owner_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            grant_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            request_id: Uuid::new_v4(),
            challenge_id: Uuid::new_v4(),
            key_id: "registered-device-key-01",
            sequence: 101,
            issued_at_ms: 1_794_940_000_000,
            challenge_expires_at_ms: 1_794_940_006_000,
            revoke_epoch: 5,
            native_tool_names: names,
        }
    }

    #[test]
    fn rc67_compact_eddsa_jws_verifies_with_existing_device_key() {
        let key = SigningKey::from_bytes(&[42u8; 32]); // synthetic fixture only
        let ctx = context(&["katosync_git_status", "katosync_mesh_peers"]);
        let compact = sign_presence_jws(&ctx, &key).unwrap();
        let parts: Vec<&str> = compact.split('.').collect();
        assert_eq!(parts.len(), 3);
        let header: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).unwrap()).unwrap();
        let payload: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap()).unwrap();
        key.verifying_key()
            .verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
            .unwrap();
        assert_eq!(header["alg"], "EdDSA");
        assert_eq!(header["kid"], ctx.key_id);
        assert_eq!(header["typ"], JWS_TYP);
        assert_eq!(payload["version"], 1);
        assert_eq!(payload["direction"], "device_to_cloud");
        assert_eq!(payload["kind"], "presence.heartbeat");
        assert_eq!(payload["ownerId"], ctx.owner_id.to_string());
        assert_eq!(payload["sessionId"], ctx.session_id.to_string());
        assert_eq!(payload["expiresAtMs"], ctx.issued_at_ms + 15_000);
        assert_eq!(payload["body"]["challengeId"], ctx.challenge_id.to_string());
        assert_eq!(payload["body"]["transport"], "outbound-wss");
        assert_eq!(payload["body"]["protocol"], "rc67-beta-native-v1");
        assert_eq!(payload["body"]["nativeToolNames"][0], "katosync_git_status");
        assert!(payload.get("privateKey").is_none());
        assert!(payload.get("ownerApproved").is_none());
    }

    #[test]
    fn rc67_tampering_and_wrong_key_fail_signature_validation() {
        let key = SigningKey::from_bytes(&[33u8; 32]);
        let other = SigningKey::from_bytes(&[34u8; 32]);
        let jws = sign_presence_jws(&context(&[]), &key).unwrap();
        let fields: Vec<&str> = jws.split('.').collect();
        let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(fields[2]).unwrap()).unwrap();
        let signed_bytes = format!("{}.{}", fields[0], fields[1]);
        assert!(other
            .verifying_key()
            .verify(signed_bytes.as_bytes(), &signature)
            .is_err());
        assert!(key
            .verifying_key()
            .verify(format!("{}.e30", fields[0]).as_bytes(), &signature)
            .is_err());
    }

    #[test]
    fn rc67_denies_execute_write_unrecognized_and_duplicate_capabilities() {
        let key = SigningKey::from_bytes(&[44u8; 32]);
        for tool in [
            "katosync_start_process",
            "katosync_write_file",
            "unknown_tool",
        ] {
            assert_eq!(
                sign_presence_jws(&context(&[tool]), &key),
                Err("RC67_CAPABILITY_NOT_ADMITTED")
            );
        }
        assert_eq!(
            sign_presence_jws(
                &context(&["katosync_git_status", "katosync_git_status"]),
                &key
            ),
            Err("RC67_CAPABILITY_NOT_ADMITTED")
        );
        assert!(sign_presence_jws(&context(&[]), &key).is_ok());
    }

    #[test]
    fn rc67_denies_bad_session_boundaries_and_unpinned_key_ids() {
        let key = SigningKey::from_bytes(&[55u8; 32]);
        let mut ctx = context(&[]);
        ctx.sequence = 0;
        assert_eq!(
            sign_presence_jws(&ctx, &key),
            Err("RC67_INVALID_SESSION_BOUNDARY")
        );
        ctx.sequence = MAX_SAFE_INTEGER + 1;
        assert_eq!(
            sign_presence_jws(&ctx, &key),
            Err("RC67_INVALID_SESSION_BOUNDARY")
        );
        ctx.sequence = 1;
        ctx.challenge_expires_at_ms = ctx.issued_at_ms;
        assert_eq!(
            sign_presence_jws(&ctx, &key),
            Err("RC67_INVALID_SESSION_BOUNDARY")
        );
        ctx.challenge_expires_at_ms = ctx.issued_at_ms + 1000;
        ctx.key_id = "bad!kid";
        assert_eq!(
            sign_presence_jws(&ctx, &key),
            Err("RC67_INVALID_PINNED_KID")
        );
        ctx.key_id = "registered-device-key-01";
        ctx.device_id = Uuid::nil();
        assert_eq!(sign_presence_jws(&ctx, &key), Err("RC67_INVALID_IDENTITY"));
    }
}
