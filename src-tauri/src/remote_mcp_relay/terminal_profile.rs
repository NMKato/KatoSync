// Created by NMKato Solutions
//! Exakt freigegebenes CLI-Profil über den vorhandenen signierten Relaykanal.
use super::git_status::{self, ApprovedProject, DispatchAuthority};
use crate::mesh_rc67_presence_qa::{sign_compact_wire_frame, PresenceContext};
use crate::mesh_rc72_signed_server_qa::PinnedServerContext;
use crate::remote_mcp_terminal::{self as consent, PROFILE, TOOL};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, SigningKey};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};
use tokio::time::Instant;
use uuid::Uuid;

const DENIED: &str = "REMOTE_MCP_TERMINAL_REQUEST_REJECTED";
const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Header {
    alg: String,
    kid: String,
    typ: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Body {
    tool_name: String,
    project_id: String,
    profile_id: String,
    operation_id: Uuid,
    arguments_sha256: String,
    oauth_client_id: Uuid,
    authority_revision: String,
    approval_proof_jws: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    version: u8,
    direction: String,
    kind: String,
    owner_id: Uuid,
    tenant_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    session_id: Uuid,
    request_id: Uuid,
    sequence: u64,
    issued_at_ms: u64,
    expires_at_ms: u64,
    body: Body,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Approval {
    version: u8,
    kind: String,
    owner_id: Uuid,
    tenant_id: Uuid,
    oauth_client_id: Uuid,
    grant_id: Uuid,
    device_id: Uuid,
    operation_id: Uuid,
    project_id: String,
    profile_id: String,
    arguments_sha256: String,
    authority_revision: String,
    device_proof_sha256: String,
    issued_at_ms: u64,
    expires_at_ms: u64,
}
pub(super) struct VerifiedRequest {
    pub request_id: Uuid,
    pub sequence: u64,
    pub execution_deadline_ms: u64,
    pub operation_id: Uuid,
    pub project_id: String,
    pub arguments_sha256: String,
    pub device_proof_sha256: String,
    pub approval_expires_at: u64,
}
fn verify_payload(
    raw: &str,
    pin: &PinnedServerContext<'_>,
    typ: &str,
) -> Result<Vec<u8>, &'static str> {
    if raw.is_empty() || raw.len() > 24_576 {
        return Err(DENIED);
    }
    let parts: Vec<_> = raw.split('.').collect();
    if parts.len() != 3
        || parts[0].is_empty()
        || parts[0].len() > 1024
        || parts[1].is_empty()
        || parts[2].len() != 86
    {
        return Err(DENIED);
    }
    let header: Header =
        serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0]).map_err(|_| DENIED)?)
            .map_err(|_| DENIED)?;
    if header.alg != "EdDSA" || header.kid != pin.kid || header.typ != typ {
        return Err(DENIED);
    }
    let signature = Signature::from_slice(&URL_SAFE_NO_PAD.decode(parts[2]).map_err(|_| DENIED)?)
        .map_err(|_| DENIED)?;
    pin.verifying_key
        .verify_strict(format!("{}.{}", parts[0], parts[1]).as_bytes(), &signature)
        .map_err(|_| DENIED)?;
    URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| DENIED)
}
/// Ungeprüfte Auswahl des Verifiers; diese Funktion erteilt keinerlei Berechtigung.
pub(super) fn is_terminal_request(raw: &str) -> bool {
    if raw.len() > 24_576 {
        return false;
    }
    raw.split('.')
        .nth(1)
        .and_then(|p| URL_SAFE_NO_PAD.decode(p).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .is_some_and(|v| {
            v.pointer("/body/toolName")
                .and_then(serde_json::Value::as_str)
                == Some(TOOL)
        })
}
fn valid_uuid(id: Uuid) -> bool {
    (1..=8).contains(&id.get_version_num()) && matches!(id.get_variant(), uuid::Variant::RFC4122)
}
pub(super) fn verify_request(
    raw: &str,
    pin: &PinnedServerContext<'_>,
    authority: &DispatchAuthority<'_>,
    last_sequence: u64,
    now: u64,
    session_expires: u64,
    approved: &[ApprovedProject],
    seen: &HashSet<Uuid>,
) -> Result<VerifiedRequest, &'static str> {
    let frame: Frame =
        serde_json::from_slice(&verify_payload(raw, pin, "katosync-rc67-duplex-relay+jws")?)
            .map_err(|_| DENIED)?;
    let b = &frame.body;
    if now == 0
        || now > SAFE_INTEGER
        || seen.len() >= 32
        || frame.version != 1
        || frame.direction != "cloud_to_device"
        || frame.kind != "tool.request"
        || frame.owner_id != pin.owner_id
        || frame.tenant_id != pin.tenant_id
        || frame.grant_id != pin.grant_id
        || frame.device_id != pin.device_id
        || frame.session_id != pin.session_id
        || !valid_uuid(frame.request_id)
        || seen.contains(&frame.request_id)
        || frame.sequence <= last_sequence
        || frame.sequence > SAFE_INTEGER
        || frame.issued_at_ms == 0
        || frame.issued_at_ms > SAFE_INTEGER - 15_000
        || frame.expires_at_ms != frame.issued_at_ms + 15_000
        || frame.expires_at_ms > session_expires
        || frame.issued_at_ms > now.saturating_add(5_000)
        || b.tool_name != TOOL
        || b.profile_id != PROFILE
        || !valid_uuid(b.operation_id)
        || b.oauth_client_id != authority.client_id
        || b.authority_revision != authority.revision
        || !consent::valid_digest(authority.revision)
        || !git_status::valid_project_id(&b.project_id)
        || approved.iter().filter(|p| p.id == b.project_id).count() != 1
        || b.arguments_sha256
            != consent::arguments_sha256(pin.device_id, b.operation_id, &b.project_id)
    {
        return Err(DENIED);
    }
    let proof: Approval = serde_json::from_slice(&verify_payload(
        &b.approval_proof_jws,
        pin,
        "katosync-cli-operation-approval+jws",
    )?)
    .map_err(|_| DENIED)?;
    if proof.version != 1
        || proof.kind != "BETA4_NATIVE_CLI_OPERATION_APPROVAL"
        || proof.owner_id != pin.owner_id
        || proof.tenant_id != pin.tenant_id
        || proof.oauth_client_id != authority.client_id
        || proof.grant_id != pin.grant_id
        || proof.device_id != pin.device_id
        || proof.operation_id != b.operation_id
        || proof.project_id != b.project_id
        || proof.profile_id != PROFILE
        || proof.arguments_sha256 != b.arguments_sha256
        || proof.authority_revision != authority.revision
        || !consent::valid_digest(&proof.device_proof_sha256)
        || proof.issued_at_ms == 0
        || proof.issued_at_ms > SAFE_INTEGER - 60_000
        || proof.expires_at_ms != proof.issued_at_ms + 60_000
        || proof.issued_at_ms > now.saturating_add(5_000)
        || now >= proof.expires_at_ms
    {
        return Err(DENIED);
    }
    let execution_deadline_ms = (frame.issued_at_ms + 8_000).min(proof.expires_at_ms);
    if now >= execution_deadline_ms {
        return Err("REMOTE_MCP_GIT_DEADLINE");
    }
    Ok(VerifiedRequest {
        request_id: frame.request_id,
        sequence: frame.sequence,
        execution_deadline_ms,
        operation_id: b.operation_id,
        project_id: b.project_id.clone(),
        arguments_sha256: b.arguments_sha256.clone(),
        device_proof_sha256: proof.device_proof_sha256,
        approval_expires_at: proof.expires_at_ms,
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileResult {
    operation_id: Uuid,
    project_id: String,
    profile_id: &'static str,
    exit_code: i32,
    stdout: String,
    stderr: &'static str,
    provenance: &'static str,
}
/// Führt ausschließlich die feste Git-Binärdatei mit dem Argument --version aus.
pub(super) async fn run(
    project: &ApprovedProject,
    operation_id: Uuid,
    remaining_ms: u64,
) -> Result<ProfileResult, &'static str> {
    if remaining_ms < 500 {
        return Err("REMOTE_MCP_GIT_DEADLINE");
    }
    let deadline = Instant::now() + Duration::from_millis(remaining_ms.min(8_000));
    let (code, output) = git_status::run_git(project, &["--version"], deadline).await?;
    let stdout = String::from_utf8(output).map_err(|_| DENIED)?;
    let trimmed = stdout.trim();
    if code != 0
        || !trimmed.starts_with("git version ")
        || trimmed.len() > 512
        || !trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b" .()+_-".contains(&b))
    {
        return Err("REMOTE_MCP_TERMINAL_PROFILE_FAILED");
    }
    Ok(ProfileResult {
        operation_id,
        project_id: project.id.clone(),
        profile_id: PROFILE,
        exit_code: 0,
        stdout,
        stderr: "",
        provenance: "local_cli_profile_verified_root",
    })
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultBody<'a> {
    tool_name: &'static str,
    status: &'static str,
    result: &'a ProfileResult,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultFrame<'a> {
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
    body: ResultBody<'a>,
}
pub(super) fn sign_result(
    ctx: &PresenceContext<'_>,
    result: &ProfileResult,
    key: &SigningKey,
) -> Result<String, &'static str> {
    if !ctx.native_tool_names.contains(&TOOL)
        || !valid_uuid(result.operation_id)
        || !git_status::valid_project_id(&result.project_id)
        || result.profile_id != PROFILE
        || result.exit_code != 0
        || !result.stderr.is_empty()
        || result.stdout.len() > 65_536
        || result.provenance != "local_cli_profile_verified_root"
        || ctx.sequence == 0
        || ctx.sequence > SAFE_INTEGER
        || ctx.issued_at_ms <= 0
        || ctx.issued_at_ms as u64 > SAFE_INTEGER - 15_000
        || ctx.issued_at_ms + 15_000 > ctx.challenge_expires_at_ms
        || ![
            ctx.owner_id,
            ctx.tenant_id,
            ctx.grant_id,
            ctx.device_id,
            ctx.session_id,
            ctx.request_id,
        ]
        .iter()
        .all(|id| valid_uuid(*id))
    {
        return Err(DENIED);
    }
    sign_compact_wire_frame(
        &ResultFrame {
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
            expires_at_ms: ctx.issued_at_ms + 15_000,
            body: ResultBody {
                tool_name: TOOL,
                status: "completed",
                result,
            },
        },
        ctx.key_id,
        key,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::Signer;
    use serde_json::{json, Value};
    const NOW: u64 = 1_800_000_000_000;
    fn signed(value: &Value, key: &SigningKey, typ: &str) -> String {
        let h = URL_SAFE_NO_PAD
            .encode(json!({"alg":"EdDSA","kid":"terminal-fixture-key","typ":typ}).to_string());
        let p = URL_SAFE_NO_PAD.encode(value.to_string());
        let bytes = format!("{h}.{p}");
        format!(
            "{bytes}.{}",
            URL_SAFE_NO_PAD.encode(key.sign(bytes.as_bytes()).to_bytes())
        )
    }
    fn fixture() -> (
        SigningKey,
        PinnedServerContext<'static>,
        Value,
        Value,
        Vec<ApprovedProject>,
    ) {
        let key = SigningKey::from_bytes(&[72; 32]);
        let pin = PinnedServerContext {
            kid: "terminal-fixture-key",
            verifying_key: key.verifying_key(),
            owner_id: Uuid::new_v4(),
            tenant_id: Uuid::new_v4(),
            grant_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
        };
        let client = Uuid::new_v4();
        let operation = Uuid::new_v4();
        let digest = consent::arguments_sha256(pin.device_id, operation, "katosync");
        let proof = json!({"version":1,"kind":"BETA4_NATIVE_CLI_OPERATION_APPROVAL","ownerId":pin.owner_id,
            "tenantId":pin.tenant_id,"oauthClientId":client,"grantId":pin.grant_id,"deviceId":pin.device_id,
            "operationId":operation,"projectId":"katosync","profileId":"git_version","argumentsSha256":digest,
            "authorityRevision":"ab".repeat(32),"deviceProofSha256":"cd".repeat(32),"issuedAtMs":NOW-1000,
            "expiresAtMs":NOW+59000});
        let body = json!({"toolName":TOOL,"projectId":"katosync","profileId":PROFILE,"operationId":operation,
            "argumentsSha256":digest,"oauthClientId":client,"authorityRevision":"ab".repeat(32),
            "approvalProofJws":signed(&proof,&key,"katosync-cli-operation-approval+jws")});
        let frame = json!({"version":1,"direction":"cloud_to_device","kind":"tool.request",
            "ownerId":pin.owner_id,"tenantId":pin.tenant_id,"grantId":pin.grant_id,"deviceId":pin.device_id,
            "sessionId":pin.session_id,"requestId":Uuid::new_v4(),"sequence":3,"issuedAtMs":NOW,
            "expiresAtMs":NOW+15000,"body":body});
        let root = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let projects = vec![ApprovedProject {
            id: "katosync".into(),
            root,
        }];
        (key, pin, proof, frame, projects)
    }
    fn verify(
        frame: &Value,
        key: &SigningKey,
        pin: &PinnedServerContext<'_>,
        projects: &[ApprovedProject],
        now: u64,
    ) -> Result<VerifiedRequest, &'static str> {
        let authority = DispatchAuthority {
            client_id: Uuid::parse_str(frame["body"]["oauthClientId"].as_str().unwrap()).unwrap(),
            revision: &"ab".repeat(32),
        };
        verify_request(
            &signed(frame, key, "katosync-rc67-duplex-relay+jws"),
            pin,
            &authority,
            2,
            now,
            NOW + 45000,
            projects,
            &HashSet::new(),
        )
    }
    #[test]
    fn both_signed_envelopes_bind_exact_operation_and_expiry() {
        let (key, pin, proof, frame, projects) = fixture();
        let good = verify(&frame, &key, &pin, &projects, NOW).unwrap();
        assert_eq!(good.execution_deadline_ms, NOW + 8000);
        for field in ["ownerId", "tenantId", "grantId", "deviceId", "sessionId"] {
            let mut changed = frame.clone();
            changed[field] = json!(Uuid::new_v4());
            assert!(
                verify(&changed, &key, &pin, &projects, NOW).is_err(),
                "{field}"
            );
        }
        for field in [
            "ownerId",
            "tenantId",
            "oauthClientId",
            "grantId",
            "deviceId",
            "operationId",
        ] {
            let mut changed_proof = proof.clone();
            changed_proof[field] = json!(Uuid::new_v4());
            let mut changed = frame.clone();
            changed["body"]["approvalProofJws"] = json!(signed(
                &changed_proof,
                &key,
                "katosync-cli-operation-approval+jws"
            ));
            assert!(
                verify(&changed, &key, &pin, &projects, NOW).is_err(),
                "{field}"
            );
        }
        for (field, value) in [
            ("profileId", json!("shell")),
            ("projectId", json!("other")),
            ("argumentsSha256", json!("ef".repeat(32))),
            ("authorityRevision", json!("ef".repeat(32))),
            ("deviceProofSha256", json!("bad")),
            ("expiresAtMs", json!(NOW + 60000)),
        ] {
            let mut changed_proof = proof.clone();
            changed_proof[field] = value;
            let mut changed = frame.clone();
            changed["body"]["approvalProofJws"] = json!(signed(
                &changed_proof,
                &key,
                "katosync-cli-operation-approval+jws"
            ));
            assert!(
                verify(&changed, &key, &pin, &projects, NOW).is_err(),
                "{field}"
            );
        }
        assert!(verify(&frame, &key, &pin, &projects, NOW + 8000).is_err());
        let mut command = frame.clone();
        command["body"]["command"] = json!("git --version");
        assert!(verify(&command, &key, &pin, &projects, NOW).is_err());
    }
    #[test]
    fn forged_signature_wrong_typ_replay_and_unselected_project_cannot_execute() {
        let (key, pin, proof, frame, projects) = fixture();
        let mut changed = frame.clone();
        changed["body"]["approvalProofJws"] = json!(signed(
            &proof,
            &SigningKey::from_bytes(&[73; 32]),
            "katosync-cli-operation-approval+jws"
        ));
        assert!(verify(&changed, &key, &pin, &projects, NOW).is_err());
        changed["body"]["approvalProofJws"] =
            json!(signed(&proof, &key, "katosync-rc67-duplex-relay+jws"));
        assert!(verify(&changed, &key, &pin, &projects, NOW).is_err());
        assert!(verify(&frame, &key, &pin, &[], NOW).is_err());
        let authority = DispatchAuthority {
            client_id: Uuid::parse_str(frame["body"]["oauthClientId"].as_str().unwrap()).unwrap(),
            revision: &"ab".repeat(32),
        };
        let seen = HashSet::from([Uuid::parse_str(frame["requestId"].as_str().unwrap()).unwrap()]);
        assert!(verify_request(
            &signed(&frame, &key, "katosync-rc67-duplex-relay+jws"),
            &pin,
            &authority,
            2,
            NOW,
            NOW + 45000,
            &projects,
            &seen
        )
        .is_err());
    }
    #[tokio::test]
    async fn fixed_profile_runs_actual_git_without_creating_project_files() {
        let path = std::env::temp_dir().join(format!("katosync-cli-profile-{}", Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        let root = std::fs::canonicalize(&path).unwrap();
        let project = ApprovedProject {
            id: "test-project".into(),
            root,
        };
        let result = run(&project, Uuid::new_v4(), 8000).await.unwrap();
        assert!(result.stdout.starts_with("git version "));
        assert_eq!(result.exit_code, 0);
        assert!(result.stderr.is_empty());
        assert_eq!(std::fs::read_dir(&path).unwrap().count(), 0);
        assert!(run(&project, Uuid::new_v4(), 0).await.is_err());
        std::fs::remove_dir(&path).unwrap();
    }

    #[test]
    fn connector_signed_request_and_result_are_byte_identical() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/beta4_terminal_profile_wire.json"
        ))
        .unwrap();
        let ticket = &fixture["ticket"];
        let uuid = |field: &str| Uuid::parse_str(ticket[field].as_str().unwrap()).unwrap();
        let now = fixture["nowMs"].as_u64().unwrap();
        let bytes: [u8; 32] = URL_SAFE_NO_PAD
            .decode(fixture["serverPin"]["x"].as_str().unwrap())
            .unwrap()
            .try_into()
            .unwrap();
        let pin = PinnedServerContext {
            kid: fixture["serverPin"]["kid"].as_str().unwrap(),
            verifying_key: ed25519_dalek::VerifyingKey::from_bytes(&bytes).unwrap(),
            owner_id: uuid("ownerId"),
            tenant_id: uuid("tenantId"),
            grant_id: uuid("grantId"),
            device_id: uuid("deviceId"),
            session_id: uuid("sessionId"),
        };
        let authority = DispatchAuthority {
            client_id: uuid("oauthClientId"),
            revision: ticket["authorityRevision"].as_str().unwrap(),
        };
        let project = ApprovedProject {
            id: "katosync".into(),
            root: std::fs::canonicalize(std::env::temp_dir()).unwrap(),
        };
        let projects = [project];
        let request = fixture["requestJws"].as_str().unwrap();
        assert!(is_terminal_request(request));
        let verified = verify_request(
            request,
            &pin,
            &authority,
            2,
            now + 1600,
            ticket["expiresAtMs"].as_u64().unwrap(),
            &projects,
            &HashSet::new(),
        )
        .unwrap();
        assert_eq!(verified.execution_deadline_ms, now + 9500);
        assert_eq!(
            verified.arguments_sha256,
            fixture["operation"]["argumentsSha256"].as_str().unwrap()
        );
        assert_eq!(
            verified.device_proof_sha256,
            fixture["deviceProofSha256"].as_str().unwrap()
        );
        assert_eq!(
            verified.approval_expires_at,
            fixture["approvalResponse"]["expiresAtMs"].as_u64().unwrap()
        );
        assert!(verify_request(
            request,
            &pin,
            &authority,
            3,
            now + 1600,
            now + 45000,
            &projects,
            &HashSet::new()
        )
        .is_err());
        assert!(verify_request(
            request,
            &pin,
            &authority,
            2,
            now + 9500,
            now + 45000,
            &projects,
            &HashSet::new()
        )
        .is_err());
        assert!(verify_request(
            request,
            &pin,
            &authority,
            2,
            now + 1600,
            now + 45000,
            &projects,
            &HashSet::from([verified.request_id])
        )
        .is_err());
        assert!(verify_request(
            request,
            &pin,
            &DispatchAuthority {
                client_id: authority.client_id,
                revision: &"a".repeat(64)
            },
            2,
            now + 1600,
            now + 45000,
            &projects,
            &HashSet::new()
        )
        .is_err());
        let result = ProfileResult {
            operation_id: verified.operation_id,
            project_id: verified.project_id,
            profile_id: PROFILE,
            exit_code: 0,
            stdout: fixture["result"]["stdout"].as_str().unwrap().into(),
            stderr: "",
            provenance: "local_cli_profile_verified_root",
        };
        let key = SigningKey::from_bytes(&[fixture["deviceSeedByte"].as_u64().unwrap() as u8; 32]);
        let receipt = sign_result(
            &PresenceContext {
                owner_id: pin.owner_id,
                tenant_id: pin.tenant_id,
                grant_id: pin.grant_id,
                device_id: pin.device_id,
                session_id: pin.session_id,
                request_id: verified.request_id,
                challenge_id: uuid("challengeId"),
                key_id: ticket["deviceKeyId"].as_str().unwrap(),
                sequence: 2,
                issued_at_ms: (now + 1800) as i64,
                challenge_expires_at_ms: (now + 45000) as i64,
                revoke_epoch: ticket["revokeEpoch"].as_u64().unwrap(),
                native_tool_names: &[git_status::TOOL, TOOL],
            },
            &result,
            &key,
        )
        .unwrap();
        assert_eq!(receipt, fixture["resultJws"].as_str().unwrap());
        let ack = crate::mesh_rc72_signed_server_qa::verify_signed_server_notice(
            fixture["resultAck"]["serverProofJws"].as_str().unwrap(),
            &pin,
            crate::mesh_rc72_signed_server_qa::ExpectedServerNotice::ResultAccepted {
                request_id: verified.request_id,
                device_sequence: 2,
            },
            verified.sequence,
            now + 2100,
        )
        .unwrap();
        assert_eq!(ack.server_sequence, 4);
    }
}
