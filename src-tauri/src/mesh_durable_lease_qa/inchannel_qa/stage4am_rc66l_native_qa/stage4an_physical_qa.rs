//! Stage4AN physically separate M2 Pro ↔ M3 QA, native rustls only.
//! Private Tailscale listener and signed revoke; never a production command.
//! No actual RC66K grant, server authority, owner step-up or real Keychain pin.
use super::*;
use rand::RngCore;
use std::{
    env,
    net::{IpAddr, SocketAddr},
    time::{SystemTime, UNIX_EPOCH},
};

const PUB_FILE: &str = "device-public.json";
const PEER_FILE: &str = "peer-public.json";
const SCOPE_FILE: &str = "qa-scope.json";
const KEY_FILE: &str = "local-device.seed";
const ISSUER_FILE: &str = "local-issuer.seed";
const ACCEPTED_FILE: &str = "accepted-notice.jws";
const MAX_WAIT: Duration = Duration::from_secs(85);
fn clock() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
fn err() -> String {
    "STAGE4AN_PHYSICAL_NATIVE_QA_DENY".into()
}
fn qa_root(create: bool) -> Result<PathBuf, String> {
    let raw = env::var("STAGE4AN_ROOT").map_err(|_| err())?;
    if !raw.starts_with("/tmp/katosync-stage4an-") || raw.contains("/../") || raw.contains("/./") {
        return Err(err());
    }
    let p = PathBuf::from(raw);
    if create && !p.exists() {
        #[cfg(unix)]
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&p)
            .map_err(|_| err())?;
        #[cfg(not(unix))]
        fs::create_dir(&p).map_err(|_| err())?;
    }
    let st = fs::symlink_metadata(&p).map_err(|_| err())?;
    if !st.is_dir() || st.file_type().is_symlink() {
        return Err(err());
    }
    #[cfg(unix)]
    if st.permissions().mode() & 0o077 != 0 {
        return Err(err());
    }
    let canonical = p.canonicalize().map_err(|_| err())?;
    if !canonical
        .to_string_lossy()
        .starts_with("/private/tmp/katosync-stage4an-")
        && !canonical
            .to_string_lossy()
            .starts_with("/tmp/katosync-stage4an-")
    {
        return Err(err());
    }
    Ok(canonical)
}
fn create_file(root: &Path, name: &str, data: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut f = options.open(root.join(name)).map_err(|_| err())?;
    f.write_all(data)
        .and_then(|_| f.sync_all())
        .map_err(|_| err())?;
    File::open(root)
        .and_then(|f| f.sync_all())
        .map_err(|_| err())?;
    Ok(())
}
fn local_key(root: &Path, name: &str) -> Result<SigningKey, String> {
    let p = root.join(name);
    let st = fs::symlink_metadata(&p).map_err(|_| err())?;
    if !st.is_file() || st.file_type().is_symlink() {
        return Err(err());
    }
    #[cfg(unix)]
    if st.permissions().mode() & 0o077 != 0 {
        return Err(err());
    }
    let raw = fs::read(p).map_err(|_| err())?;
    let seed: [u8; 32] = raw.try_into().map_err(|_| err())?;
    Ok(SigningKey::from_bytes(&seed))
}
fn new_key(root: &Path, name: &str) -> Result<SigningKey, String> {
    let mut seed = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut seed);
    create_file(root, name, &seed)?;
    let out = SigningKey::from_bytes(&seed);
    seed.fill(0);
    Ok(out)
}
fn public_claim(
    role: &str,
    device: &SigningKey,
    issuer: Option<&SigningKey>,
) -> Result<Value, String> {
    let identity = DeviceTlsIdentity::from_signing_key(device).map_err(|_| err())?;
    Ok(json!({
        "kind":"KATOSYNC_STAGE4AN_PUBLIC_ONLY_QA","role":role,
        "publicKey":URL_SAFE_NO_PAD.encode(device.verifying_key().as_bytes()),
        "certificateDer":URL_SAFE_NO_PAD.encode(identity.certificate_der()),
        "issuerPublicKey":issuer.map(|k|URL_SAFE_NO_PAD.encode(k.verifying_key().as_bytes()))
            .unwrap_or_default()
    }))
}
fn read_pub(
    root: &Path,
    name: &str,
    expected_role: &str,
) -> Result<(VerifyingKey, Vec<u8>, String), String> {
    let data = fs::read(root.join(name)).map_err(|_| err())?;
    let v: Value = serde_json::from_slice(&data).map_err(|_| err())?;
    if !has_keys(
        &v,
        &[
            "kind",
            "role",
            "publicKey",
            "certificateDer",
            "issuerPublicKey",
        ],
    ) || v["kind"] != "KATOSYNC_STAGE4AN_PUBLIC_ONLY_QA"
        || v["role"] != expected_role
    {
        return Err(err());
    }
    let raw = URL_SAFE_NO_PAD
        .decode(v["publicKey"].as_str().ok_or_else(err)?)
        .map_err(|_| err())?;
    let raw: [u8; 32] = raw.try_into().map_err(|_| err())?;
    let peer = VerifyingKey::from_bytes(&raw).map_err(|_| err())?;
    let cert = URL_SAFE_NO_PAD
        .decode(v["certificateDer"].as_str().ok_or_else(err)?)
        .map_err(|_| err())?;
    let issuer = v["issuerPublicKey"].as_str().ok_or_else(err)?.to_string();
    Ok((peer, cert, issuer))
}
fn pin(key: &VerifyingKey) -> ApprovedPeer {
    ApprovedPeer {
        fingerprint: crate::mesh_identity::fingerprint(key),
        public_key: URL_SAFE_NO_PAD.encode(key.as_bytes()),
        approved_at: 1_800_000_000,
        status: "locally_approved".into(),
    }
}
fn setup() -> Result<(), String> {
    let root = qa_root(true)?;
    let role = env::var("STAGE4AN_NODE_ROLE").map_err(|_| err())?;
    if role != "sender" && role != "recipient" {
        return Err(err());
    }
    let device = new_key(&root, KEY_FILE)?;
    let issuer = if role == "sender" {
        Some(new_key(&root, ISSUER_FILE)?)
    } else {
        None
    };
    let v = public_claim(&role, &device, issuer.as_ref())?;
    create_file(&root, PUB_FILE, v.to_string().as_bytes())?;
    println!(
        "STAGE4AN_{}_EPHEMERAL_LOCAL_DEVICE_PREPARED_PUBLIC_ONLY",
        role.to_uppercase()
    );
    Ok(())
}
fn generate_scope() -> Result<(), String> {
    let root = qa_root(false)?;
    let sender = local_key(&root, KEY_FILE)?;
    let (recipient, _, _) = read_pub(&root, PEER_FILE, "recipient")?;
    let local = read_pub(&root, PUB_FILE, "sender")?.0;
    if local != sender.verifying_key() {
        return Err(err());
    }
    let owner = *Uuid::new_v4().as_bytes();
    let scope = QaScope {
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
        local_device_key: hex_digest(recipient.as_bytes()),
        peer_device_key: hex_digest(sender.verifying_key().as_bytes()),
        control_ack_hash: hex_digest(b"synthetic-rc66k-stage4an-NOT-server-authority"),
        sequence: 1,
    };
    create_file(&root, SCOPE_FILE, scope.expected().to_string().as_bytes())?;
    println!("STAGE4AN_PUBLIC_SYNTHETIC_SCOPE_CREATED_NO_PRODUCTION_CONSENT");
    Ok(())
}
fn load_scope(root: &Path) -> Result<QaScope, String> {
    let bytes = fs::read(root.join(SCOPE_FILE)).map_err(|_| err())?;
    let obj: Value = serde_json::from_slice(&bytes).map_err(|_| err())?;
    let s = |key: &str| -> Result<String, String> {
        obj.get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(err)
    };
    let scope = QaScope {
        audit_id: s("auditId")?,
        owner_id: s("ownerId")?,
        tenant_id: s("tenantId")?,
        grant_id: s("grantId")?,
        consent_id: s("consentId")?,
        device_id: s("deviceId")?,
        client_id: s("clientId")?,
        owner_session_id: s("ownerSessionId")?,
        project_id: s("projectId")?,
        task_id: s("taskId")?,
        local_device_key: s("localDeviceKey")?,
        peer_device_key: s("peerDeviceKey")?,
        control_ack_hash: s("controlPlaneAckSha256")?,
        sequence: obj["sequence"].as_u64().ok_or_else(err)?,
    };
    if obj != scope.expected() {
        return Err(err());
    }
    for key in [
        "auditId",
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
        if !valid_uuid(&obj, key) {
            return Err(err());
        }
    }
    Ok(scope)
}
fn address() -> Result<SocketAddr, String> {
    let addr: SocketAddr = env::var("STAGE4AN_TAILNET_ADDR")
        .map_err(|_| err())?
        .parse()
        .map_err(|_| err())?;
    let IpAddr::V4(ip) = addr.ip() else {
        return Err(err());
    };
    let o = ip.octets();
    if o[0] != 100 || !(64..=127).contains(&o[1]) || addr.port() < 49152 {
        return Err(err());
    }
    Ok(addr)
}
fn signing_key_match(
    me: &SigningKey,
    them: &VerifyingKey,
    s: &QaScope,
    recipient: bool,
) -> Result<(), String> {
    let local = hex_digest(me.verifying_key().as_bytes());
    let peer = hex_digest(them.as_bytes());
    if recipient {
        if local != s.local_device_key || peer != s.peer_device_key {
            return Err(err());
        }
    } else if local != s.peer_device_key || peer != s.local_device_key {
        return Err(err());
    }
    Ok(())
}
fn receipt_valid(
    jws: &str,
    s: &QaScope,
    original: &str,
    recipient: &VerifyingKey,
    now: u64,
) -> Result<(), String> {
    let v = verify_jws(jws, RECEIPT_TYP, "rc66l_recipient_M3_QA", recipient)
        .map_err(|_| "ACK_SIGNATURE_OR_PROTECTED_HEADER_INVALID".to_string())?;
    if !has_keys(&v, &RECEIPT_FIELDS) {
        return Err("ACK_FIELDS_INVALID".into());
    }
    for (key, expected) in [
        ("version", json!(1)),
        ("kind", json!(RECEIPT_KIND)),
        ("persisted", json!(true)),
        ("auditId", json!(s.audit_id)),
        ("deviceId", json!(s.device_id)),
        ("taskId", json!(s.task_id)),
        ("sequence", json!(s.sequence)),
        ("noticeSha256", json!(hex_digest(original.as_bytes()))),
    ] {
        if v[key] != expected {
            // Print only the failed FIELD NAME, never a token or secret.
            return Err(format!("ACK_SCOPE_FIELD_{}_INVALID", key));
        }
    }
    let issued = v["issuedAtMs"]
        .as_u64()
        .ok_or_else(|| "ACK_TIMESTAMP_INVALID".to_string())?;
    // Physical macOS peers can differ slightly despite synchronized clocks.
    // Permit at most +5s future skew for an independently device-signed ACK,
    // never extend its actual 15s age window, and never bypass scope checks.
    if issued > now.saturating_add(5_000) || now.saturating_sub(issued) > 15_000 {
        return Err("ACK_TIMESTAMP_OUT_OF_WINDOW".into());
    }
    Ok(())
}
fn negative(case: &str) -> bool {
    matches!(case, "wrong_issuer" | "wrong_task" | "truncated")
}
fn case() -> Result<String, String> {
    let c = env::var("STAGE4AN_CASE").map_err(|_| err())?;
    if c == "valid" || negative(&c) {
        Ok(c)
    } else {
        Err(err())
    }
}
async fn receiver(root: &Path) -> Result<(), String> {
    let local = local_key(root, KEY_FILE)?;
    let (server, cert, issuer_key) = read_pub(root, PEER_FILE, "sender")?;
    let scope = load_scope(root)?;
    signing_key_match(&local, &server, &scope, true)?;
    let issuer_raw: [u8; 32] = URL_SAFE_NO_PAD
        .decode(issuer_key)
        .map_err(|_| err())?
        .try_into()
        .map_err(|_| err())?;
    let issuer = VerifyingKey::from_bytes(&issuer_raw).map_err(|_| err())?;
    let scenario = case()?;
    // Prevent a previously revoked device from authenticating a new Mesh lease.
    if root.join(MARKER).exists() {
        return Err(err());
    }
    let owner = uuid_value(&scope.expected(), "ownerId")?;
    let io = timeout(Duration::from_secs(18), TcpStream::connect(address()?))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    let identity = DeviceTlsIdentity::from_signing_key(&local).map_err(|_| err())?;
    let cfg = strict_client_config(&identity, &pin(&server), &cert).map_err(|_| err())?;
    let mut tls = timeout(
        WAIT,
        TlsConnector::from(Arc::new(cfg)).connect(
            rustls::pki_types::ServerName::try_from(TLS_PEER_DNS_NAME).map_err(|_| err())?,
            io,
        ),
    )
    .await
    .map_err(|_| err())?
    .map_err(|_| err())?;
    if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err(err());
    }
    let a = nonce();
    let mut open = [0u8; 56];
    open[..8].copy_from_slice(OPEN);
    open[8..24].copy_from_slice(&owner);
    open[24..].copy_from_slice(&a);
    timeout(WAIT, tls.write_all(&open))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    let mut accepted = [0u8; 72];
    timeout(WAIT, tls.read_exact(&mut accepted))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    if &accepted[..8] != ACCEPT || accepted[8..40] != a {
        return Err(err());
    }
    let b = binding(
        owner,
        &local,
        &pin(&server),
        a,
        accepted[40..].try_into().map_err(|_| err())?,
    )
    .map_err(|_| err())?;
    let mut mesh = lease(b).map_err(|_| err())?;
    let mut beat = [0u8; 48];
    beat[..8].copy_from_slice(BEAT);
    beat[8..16].copy_from_slice(&1u64.to_be_bytes());
    beat[16..].copy_from_slice(&b.tls_session_nonce);
    timeout(WAIT, tls.write_all(&beat))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    let mut reply = [0u8; 48];
    timeout(WAIT, tls.read_exact(&mut reply))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    if &reply[..8] != REPLY
        || reply[8..] != beat[8..]
        || !mesh.on_verified_channel_heartbeat(
            VerifiedInChannelHeartbeat {
                binding: b,
                sequence: 1,
            },
            Instant::now(),
        )
    {
        return Err(err());
    }
    let mut first_notice: Option<String> = None;
    for turn in 0..if scenario == "valid" { 2 } else { 1 } {
        let frame = read_frame(&mut tls, MAGIC_REVOKE).await;
        let verified = frame.and_then(|notice| {
            validate_notice(&notice, &scope, &b, &issuer, clock()).map(|_| notice)
        });
        if negative(&scenario) {
            if verified.is_ok() {
                return Err(err());
            }
            mesh.revoked_or_owner_changed();
            if root.join(MARKER).exists() {
                return Err(err());
            }
            let _ = tls.shutdown().await;
            println!(
                "STAGE4AN_M3_NATIVE_NEGATIVE_{}_NO_DEVICE_ACK",
                scenario.to_uppercase()
            );
            return Ok(());
        }
        let notice = match verified {
            Ok(n) => n,
            Err(_) => {
                mesh.revoked_or_owner_changed();
                return Err(err());
            }
        };
        println!("STAGE4AN_M3_NOTICE_VERIFIED_TURN={turn}");
        if turn > 0 && first_notice.as_deref() != Some(notice.as_str()) {
            mesh.revoked_or_owner_changed();
            return Err(err());
        }
        mesh.revoked_or_owner_changed();
        persist_revoke(root, scope.sequence, &hex_digest(notice.as_bytes()))
            .map_err(|_| "STAGE4AN_DEVICE_JOURNAL_FAILURE".to_string())?;
        println!("STAGE4AN_M3_JOURNAL_FSYNC_PASS_TURN={turn}");
        if turn == 0 {
            create_file(root, ACCEPTED_FILE, notice.as_bytes())?;
            first_notice = Some(notice.clone());
        }
        let status = mesh.snapshot(Instant::now());
        if status.live_peer_authenticated
            || status.remote_jobs_enabled
            || status.remote_read_only_dispatch
        {
            return Err(err());
        }
        let receipt = json!({
          "version":1,"kind":RECEIPT_KIND,"auditId":scope.audit_id,
          "deviceId":scope.device_id,"taskId":scope.task_id,
          "sequence":scope.sequence,"noticeSha256":hex_digest(notice.as_bytes()),
          "persisted":true,"issuedAtMs":clock()
        });
        let ack = signed_jws(RECEIPT_TYP, "rc66l_recipient_M3_QA", &receipt, &local);
        write_frame(&mut tls, MAGIC_RECEIPT, &ack)
            .await
            .map_err(|_| "STAGE4AN_DEVICE_ACK_TRANSPORT_FAILURE".to_string())?;
        println!("STAGE4AN_M3_SIGNED_DEVICE_ACK_SENT_TURN={turn}");
    }
    let _ = tls.shutdown().await;
    println!("STAGE4AN_M3_NATIVE_MTLS_REVOKED_FSYNC_SIGNED_ACK_REPLAY_PASS");
    Ok(())
}
async fn sender(root: &Path) -> Result<(), String> {
    let local = local_key(root, KEY_FILE)?;
    let issuer = local_key(root, ISSUER_FILE)?;
    let (recipient, cert, _) = read_pub(root, PEER_FILE, "recipient")?;
    let scope = load_scope(root)?;
    signing_key_match(&local, &recipient, &scope, false)?;
    let owner = uuid_value(&scope.expected(), "ownerId")?;
    let scenario = case()?;
    let identity = DeviceTlsIdentity::from_signing_key(&local).map_err(|_| err())?;
    let cfg = strict_server_config(&identity, &pin(&recipient), &cert).map_err(|_| err())?;
    let listener = TcpListener::bind(address()?).await.map_err(|_| err())?;
    println!("STAGE4AN_M2_PRIVATE_TAILNET_TLS_LISTENING_CASE={scenario}");
    let (io, _) = timeout(MAX_WAIT, listener.accept())
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    let mut tls = timeout(WAIT, TlsAcceptor::from(Arc::new(cfg)).accept(io))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    if tls.get_ref().1.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3) {
        return Err(err());
    }
    let mut open = [0u8; 56];
    timeout(WAIT, tls.read_exact(&mut open))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    if &open[..8] != OPEN || open[8..24] != owner {
        return Err(err());
    }
    let a: [u8; 32] = open[24..].try_into().map_err(|_| err())?;
    let z = nonce();
    let b = binding(owner, &local, &pin(&recipient), a, z).map_err(|_| err())?;
    let mut mesh = lease(b).map_err(|_| err())?;
    let mut accepted = [0u8; 72];
    accepted[..8].copy_from_slice(ACCEPT);
    accepted[8..40].copy_from_slice(&a);
    accepted[40..].copy_from_slice(&z);
    timeout(WAIT, tls.write_all(&accepted))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    let mut beat = [0u8; 48];
    timeout(WAIT, tls.read_exact(&mut beat))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
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
        return Err(err());
    }
    let mut reply = [0u8; 48];
    reply[..8].copy_from_slice(REPLY);
    reply[8..].copy_from_slice(&beat[8..]);
    timeout(WAIT, tls.write_all(&reply))
        .await
        .map_err(|_| err())?
        .map_err(|_| err())?;
    let mut wrong = scope.clone();
    if scenario == "wrong_task" {
        wrong.task_id = Uuid::new_v4().to_string();
    }
    let outsider = if scenario == "wrong_issuer" {
        let mut seed = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut seed);
        Some(SigningKey::from_bytes(&seed))
    } else {
        None
    };
    let key = outsider.as_ref().unwrap_or(&issuer);
    let notice = prepare_signed_notice(&wrong, key, clock());
    if scenario == "truncated" {
        tls.write_all(MAGIC_REVOKE).await.map_err(|_| err())?;
        tls.write_all(&(notice.len() as u16).to_be_bytes())
            .await
            .map_err(|_| err())?;
        tls.write_all(&notice.as_bytes()[..7])
            .await
            .map_err(|_| err())?;
        let _ = tls.shutdown().await;
        println!("STAGE4AN_M2_NEGATIVE_TRUNCATED_FRAME_SENT");
        return Ok(());
    }
    for turn in 0..if scenario == "valid" { 2 } else { 1 } {
        write_frame(&mut tls, MAGIC_REVOKE, &notice)
            .await
            .map_err(|_| err())?;
        println!("STAGE4AN_M2_SIGNED_NOTICE_SENT_TURN={turn}");
        match read_frame(&mut tls, MAGIC_RECEIPT).await {
            Ok(ack) => {
                if scenario != "valid" {
                    return Err(err());
                }
                println!("STAGE4AN_M2_RECEIPT_ARRIVED_TURN={turn}");
                receipt_valid(&ack, &scope, &notice, &recipient, clock())
                    .map_err(|e| format!("STAGE4AN_M2_SIGNED_RECEIPT_INVALID_{e}"))?;
                println!("STAGE4AN_M2_RECEIPT_CRYPTO_VERIFIED_TURN={turn}");
            }
            Err(_) => {
                if scenario == "valid" {
                    return Err("STAGE4AN_M2_NO_DEVICE_RECEIPT".into());
                }
                println!("STAGE4AN_M2_NEGATIVE_{}_NO_ACK", scenario.to_uppercase());
                mesh.socket_closed();
                return Ok(());
            }
        }
    }
    mesh.socket_closed();
    if mesh.snapshot(Instant::now()).live_peer_authenticated {
        return Err(err());
    }
    println!("STAGE4AN_M2_NATIVE_TLS_TWO_SIGNED_DEVICE_RECEIPTS_PASS");
    Ok(())
}
fn reopen(root: &Path) -> Result<(), String> {
    let scope = load_scope(root)?;
    let marker = root.join(MARKER);
    let st = fs::symlink_metadata(&marker).map_err(|_| err())?;
    if !st.is_file() || st.file_type().is_symlink() {
        return Err(err());
    }
    #[cfg(unix)]
    if st.permissions().mode() & 0o077 != 0 {
        return Err(err());
    }
    let notice = fs::read(root.join(ACCEPTED_FILE)).map_err(|_| err())?;
    let expected = format!(
        "KatoSync-Stage4AM-native-RC66L-revoked-v1\n{}\n{}\n",
        scope.sequence,
        hex_digest(&notice)
    );
    if fs::read(&marker).map_err(|_| err())? != expected.as_bytes() {
        return Err(err());
    }
    println!("STAGE4AN_M3_NEW_PROCESS_PERSISTENT_REVOKE_PASS_NO_REMOTE");
    Ok(())
}
#[tokio::test]
async fn physical_stage4an_qa() {
    let Ok(action) = env::var("STAGE4AN_ACTION") else {
        return;
    };
    let result = match action.as_str() {
        "setup" => setup(),
        "scope" => generate_scope(),
        "sender" => match qa_root(false) {
            Ok(root) => sender(&root).await,
            Err(e) => Err(e),
        },
        "recipient" => match qa_root(false) {
            Ok(root) => receiver(&root).await,
            Err(e) => Err(e),
        },
        "reopen" => match qa_root(false) {
            Ok(root) => reopen(&root),
            Err(e) => Err(e),
        },
        _ => Err(err()),
    };
    assert!(
        result.is_ok(),
        "Stage4AN physical QA action {action}: {result:?}"
    );
}

