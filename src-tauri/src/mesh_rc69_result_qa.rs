// Created by NMKato Solutions
//! RC69 Beta-0 signed native Git-status receipt, QA-only and not a live MCP handler.
//! Bind a verified requestId, owner/tenant/grant/device/session and monotonic
//! sequence from the FUTURE authenticated DO-WSS request verifier first.
//! The existing Device Ed25519 key signs both heartbeat and result receipts.
//! Signing a value does not authorize a grant or prove transport is online.

use crate::mesh_rc67_presence_qa::{sign_compact_wire_frame, PresenceContext};
use crate::mesh_rc69_readonly_qa::NativeGitStatus;
use ed25519_dalek::SigningKey;
use serde::Serialize;

const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const TTL_MS: i64 = 15_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GitResultBody<'a> {
    tool_name: &'static str,
    status: &'static str,
    result: &'a NativeGitStatus,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultEnvelope<'a> {
    version: u8,
    direction: &'static str,
    kind: &'static str,
    owner_id: uuid::Uuid,
    tenant_id: uuid::Uuid,
    grant_id: uuid::Uuid,
    device_id: uuid::Uuid,
    session_id: uuid::Uuid,
    request_id: uuid::Uuid,
    sequence: u64,
    issued_at_ms: i64,
    expires_at_ms: i64,
    body: GitResultBody<'a>,
}

