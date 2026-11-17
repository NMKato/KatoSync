// Stage4AM — native RC66L QA on the ORIGINAL pinned rustls/ChannelBinding.
// Stage4AN physical two-host QA is a private test-only CHILD module.
// Entire module is reachable only from #[cfg(test)] in inchannel_qa.rs.
// No production service, Keychain mutation, Remote-MCP tool or OS command.
use super::*;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Signer, Verifier, VerifyingKey};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use tokio::net::TcpListener;
use uuid::Uuid;

const MAGIC_REVOKE: &[u8; 8] = b"KAMREV01";
const MAGIC_RECEIPT: &[u8; 8] = b"KAMACK01";
const NOTICE_TYP: &str = "katosync-rc66l-qa-mesh-device-revoke+jws";
const RECEIPT_TYP: &str = "katosync-rc66l-qa-device-persisted+jws";
const NOTICE_KIND: &str = "RC66L_QA_PINNED_MESH_DEVICE_REVOKE";
const RECEIPT_KIND: &str = "RC66L_QA_DEVICE_PERSISTENCE_RECEIPT";
const MAX_JWS: usize = 4096;
const T: u64 = 1_800_000_000_000;
const MARKER: &str = "rc66l-native-revoked.lock";

fn denied() -> String {
    "STAGE4AM_NATIVE_RC66L_DENIED".into()
}
fn hex_digest(buf: &[u8]) -> String {
    Sha256::digest(buf)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn valid_uuid(v: &Value, key: &str) -> bool {
    v.get(key)
        .and_then(Value::as_str)
        .and_then(|s| Uuid::parse_str(s).ok())
        .is_some()
}
fn uuid_value(v: &Value, key: &str) -> Result<[u8; 16], String> {
    let s = v.get(key).and_then(Value::as_str).ok_or_else(denied)?;
    Ok(*Uuid::parse_str(s).map_err(|_| denied())?.as_bytes())
}
fn has_keys(v: &Value, fields: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|m| m.len() == fields.len() && fields.iter().all(|key| m.contains_key(*key)))
}
fn signed_jws(typ: &str, kid: &str, payload: &Value, key: &SigningKey) -> String {
    let h = URL_SAFE_NO_PAD.encode(json!({"alg":"EdDSA","kid":kid,"typ":typ}).to_string());
    let p = URL_SAFE_NO_PAD.encode(payload.to_string());
    let input = format!("{h}.{p}");
    let signature = key.sign(input.as_bytes());
    format!("{input}.{}", URL_SAFE_NO_PAD.encode(signature.to_bytes()))
}
fn verify_jws(jws: &str, typ: &str, kid: &str, key: &VerifyingKey) -> Result<Value, String> {
    if jws.len() > MAX_JWS
        || kid.len() < 8
        || kid.len() > 80
        || !kid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(denied());
    }
    let parts: Vec<_> = jws.split('.').collect();
    if parts.len() != 3 || parts[2].len() != 86 {
        return Err(denied());
    }
    let header = URL_SAFE_NO_PAD.decode(parts[0]).map_err(|_| denied())?;
    let header: Value = serde_json::from_slice(&header).map_err(|_| denied())?;
    if !has_keys(&header, &["alg", "kid", "typ"])
        || header["alg"] != "EdDSA"
        || header["typ"] != typ
        || header["kid"] != kid
    {
        return Err(denied());
    }
    let sig: [u8; 64] = URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| denied())?
        .try_into()
        .map_err(|_| denied())?;
    key.verify(
        format!("{}.{}", parts[0], parts[1]).as_bytes(),
        &Signature::from_bytes(&sig),
    )
    .map_err(|_| denied())?;
    let raw = URL_SAFE_NO_PAD.decode(parts[1]).map_err(|_| denied())?;
    if raw.len() > 2048 {
        return Err(denied());
    }
    // RC66L signs JSON.stringify() bytes in insertion order; serde_json's
    // Value serializes map keys in a different order. The Ed25519 signature
    // authenticates the ORIGINAL bytes, so do not reject valid JS wire JSON
    // just because Rust serializes the same claims in a different order.
    let v: Value = serde_json::from_slice(&raw).map_err(|_| denied())?;
    Ok(v)
}
const NOTICE_FIELDS: [&str; 20] = [
    "version",
    "kind",
    "auditId",
    "workerId",
    "leaseToken",
    "ownerId",
    "tenantId",
    "grantId",
    "consentId",
    "deviceId",
    "clientId",
    "ownerSessionId",
    "projectId",
    "taskId",
    "localDeviceKey",
    "peerDeviceKey",
    "sequence",
    "controlPlaneAckSha256",
    "issuedAtMs",
    "expiresAtMs",
];
const RECEIPT_FIELDS: [&str; 9] = [
    "version",
    "kind",
    "auditId",
    "deviceId",
    "taskId",
    "sequence",
    "noticeSha256",
    "persisted",
    "issuedAtMs",
];