#[test]
fn signed_physical_ack_validation_is_independent_of_transport() {
    let recipient = SigningKey::from_bytes(&[61; 32]);
    let sender = SigningKey::from_bytes(&[62; 32]);
    let issuer = SigningKey::from_bytes(&[63; 32]);
    let owner = *Uuid::new_v4().as_bytes();
    let scope = scope_for(owner, &recipient, &sender);
    let notice = prepare_signed_notice(&scope, &issuer, clock());
    let body = json!({
      "version":1,"kind":RECEIPT_KIND,"auditId":scope.audit_id,
      "deviceId":scope.device_id,"taskId":scope.task_id,
      "sequence":scope.sequence,"noticeSha256":hex_digest(notice.as_bytes()),
      "persisted":true,"issuedAtMs":clock()
    });
    let signed = signed_jws(RECEIPT_TYP, "rc66l_recipient_M3_QA", &body, &recipient);
    let got = receipt_valid(
        &signed,
        &scope,
        &notice,
        &recipient.verifying_key(),
        clock(),
    );
    assert!(got.is_ok(), "Native signed ACK fixture must pass: {got:?}");
}

#[test]
fn signed_ack_bounded_clock_skew_accepts_four_seconds_and_denies_six() {
    let recipient = SigningKey::from_bytes(&[71; 32]);
    let sender = SigningKey::from_bytes(&[72; 32]);
    let issuer = SigningKey::from_bytes(&[73; 32]);
    let scope = scope_for(*Uuid::new_v4().as_bytes(), &recipient, &sender);
    let now = clock();
    let notice = prepare_signed_notice(&scope, &issuer, now);
    for (offset, should_allow) in [(4_000u64, true), (6_000u64, false)] {
        let body = json!({
          "version":1,"kind":RECEIPT_KIND,"auditId":scope.audit_id,
          "deviceId":scope.device_id,"taskId":scope.task_id,
          "sequence":scope.sequence,"noticeSha256":hex_digest(notice.as_bytes()),
          "persisted":true,"issuedAtMs":now+offset
        });
        let signed = signed_jws(RECEIPT_TYP, "rc66l_recipient_M3_QA", &body, &recipient);
        let accepted =
            receipt_valid(&signed, &scope, &notice, &recipient.verifying_key(), now).is_ok();
        assert_eq!(
            accepted, should_allow,
            "bounded future skew offset={offset}"
        );
    }
}