/// Source QA encoder. Only the future trusted WSS dispatcher may construct
/// a context after verifying the server's issued challenge and signed tool
/// request; the project-scoped Git result must come from native local reads.
/// No paths, stdout, arbitrary error text or uncontrolled JSON are accepted.
pub(crate) fn sign_git_status_result_jws(
    ctx: &PresenceContext<'_>,
    result: &NativeGitStatus,
    existing_device_key: &SigningKey,
) -> Result<String, &'static str> {
    if !ctx.native_tool_names.contains(&"katosync_git_status") {
        return Err("RC69_RESULT_TOOL_NOT_ADMITTED");
    }
    let safe_id = |id: uuid::Uuid| {
        let n = id.get_version_num();
        (1..=8).contains(&n) && matches!(id.get_variant(), uuid::Variant::RFC4122)
    };
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
    .all(safe_id)
    {
        return Err("RC69_RESULT_INVALID_SESSION");
    }
    if ctx.sequence == 0
        || ctx.sequence > MAX_JS_SAFE_INTEGER
        || ctx.issued_at_ms <= 0
        || ctx.issued_at_ms as u64 > MAX_JS_SAFE_INTEGER - TTL_MS as u64
        || ctx.challenge_expires_at_ms <= ctx.issued_at_ms
        || ctx.challenge_expires_at_ms as u64 > MAX_JS_SAFE_INTEGER
    {
        return Err("RC69_RESULT_INVALID_SESSION");
    }
    if result.project_id.is_empty()
        || result.project_id.len() > 140
        || (result.head_sha.len() != 40 && result.head_sha.len() != 64)
        || !result.head_sha.bytes().all(|ch| ch.is_ascii_hexdigit())
        || result.branch.is_empty()
        || result.branch.len() > 128
        || !result
            .branch
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || b"._/-".contains(&ch))
        || result.provenance != "local_git_verified_root"
    {
        return Err("RC69_RESULT_UNVERIFIED_SOURCE");
    }
    let frame = ResultEnvelope {
        version: 1,
        direction: "device_to_cloud",
        kind: "tool.result",
        owner_id: ctx.owner_id,
        tenant_id: ctx.tenant_id,
        grant_id: ctx.grant_id,
        device_id: ctx.device_id,
        session_id: ctx.session_id,
        request_id: ctx.request_id,
        sequence: ctx.sequence,
        issued_at_ms: ctx.issued_at_ms,
        expires_at_ms: ctx.issued_at_ms + TTL_MS,
        body: GitResultBody {
            tool_name: "katosync_git_status",
            status: "completed",
            result,
        },
    };
    sign_compact_wire_frame(&frame, ctx.key_id, existing_device_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use ed25519_dalek::{Signature, Verifier};
    use serde_json::Value;
    use uuid::Uuid;

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
            sequence: 105,
            issued_at_ms: 1_794_940_000_000,
            challenge_expires_at_ms: 1_794_940_006_000,
            revoke_epoch: 5,
            native_tool_names: names,
        }
    }

    fn local_result() -> NativeGitStatus {
        NativeGitStatus {
            project_id: "katosync".to_owned(),
            head_sha: "a".repeat(40),
            branch: "beta/v2-core".to_owned(),
            dirty: false,
            provenance: "local_git_verified_root",
        }
    }

    #[test]
    fn signed_result_uses_rc67_wire_envelope_with_same_device_key() {
        let key = SigningKey::from_bytes(&[71; 32]); // Ephemeral fixture only.
        let ctx = context(&["katosync_git_status"]);
        let receipt = sign_git_status_result_jws(&ctx, &local_result(), &key).unwrap();
        let parts: Vec<_> = receipt.split('.').collect();
        assert_eq!(parts.len(), 3);
        let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).unwrap()).unwrap();
        let signed = format!("{}.{}", parts[0], parts[1]);
        key.verifying_key()
            .verify(signed.as_bytes(), &signature)
            .unwrap();
        let header: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).unwrap()).unwrap();
        let frame: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
        assert_eq!(header["alg"], "EdDSA");
        assert_eq!(header["typ"], "katosync-rc67-duplex-relay+jws");
        assert_eq!(frame["direction"], "device_to_cloud");
        assert_eq!(frame["kind"], "tool.result");
        assert_eq!(frame["requestId"], ctx.request_id.to_string());
        assert_eq!(frame["sessionId"], ctx.session_id.to_string());
        assert_eq!(frame["expiresAtMs"], ctx.issued_at_ms + TTL_MS);
        assert_eq!(frame["body"]["toolName"], "katosync_git_status");
        assert_eq!(frame["body"]["status"], "completed");
        assert_eq!(frame["body"]["result"]["headSha"], "a".repeat(40));
        assert!(frame["body"]["result"].get("rootPath").is_none());
        assert!(frame["body"].get("ownerApproved").is_none());
    }

    #[test]
    fn rejects_unadvertised_tool_and_forged_git_output() {
        let key = SigningKey::from_bytes(&[72; 32]);
        let ctx = context(&[]);
        assert_eq!(
            sign_git_status_result_jws(&ctx, &local_result(), &key),
            Err("RC69_RESULT_TOOL_NOT_ADMITTED")
        );
        let ctx = context(&["katosync_git_status"]);
        let mut forged = local_result();
        forged.head_sha = "fakeSHA".to_owned();
        assert_eq!(
            sign_git_status_result_jws(&ctx, &forged, &key),
            Err("RC69_RESULT_UNVERIFIED_SOURCE")
        );
        forged = local_result();
        forged.provenance = "fake_remote_source";
        assert_eq!(
            sign_git_status_result_jws(&ctx, &forged, &key),
            Err("RC69_RESULT_UNVERIFIED_SOURCE")
        );
    }

    #[test]
    fn rejects_bad_session_seq_and_wrong_signature_key() {
        let key = SigningKey::from_bytes(&[73; 32]);
        let other = SigningKey::from_bytes(&[74; 32]);
        let mut ctx = context(&["katosync_git_status"]);
        ctx.sequence = 0;
        assert_eq!(
            sign_git_status_result_jws(&ctx, &local_result(), &key),
            Err("RC69_RESULT_INVALID_SESSION")
        );
        ctx.sequence = 2;
        let receipt = sign_git_status_result_jws(&ctx, &local_result(), &key).unwrap();
        let fields: Vec<_> = receipt.split('.').collect();
        let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(fields[2]).unwrap()).unwrap();
        assert!(other
            .verifying_key()
            .verify(
                format!("{}.{}", fields[0], fields[1]).as_bytes(),
                &signature
            )
            .is_err());
    }
}