#[derive(Clone)]
struct QaScope {
    audit_id: String,
    owner_id: String,
    tenant_id: String,
    grant_id: String,
    consent_id: String,
    device_id: String,
    client_id: String,
    owner_session_id: String,
    project_id: String,
    task_id: String,
    local_device_key: String,
    peer_device_key: String,
    control_ack_hash: String,
    sequence: u64,
}
impl QaScope {
    fn expected(&self) -> Value {
        json!({
            "auditId":self.audit_id,"ownerId":self.owner_id,
            "tenantId":self.tenant_id,"grantId":self.grant_id,
            "consentId":self.consent_id,"deviceId":self.device_id,
            "clientId":self.client_id,"ownerSessionId":self.owner_session_id,
            "projectId":self.project_id,"taskId":self.task_id,
            "localDeviceKey":self.local_device_key,
            "peerDeviceKey":self.peer_device_key,
            "controlPlaneAckSha256":self.control_ack_hash,
            "sequence":self.sequence,
        })
    }
}
fn validate_notice(
    jws: &str,
    scope: &QaScope,
    b: &ChannelBinding,
    pin: &VerifyingKey,
    now: u64,
) -> Result<Value, String> {
    let v = verify_jws(jws, NOTICE_TYP, "rc66l_server_issuer_QA", pin)?;
    if !has_keys(&v, &NOTICE_FIELDS) || v["version"] != 1 || v["kind"] != NOTICE_KIND {
        return Err(denied());
    }
    let fields = scope.expected();
    let obj = fields.as_object().ok_or_else(denied)?;
    if obj.iter().any(|(k, value)| v[k] != *value) {
        return Err(denied());
    }
    for k in [
        "auditId",
        "workerId",
        "leaseToken",
        "ownerId",
        "tenantId",
        "grantId",
        "consentId",
        "deviceId",
        "clientId",
        "ownerSessionId",
        "projectId",
        "taskId",
    ] {
        if !valid_uuid(&v, k) {
            return Err(denied());
        }
    }
    if uuid_value(&v, "ownerId")? != b.owner_id
        || v["localDeviceKey"] != hex_digest(&b.local_ed25519)
        || v["peerDeviceKey"] != hex_digest(&b.peer_ed25519)
        || b.tls_session_nonce.iter().all(|x| *x == 0)
    {
        return Err(denied());
    }
    if scope.local_device_key == scope.peer_device_key
        || scope.sequence == 0
        || scope.control_ack_hash.len() != 64
        || !scope
            .control_ack_hash
            .bytes()
            .all(|x| x.is_ascii_hexdigit() && !x.is_ascii_uppercase())
    {
        return Err(denied());
    }
    let issued = v["issuedAtMs"].as_u64().ok_or_else(denied)?;
    let expires = v["expiresAtMs"].as_u64().ok_or_else(denied)?;
    if issued > now
        || now.saturating_sub(issued) > 15_000
        || expires <= now
        || expires.saturating_sub(issued) != 15_000
    {
        return Err(denied());
    }
    Ok(v)
}
fn persist_revoke(dir: &Path, seq: u64, digest: &str) -> Result<(), String> {
    let stat = fs::symlink_metadata(dir).map_err(|_| denied())?;
    if !stat.is_dir()
        || stat.file_type().is_symlink()
        || dir.canonicalize().map_err(|_| denied())? != dir
    {
        return Err(denied());
    }
    #[cfg(unix)]
    if stat.permissions().mode() & 0o077 != 0 {
        return Err(denied());
    }
    let mark = dir.join(MARKER);
    let data = format!("KatoSync-Stage4AM-native-RC66L-revoked-v1\n{seq}\n{digest}\n");
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut f = match options.open(&mark) {
        Ok(x) => x,
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            let st = fs::symlink_metadata(&mark).map_err(|_| denied())?;
            #[cfg(unix)]
            if st.permissions().mode() & 0o077 != 0 {
                return Err(denied());
            }
            if !st.is_file()
                || st.file_type().is_symlink()
                || fs::read(&mark).map_err(|_| denied())? != data.as_bytes()
            {
                return Err(denied());
            }
            return Ok(());
        }
        Err(_) => return Err(denied()),
    };
    f.write_all(data.as_bytes()).map_err(|_| denied())?;
    f.sync_all().map_err(|_| denied())?;
    File::open(dir)
        .and_then(|d| d.sync_all())
        .map_err(|_| denied())?;
    Ok(())
}
fn prepare_signed_notice(scope: &QaScope, issuer: &SigningKey, now: u64) -> String {
    let mut fields = scope.expected();
    for (k, v) in [
        ("version", json!(1)),
        ("kind", json!(NOTICE_KIND)),
        ("workerId", json!(Uuid::new_v4().to_string())),
        ("leaseToken", json!(Uuid::new_v4().to_string())),
        ("issuedAtMs", json!(now - 100)),
        ("expiresAtMs", json!(now + 14_900)),
    ] {
        fields[k] = v;
    }
    // Mirror the exact key insertion order of the RC66L Node broker's
    // JSON.stringify() notice, rather than serde_json's sorted object order.
    const JS_ORDER: [&str; 20] = [
        "version",
        "kind",
        "auditId",
        "workerId",
        "leaseToken",
        "ownerId",
        "grantId",
        "consentId",
        "deviceId",
        "tenantId",
        "clientId",
        "ownerSessionId",
        "projectId",
        "taskId",
        "localDeviceKey",
        "peerDeviceKey",
        "sequence",
        "controlPlaneAckSha256",
        "issuedAtMs",
        "expiresAtMs",
    ];
    let body = format!(
        "{{{}}}",
        JS_ORDER
            .iter()
            .map(|k| { format!("{}:{}", serde_json::to_string(k).unwrap(), fields[*k]) })
            .collect::<Vec<_>>()
            .join(",")
    );
    let h = URL_SAFE_NO_PAD
        .encode(json!({"alg":"EdDSA","kid":"rc66l_server_issuer_QA","typ":NOTICE_TYP}).to_string());
    let p = URL_SAFE_NO_PAD.encode(body.as_bytes());
    let input = format!("{h}.{p}");
    format!(
        "{input}.{}",
        URL_SAFE_NO_PAD.encode(issuer.sign(input.as_bytes()).to_bytes())
    )
}
async fn write_frame<W: AsyncWriteExt + Unpin>(
    io: &mut W,
    magic: &[u8; 8],
    msg: &str,
) -> Result<(), String> {
    if msg.len() > MAX_JWS {
        return Err(denied());
    }
    let len = (msg.len() as u16).to_be_bytes();
    timeout(WAIT, async {
        io.write_all(magic).await?;
        io.write_all(&len).await?;
        io.write_all(msg.as_bytes()).await?;
        io.flush().await
    })
    .await
    .map_err(|_| denied())?
    .map_err(|_| denied())
}
async fn read_frame<R: AsyncReadExt + Unpin>(
    io: &mut R,
    magic: &[u8; 8],
) -> Result<String, String> {
    let mut h = [0u8; 10];
    timeout(WAIT, io.read_exact(&mut h))
        .await
        .map_err(|_| denied())?
        .map_err(|_| denied())?;
    if &h[..8] != magic {
        return Err(denied());
    }
    let length = u16::from_be_bytes([h[8], h[9]]) as usize;
    if length == 0 || length > MAX_JWS {
        return Err(denied());
    }
    let mut frame = vec![0u8; length];
    timeout(WAIT, io.read_exact(&mut frame))
        .await
        .map_err(|_| denied())?
        .map_err(|_| denied())?;
    String::from_utf8(frame).map_err(|_| denied())
}
fn valid_receipt(
    jws: &str,
    scope: &QaScope,
    notice: &str,
    device: &VerifyingKey,
) -> Result<(), String> {
    let v = verify_jws(jws, RECEIPT_TYP, "rc66l_recipient_M3_QA", device)?;
    if !has_keys(&v, &RECEIPT_FIELDS)
        || v["version"] != 1
        || v["kind"] != RECEIPT_KIND
        || v["persisted"] != true
        || v["auditId"] != scope.audit_id
        || v["deviceId"] != scope.device_id
        || v["taskId"] != scope.task_id
        || v["sequence"] != scope.sequence
        || v["noticeSha256"] != hex_digest(notice.as_bytes())
        || v["issuedAtMs"] != T
    {
        return Err(denied());
    }
    Ok(())
}
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("katosync-stage4am-{}", Uuid::new_v4()));
        #[cfg(unix)]
        fs::DirBuilder::new().mode(0o700).create(&p).unwrap();
        #[cfg(not(unix))]
        fs::create_dir(&p).unwrap();
        Self(p.canonicalize().unwrap())
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn pinned(k: &SigningKey) -> ApprovedPeer {
    ApprovedPeer {
        fingerprint: crate::mesh_identity::fingerprint(&k.verifying_key()),
        public_key: URL_SAFE_NO_PAD.encode(k.verifying_key().as_bytes()),
        approved_at: 1_800_000_000,
        status: "locally_approved".into(),
    }
}
fn scope_for(owner: [u8; 16], recipient: &SigningKey, sender: &SigningKey) -> QaScope {
    QaScope {
        audit_id: Uuid::new_v4().to_string(),
        owner_id: Uuid::from_bytes(owner).to_string(),
        tenant_id: Uuid::new_v4().to_string(),
        grant_id: Uuid::new_v4().to_string(),
        consent_id: Uuid::new_v4().to_string(),
        device_id: Uuid::new_v4().to_string(),
        client_id: Uuid::new_v4().to_string(),
        owner_session_id: Uuid::new_v4().to_string(),
        project_id: Uuid::new_v4().to_string(),
        task_id: Uuid::new_v4().to_string(),
        local_device_key: hex_digest(recipient.verifying_key().as_bytes()),
        peer_device_key: hex_digest(sender.verifying_key().as_bytes()),
        control_ack_hash: hex_digest(b"synthetic-RC66K-ack-NOT-AUTHORITY"),
        sequence: 7,
    }
}
#[derive(Clone, Copy, Debug)]
enum TestMode {
    Accept,
    WrongSigner,
    WrongTask,
    WrongOwner,
    Truncated,
}
async fn physical_loopback_pair(
    mode: TestMode,
    root: &Path,
) -> (Result<(), String>, Result<(), String>) {
    let recipient = SigningKey::from_bytes(&[41; 32]);
    let sender = SigningKey::from_bytes(&[42; 32]);
    let issuer = SigningKey::from_bytes(&[91; 32]);
    let intruder = SigningKey::from_bytes(&[92; 32]);
    let owner = *Uuid::new_v4().as_bytes();
    let scope = scope_for(owner, &recipient, &sender);
    let recipient_id = DeviceTlsIdentity::from_signing_key(&recipient).unwrap();
    let sender_id = DeviceTlsIdentity::from_signing_key(&sender).unwrap();
    let client_cfg =
        strict_client_config(&recipient_id, &pinned(&sender), sender_id.certificate_der()).unwrap();
    let server_cfg = strict_server_config(
        &sender_id,
        &pinned(&recipient),
        recipient_id.certificate_der(),
    )
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (client_io, accepted) = tokio::join!(TcpStream::connect(addr), listener.accept());
    let mut receiver_socket = TlsConnector::from(Arc::new(client_cfg)).connect(
        rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).unwrap(),
        client_io.unwrap(),
    );
    let mut sender_socket = TlsAcceptor::from(Arc::new(server_cfg)).accept(accepted.unwrap().0);
    // Drive BOTH sides of the mutual TLS handshake together.
    let (c, s) = tokio::join!(receiver_socket, sender_socket);
    let mut c = c.unwrap();
    let mut s = s.unwrap();
    let scope_client = scope.clone();
    let scope_server = scope.clone();
    let client_recipient = recipient.clone();
    let client_sender = sender.clone();
    let client_issuer = issuer.verifying_key();
    let client = async move {
        if c.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
            return Err(denied());
        }
        let a = nonce();
        let mut open = [0u8; 56];
        open[..8].copy_from_slice(OPEN);
        open[8..24].copy_from_slice(&owner);
        open[24..].copy_from_slice(&a);
        c.write_all(&open).await.map_err(|_| denied())?;
        let mut accepted = [0u8; 72];
        c.read_exact(&mut accepted).await.map_err(|_| denied())?;
        if &accepted[..8] != ACCEPT || accepted[8..40] != a {
            return Err(denied());
        }
        let b = binding(
            owner,
            &client_recipient,
            &pinned(&client_sender),
            a,
            accepted[40..].try_into().unwrap(),
        )?;
        let mut mesh = lease(b)?;
        let mut beat = [0u8; 48];
        beat[..8].copy_from_slice(BEAT);
        beat[8..16].copy_from_slice(&1u64.to_be_bytes());
        beat[16..].copy_from_slice(&b.tls_session_nonce);
        c.write_all(&beat).await.map_err(|_| denied())?;
        let mut reply = [0u8; 48];
        c.read_exact(&mut reply).await.map_err(|_| denied())?;
        if &reply[..8] != REPLY
            || reply[8..] != beat[8..]
            || !mesh.on_verified_channel_heartbeat(
                VerifiedInChannelHeartbeat {
                    binding: b,
                    sequence: 1,
                },
                Instant::now(),
            )
            || !mesh.snapshot(Instant::now()).live_peer_authenticated
        {
            return Err(denied());
        }
        let notice = match read_frame(&mut c, MAGIC_REVOKE).await {
            Ok(frame) => frame,
            Err(error) => {
                mesh.revoked_or_owner_changed();
                return Err(error);
            }
        };
        if let Err(error) = validate_notice(&notice, &scope_client, &b, &client_issuer, T) {
            mesh.revoked_or_owner_changed();
            return Err(error);
        }
        // Fail closed on the ACTUAL canonical runtime lease, before fsync.
        mesh.revoked_or_owner_changed();
        persist_revoke(root, scope_client.sequence, &hex_digest(notice.as_bytes()))?;
        if mesh.snapshot(Instant::now()).live_peer_authenticated
            || mesh.snapshot(Instant::now()).remote_jobs_enabled
        {
            return Err(denied());
        }
        let receipt = json!({
            "version":1,"kind":RECEIPT_KIND,"auditId":scope_client.audit_id,
            "deviceId":scope_client.device_id,"taskId":scope_client.task_id,
            "sequence":scope_client.sequence,"noticeSha256":hex_digest(notice.as_bytes()),
            "persisted":true,"issuedAtMs":T
        });
        let signed = signed_jws(
            RECEIPT_TYP,
            "rc66l_recipient_M3_QA",
            &receipt,
            &client_recipient,
        );
        write_frame(&mut c, MAGIC_RECEIPT, &signed).await?;
        Ok(())
    };
    let server = async move {
        if s.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
            return Err(denied());
        }
        let mut open = [0u8; 56];
        s.read_exact(&mut open).await.map_err(|_| denied())?;
        if &open[..8] != OPEN || open[8..24] != owner {
            return Err(denied());
        }
        let a: [u8; 32] = open[24..].try_into().unwrap();
        let nonce_server = nonce();
        let b = binding(owner, &sender, &pinned(&recipient), a, nonce_server)?;
        let mut mesh = lease(b)?;
        let mut accepted = [0u8; 72];
        accepted[..8].copy_from_slice(ACCEPT);
        accepted[8..40].copy_from_slice(&a);
        accepted[40..].copy_from_slice(&nonce_server);
        s.write_all(&accepted).await.map_err(|_| denied())?;
        let mut beat = [0u8; 48];
        s.read_exact(&mut beat).await.map_err(|_| denied())?;
        if &beat[..8] != BEAT
            || beat[16..] != b.tls_session_nonce
            || !mesh.on_verified_channel_heartbeat(
                VerifiedInChannelHeartbeat {
                    binding: b,
                    sequence: 1,
                },
                Instant::now(),
            )
        {
            return Err(denied());
        }
        let mut reply = [0u8; 48];
        reply[..8].copy_from_slice(REPLY);
        reply[8..].copy_from_slice(&beat[8..]);
        s.write_all(&reply).await.map_err(|_| denied())?;
        let mut wrong = scope_server.clone();
        if matches!(mode, TestMode::WrongTask) {
            wrong.task_id = Uuid::new_v4().to_string();
        }
        if matches!(mode, TestMode::WrongOwner) {
            wrong.owner_id = Uuid::new_v4().to_string();
        }
        let signer = if matches!(mode, TestMode::WrongSigner) {
            &intruder
        } else {
            &issuer
        };
        let notice = prepare_signed_notice(&wrong, signer, T);
        if matches!(mode, TestMode::Truncated) {
            // Authenticated peer deliberately drops after partial frame.
            s.write_all(MAGIC_REVOKE).await.map_err(|_| denied())?;
            s.write_all(&[0, 240]).await.map_err(|_| denied())?;
            s.write_all(&notice.as_bytes()[..8])
                .await
                .map_err(|_| denied())?;
            s.shutdown().await.map_err(|_| denied())?;
            return Ok(());
        }
        write_frame(&mut s, MAGIC_REVOKE, &notice).await?;
        let reply = read_frame(&mut s, MAGIC_RECEIPT).await?;
        valid_receipt(&reply, &scope_server, &notice, &recipient.verifying_key())?;
        mesh.socket_closed();
        if mesh.snapshot(Instant::now()).live_peer_authenticated {
            return Err(denied());
        }
        Ok(())
    };
    tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, server)
    })
    .await
    .unwrap_or_else(|_| (Err(denied()), Err(denied())))
}
#[tokio::test]
async fn real_pinned_native_rustls_heartbeat_revoke_fsync_and_signed_device_receipt() {
    let dir = Temp::new();
    let (c, s) = physical_loopback_pair(TestMode::Accept, &dir.0).await;
    assert!(c.is_ok(), "{c:?}");
    assert!(s.is_ok(), "{s:?}");
    assert!(fs::read_to_string(dir.0.join(MARKER))
        .unwrap()
        .starts_with("KatoSync-Stage4AM-native-RC66L-revoked-v1"));
}
#[tokio::test]
async fn forged_issuer_or_task_or_owner_on_live_pinned_tls_never_persists() {
    for mode in [
        TestMode::WrongSigner,
        TestMode::WrongTask,
        TestMode::WrongOwner,
    ] {
        let dir = Temp::new();
        let (c, _s) = physical_loopback_pair(mode, &dir.0).await;
        assert!(c.is_err(), "{mode:?}");
        assert!(!dir.0.join(MARKER).exists());
    }
}
#[tokio::test]
async fn truncated_authenticated_tls_frame_cannot_generate_persisted_receipt() {
    let dir = Temp::new();
    let (c, _s) = physical_loopback_pair(TestMode::Truncated, &dir.0).await;
    assert!(c.is_err());
    assert!(!dir.0.join(MARKER).exists());
}
#[test]
fn replay_exactly_same_pinned_message_idempotent_but_changed_sequence_denied() {
    let dir = Temp::new();
    let hash = hex_digest(b"original-signed-frame");
    assert!(persist_revoke(&dir.0, 7, &hash).is_ok());
    assert!(persist_revoke(&dir.0, 7, &hash).is_ok());
    assert!(persist_revoke(&dir.0, 8, &hash).is_err());
    assert!(persist_revoke(&dir.0, 7, &hex_digest(b"changed")).is_err());
}
#[test]
fn corrupted_or_symlinked_marker_remains_poisoned_not_a_grant() {
    let dir = Temp::new();
    let p = dir.0.join(MARKER);
    fs::write(&p, b"partial").unwrap();
    assert!(persist_revoke(&dir.0, 7, &hex_digest(b"msg")).is_err());
    fs::remove_file(&p).unwrap();
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("not-found", &p).unwrap();
        assert!(persist_revoke(&dir.0, 7, &hex_digest(b"msg")).is_err());
    }
}

// Stage4AN: physically separate M2 Pro and M3, no production runtime entry.
#[cfg(test)]
#[path = "stage4am_rc66l_native_qa/stage4an_physical_qa.rs"]
mod stage4an_physical_qa;
