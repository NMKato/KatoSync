// Created by NMKato Solutions
//! Signierte Kanal-Metadaten fuer die R2-Modellverteilung (minimal, TUF-artig).
//!
//! Ein Kanalindex (`channels/<channel>/index.json`) ist nur ein signierter Umschlag
//! (DSSE-Form): `payloadType`, Base64-`payload`, `signatures[{keyid, sig}]`. Signiert wird die
//! DSSE-Pre-Authentication-Encoding der exakten Payload-Bytes mit Ed25519. Lokal wird vor jeder
//! Annahme geprueft:
//!
//! 1. Groessenlimit, Umschlag-/Payload-Typ, Signaturen gegen offline gepinnte Root-Schluessel
//!    (Schwelle; unbekannte Schluessel zaehlen nie),
//! 2. erst danach Payload-Parsing: Schema, Kanal, monotone `version`, `expires`,
//! 3. Rollback-Schutz: `version` darf nie unter die zuletzt akzeptierte fallen; gleiche
//!    Version mit anderem Payload-Hash ist ein Fork und wird verworfen,
//! 4. jeder Paketeintrag besteht `ModelPackage::validate` (inkl. Lizenz-Release-Gate) und
//!    ist pro `packageId@version` eindeutig.
//!
//! Nur `VerifiedIndex::select` oder das eingebettete App-Manifest erzeugen ein
//! `TrustedPackage`; Download-Quellen und Promote akzeptieren nichts anderes.

use crate::model_distribution::{
    self as dist, Channel, DistributionBase, ModelPackage, OriginPolicy, SemVer,
};
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

pub const SIGNED_INDEX_SCHEMA: &str = "kato-model-index/2";
pub const INDEX_PAYLOAD_TYPE: &str = "application/vnd.katosync.model-index+json";
pub const MAX_METADATA_BYTES: usize = 1024 * 1024;
const MAX_SIGNATURES: usize = 16;
const TRUST_STATE_SCHEMA_VERSION: u32 = 1;
const DEV_EXPIRY_OVERRIDE_ENV: &str = "KATOSYNC_DEV_ALLOW_EXPIRED_MODEL_METADATA";

/// Offline-Root-Schluessel (Ed25519, 32 Byte Rohformat, Hex). Bewusst leer, bis der erste
/// Release-Schluessel offline erzeugt und hier gepinnt ist: ohne gepinnten Schluessel ist der
/// signierte R2-Kanal deaktiviert (fail closed). Rotation erfolgt ueber ein App-Update.
const PINNED_ROOT_KEYS_HEX: &[&str] = &[];
const PINNED_ROOT_THRESHOLD: usize = 1;

// ---------------------------------------------------------------------------------------
// Vertrauensanker
// ---------------------------------------------------------------------------------------

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn decode_hex(raw: &str) -> Option<Vec<u8>> {
    if !raw.len().is_multiple_of(2) {
        return None;
    }
    (0..raw.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(raw.get(i..i + 2)?, 16).ok())
        .collect()
}

/// Schluessel-ID = SHA-256 (hex) des rohen Ed25519-Public-Keys.
pub fn key_id(public_key: &[u8]) -> String {
    sha256_hex(public_key)
}

#[derive(Debug, Clone)]
struct TrustedKey {
    key_id: String,
    public_key: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct TrustRoot {
    keys: Vec<TrustedKey>,
    threshold: usize,
}

impl TrustRoot {
    pub fn new(public_keys_hex: &[&str], threshold: usize) -> Result<Self> {
        let mut keys: Vec<TrustedKey> = Vec::new();
        for raw in public_keys_hex {
            let public_key = decode_hex(raw.trim())
                .filter(|bytes| bytes.len() == 32)
                .ok_or_else(|| anyhow!("Root-Schluessel muss 32 Byte Ed25519 (hex) sein"))?;
            let key_id = key_id(&public_key);
            if keys.iter().any(|key| key.key_id == key_id) {
                bail!("Root-Schluessel ist doppelt gepinnt");
            }
            keys.push(TrustedKey { key_id, public_key });
        }
        if threshold == 0 || threshold > keys.len() {
            bail!(
                "Signaturschwelle {threshold} passt nicht zu {} Root-Schluesseln",
                keys.len()
            );
        }
        Ok(Self { keys, threshold })
    }

    /// In die App kompilierter Vertrauensanker. Ohne gepinnten Schluessel: Fehler.
    pub fn production() -> Result<Self> {
        if PINNED_ROOT_KEYS_HEX.is_empty() {
            bail!("Kein Offline-Root-Schluessel gepinnt; signierter Modellkanal ist deaktiviert");
        }
        Self::new(PINNED_ROOT_KEYS_HEX, PINNED_ROOT_THRESHOLD)
    }

    fn key(&self, key_id: &str) -> Option<&TrustedKey> {
        self.keys.iter().find(|key| key.key_id == key_id)
    }
}

// ---------------------------------------------------------------------------------------
// Umschlag und Payload
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedEnvelope {
    pub payload_type: String,
    pub payload: String,
    pub signatures: Vec<EnvelopeSignature>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct EnvelopeSignature {
    pub keyid: String,
    pub sig: String,
}

/// Signierter Inhalt von `channels/<channel>/index.json`.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignedIndexPayload {
    pub schema: String,
    pub channel: Channel,
    /// Monotoner Zaehler; jede Veroeffentlichung erhoeht ihn.
    pub version: u64,
    /// RFC 3339; danach gilt der Index als eingefroren/abgelaufen.
    pub expires: String,
    pub packages: Vec<ModelPackage>,
}

/// DSSE v1 Pre-Authentication-Encoding.
pub fn pae(payload_type: &str, payload: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "DSSEv1 {} {} {} ",
        payload_type.len(),
        payload_type,
        payload.len()
    )
    .into_bytes();
    out.extend_from_slice(payload);
    out
}

/// Abgelaufene Metadaten sind immer ein Fehler. Einzige Ausnahme: explizit gesetzter
/// Entwickler-Override in Debug-Builds; Release-Builds ignorieren ihn vollstaendig.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExpiryPolicy {
    Enforce,
    DeveloperAllowExpired,
}

impl ExpiryPolicy {
    pub fn from_environment() -> Self {
        if cfg!(debug_assertions) && std::env::var(DEV_EXPIRY_OVERRIDE_ENV).as_deref() == Ok("1") {
            Self::DeveloperAllowExpired
        } else {
            Self::Enforce
        }
    }

    fn allows_expired(self) -> bool {
        cfg!(debug_assertions) && self == Self::DeveloperAllowExpired
    }
}

/// Zuletzt akzeptierter Kanalstand (Rollback-Untergrenze).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedMetadata {
    pub schema_version: u32,
    pub channel: Channel,
    pub version: u64,
    pub payload_sha256: String,
    pub expires: String,
    pub accepted_at: String,
}

/// Ergebnis einer vollstaendigen lokalen Verifikation. Nur `verify_signed_index` erzeugt es.
#[derive(Debug, Clone)]
pub struct VerifiedIndex {
    payload: SignedIndexPayload,
    payload_sha256: String,
}

impl VerifiedIndex {
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn version(&self) -> u64 {
        self.payload.version
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn payload_sha256(&self) -> &str {
        &self.payload_sha256
    }

    /// Exakter, versionierter Paketeintrag aus dem signierten Index.
    pub fn select(
        &self,
        package_id: &str,
        pinned: Option<&str>,
        platform: &str,
        runtime_version: &str,
        policy: &OriginPolicy,
    ) -> Result<Option<TrustedPackage>> {
        Ok(dist::select_candidate(
            self.payload.channel,
            &self.payload.packages,
            package_id,
            pinned,
            platform,
            runtime_version,
            policy,
        )?
        .map(|package| TrustedPackage {
            package: package.clone(),
            provenance: PackageProvenance::SignedIndex {
                metadata_version: self.payload.version,
                metadata_sha256: self.payload_sha256.clone(),
            },
        }))
    }
}

pub struct VerifyContext<'a> {
    pub root: &'a TrustRoot,
    pub channel: Channel,
    pub accepted: Option<&'a AcceptedMetadata>,
    pub now: DateTime<Utc>,
    pub expiry: ExpiryPolicy,
    pub policy: &'a OriginPolicy,
}

fn verify_signatures(envelope: &SignedEnvelope, payload: &[u8], root: &TrustRoot) -> Result<()> {
    if envelope.signatures.is_empty() || envelope.signatures.len() > MAX_SIGNATURES {
        bail!("Signierte Metadaten haben keine oder zu viele Signaturen");
    }
    let message = pae(&envelope.payload_type, payload);
    let mut seen: HashSet<&str> = HashSet::new();
    let mut valid: HashSet<&str> = HashSet::new();
    for signature in &envelope.signatures {
        // Ein Umschlag darf ausschliesslich offline gepinnte, eindeutige Schluessel nennen.
        // Unbekannte oder doppelte Key-IDs werden nicht als harmlose Zusatzsignatur ignoriert.
        let key = root
            .key(&signature.keyid)
            .ok_or_else(|| anyhow!("Unbekannter Signaturschluessel {}", signature.keyid))?;
        if !seen.insert(key.key_id.as_str()) {
            bail!(
                "Signaturschluessel {} ist doppelt enthalten",
                signature.keyid
            );
        }
        let Ok(sig) = BASE64.decode(signature.sig.as_bytes()) else {
            continue;
        };
        if UnparsedPublicKey::new(&ED25519, &key.public_key)
            .verify(&message, &sig)
            .is_ok()
        {
            valid.insert(key.key_id.as_str());
        }
    }
    if valid.len() < root.threshold {
        bail!(
            "Signierte Metadaten nicht vertrauenswuerdig: {} von {} benoetigten gueltigen Root-Signaturen",
            valid.len(),
            root.threshold
        );
    }
    Ok(())
}

/// Vollstaendige lokale Pruefung eines Kanalindex. Fehler = fail closed.
pub fn verify_signed_index(raw: &[u8], ctx: &VerifyContext<'_>) -> Result<VerifiedIndex> {
    if raw.len() > MAX_METADATA_BYTES {
        bail!("Signierte Metadaten ueberschreiten {MAX_METADATA_BYTES} Bytes");
    }
    let envelope: SignedEnvelope =
        serde_json::from_slice(raw).context("Signierter Umschlag ist ungueltig")?;
    if envelope.payload_type != INDEX_PAYLOAD_TYPE {
        bail!("Unerwarteter Payload-Typ {:?}", envelope.payload_type);
    }
    let payload = BASE64
        .decode(envelope.payload.as_bytes())
        .context("Payload ist kein gueltiges Base64")?;
    verify_signatures(&envelope, &payload, ctx.root)?;

    // Ab hier ist der Payload authentisch; Inhalt trotzdem strikt pruefen.
    let index: SignedIndexPayload =
        serde_json::from_slice(&payload).context("Signierter Index ist ungueltig")?;
    if index.schema != SIGNED_INDEX_SCHEMA {
        bail!("Nicht unterstuetztes Indexschema: {}", index.schema);
    }
    if index.channel != ctx.channel {
        bail!(
            "Index gehoert zu Kanal {}, erwartet {}",
            index.channel.as_str(),
            ctx.channel.as_str()
        );
    }
    if index.version == 0 {
        bail!("Indexversion muss >= 1 sein");
    }
    let expires = DateTime::parse_from_rfc3339(&index.expires)
        .context("Ablaufdatum der Metadaten ist ungueltig")?
        .with_timezone(&Utc);
    if ctx.now >= expires && !ctx.expiry.allows_expired() {
        bail!("Signierte Metadaten sind abgelaufen ({})", index.expires);
    }
    let payload_sha256 = sha256_hex(&payload);
    if let Some(accepted) = ctx.accepted {
        if accepted.channel != ctx.channel {
            bail!("Lokaler Vertrauensstand gehoert zu einem anderen Kanal");
        }
        if index.version < accepted.version {
            bail!(
                "Rollback verweigert: Indexversion {} liegt unter bereits akzeptierter {}",
                index.version,
                accepted.version
            );
        }
        if index.version == accepted.version && payload_sha256 != accepted.payload_sha256 {
            bail!(
                "Indexversion {} existiert bereits mit anderem Inhalt (Fork verweigert)",
                index.version
            );
        }
    }
    let mut seen = HashSet::new();
    for package in &index.packages {
        package.validate(ctx.policy).with_context(|| {
            format!(
                "Signierter Eintrag {}@{} ist ungueltig",
                package.package_id, package.version
            )
        })?;
        if package.channel != index.channel {
            bail!(
                "{}@{} liegt nicht im Kanal {}",
                package.package_id,
                package.version,
                index.channel.as_str()
            );
        }
        let version = SemVer::parse(&package.version)?;
        if !seen.insert((package.package_id.clone(), version)) {
            bail!(
                "{}@{} ist im Index doppelt vorhanden",
                package.package_id,
                package.version
            );
        }
    }
    Ok(VerifiedIndex {
        payload: index,
        payload_sha256,
    })
}

// ---------------------------------------------------------------------------------------
// Persistenter Vertrauensstand (Rollback-Untergrenze)
// ---------------------------------------------------------------------------------------

/// Liegt bewusst ausserhalb des Local-Brain-Baums, damit "Local Brain entfernen" die
/// Rollback-Untergrenze nicht zuruecksetzt.
#[derive(Debug, Clone)]
pub struct TrustStateStore {
    dir: PathBuf,
}

impl TrustStateStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path(&self, channel: Channel) -> PathBuf {
        self.dir.join(format!("{}.json", channel.as_str()))
    }

    /// Beschaedigter Stand ist ein Fehler (fail closed), kein stilles Zuruecksetzen.
    pub fn load(&self, channel: Channel) -> Result<Option<AcceptedMetadata>> {
        let text = match fs::read_to_string(self.path(channel)) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        let state: AcceptedMetadata = serde_json::from_str(&text)
            .context("Lokaler Metadaten-Vertrauensstand ist beschaedigt")?;
        if state.schema_version != TRUST_STATE_SCHEMA_VERSION || state.channel != channel {
            bail!(
                "Lokaler Metadaten-Vertrauensstand passt nicht zu {}",
                channel.as_str()
            );
        }
        dist::validate_sha256(&state.payload_sha256)?;
        Ok(Some(state))
    }

    /// Hebt die Untergrenze nach erfolgreicher Verifikation an (nie ab).
    pub fn record(&self, verified: &VerifiedIndex) -> Result<AcceptedMetadata> {
        let channel = verified.payload.channel;
        if let Some(current) = self.load(channel)? {
            if verified.payload.version < current.version
                || (verified.payload.version == current.version
                    && verified.payload_sha256 != current.payload_sha256)
            {
                bail!("Vertrauensstand wurde zwischenzeitlich angehoben; Index verworfen");
            }
        }
        let state = AcceptedMetadata {
            schema_version: TRUST_STATE_SCHEMA_VERSION,
            channel,
            version: verified.payload.version,
            payload_sha256: verified.payload_sha256.clone(),
            expires: verified.payload.expires.clone(),
            accepted_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        };
        dist::ensure_private_dir(&self.dir)?;
        write_atomic(&self.path(channel), &serde_json::to_vec_pretty(&state)?)?;
        Ok(state)
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4().simple()));
    {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        fs::remove_file(&tmp).ok();
    })?;
    Ok(())
}

// ---------------------------------------------------------------------------------------
// Vertrauenswuerdige Paketmetadaten
// ---------------------------------------------------------------------------------------

/// Herkunft akzeptierter Paketmetadaten; wird im Install-Ledger persistiert.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum PackageProvenance {
    /// Im signierten App-Binary eingebettetes Manifest.
    EmbeddedManifest,
    /// Signierter R2-Kanalindex mit Version und SHA-256 des Payloads.
    #[serde(rename_all = "camelCase")]
    SignedIndex {
        metadata_version: u64,
        metadata_sha256: String,
    },
}

/// Paketmetadaten, die lokal verifiziert wurden. Einzige Eingabe fuer Download und Promote.
#[derive(Debug, Clone)]
pub struct TrustedPackage {
    package: ModelPackage,
    provenance: PackageProvenance,
}

impl TrustedPackage {
    /// Eingebettetes Manifest: Teil des signierten App-Binaries, vor Nutzung validiert.
    pub fn embedded(package: ModelPackage, policy: &OriginPolicy) -> Result<Self> {
        package.validate(policy)?;
        Ok(Self {
            package,
            provenance: PackageProvenance::EmbeddedManifest,
        })
    }

    pub fn package(&self) -> &ModelPackage {
        &self.package
    }

    pub fn provenance(&self) -> &PackageProvenance {
        &self.provenance
    }
}

// ---------------------------------------------------------------------------------------
// Abruf ueber die Distribution-Base
// ---------------------------------------------------------------------------------------

/// Objekt-Schluessel des (einzigen veraenderlichen) Kanalindex.
pub fn index_object_key(channel: Channel) -> String {
    format!("channels/{}/index.json", channel.as_str())
}

/// Laedt den Kanalindex mit harter Byte-Obergrenze (Redirects laufen ueber die Origin-Policy
/// des Clients).
pub async fn fetch_index_bytes(
    client: &reqwest::Client,
    base: &DistributionBase,
    channel: Channel,
    policy: &OriginPolicy,
) -> Result<Vec<u8>> {
    let url = base.resolve(&index_object_key(channel), policy)?;
    let mut response = client
        .get(url)
        .send()
        .await
        .context("Kanalindex konnte nicht geladen werden")?;
    if !response.status().is_success() {
        bail!("Kanalindex antwortete mit {}", response.status());
    }
    if response
        .content_length()
        .is_some_and(|len| len > MAX_METADATA_BYTES as u64)
    {
        bail!("Kanalindex ueberschreitet {MAX_METADATA_BYTES} Bytes");
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if body.len() + chunk.len() > MAX_METADATA_BYTES {
            bail!("Kanalindex ueberschreitet {MAX_METADATA_BYTES} Bytes");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

/// Laedt, verifiziert und akzeptiert den Kanalindex. Die Rollback-Untergrenze wird sofort
/// nach erfolgreicher Verifikation angehoben – vor jedem Download.
pub async fn refresh_channel(
    client: &reqwest::Client,
    base: &DistributionBase,
    store: &TrustStateStore,
    ctx_root: &TrustRoot,
    channel: Channel,
    expiry: ExpiryPolicy,
    policy: &OriginPolicy,
) -> Result<VerifiedIndex> {
    let raw = fetch_index_bytes(client, base, channel, policy).await?;
    let accepted = store.load(channel)?;
    let verified = verify_signed_index(
        &raw,
        &VerifyContext {
            root: ctx_root,
            channel,
            accepted: accepted.as_ref(),
            now: Utc::now(),
            expiry,
            policy,
        },
    )?;
    store.record(&verified)?;
    Ok(verified)
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    pub struct TestSigner {
        pair: Ed25519KeyPair,
    }

    impl TestSigner {
        pub fn from_seed(seed: u8) -> Self {
            Self {
                pair: Ed25519KeyPair::from_seed_unchecked(&[seed; 32]).unwrap(),
            }
        }

        pub fn public_hex(&self) -> String {
            self.pair
                .public_key()
                .as_ref()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect()
        }

        pub fn key_id(&self) -> String {
            key_id(self.pair.public_key().as_ref())
        }

        pub fn signature(&self, payload_type: &str, payload: &[u8]) -> EnvelopeSignature {
            EnvelopeSignature {
                keyid: self.key_id(),
                sig: BASE64.encode(self.pair.sign(&pae(payload_type, payload)).as_ref()),
            }
        }
    }

    pub fn payload(
        channel: Channel,
        version: u64,
        expires: &str,
        packages: Vec<ModelPackage>,
    ) -> Vec<u8> {
        serde_json::to_vec(&SignedIndexPayload {
            schema: SIGNED_INDEX_SCHEMA.into(),
            channel,
            version,
            expires: expires.into(),
            packages,
        })
        .unwrap()
    }

    pub fn envelope(payload: &[u8], signers: &[&TestSigner]) -> Vec<u8> {
        serde_json::to_vec(&SignedEnvelope {
            payload_type: INDEX_PAYLOAD_TYPE.into(),
            payload: BASE64.encode(payload),
            signatures: signers
                .iter()
                .map(|signer| signer.signature(INDEX_PAYLOAD_TYPE, payload))
                .collect(),
        })
        .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::*;
    use super::*;
    use crate::model_distribution::test_fixtures::{package, prod_policy, tempdir};

    const FUTURE: &str = "2099-01-01T00:00:00Z";

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-07T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn root_for(signer: &TestSigner) -> TrustRoot {
        TrustRoot::new(&[&signer.public_hex()], 1).unwrap()
    }

    fn verify(
        raw: &[u8],
        root: &TrustRoot,
        accepted: Option<&AcceptedMetadata>,
        expiry: ExpiryPolicy,
    ) -> Result<VerifiedIndex> {
        verify_signed_index(
            raw,
            &VerifyContext {
                root,
                channel: Channel::Stable,
                accepted,
                now: now(),
                expiry,
                policy: &prod_policy(),
            },
        )
    }

    fn signed(version: u64, expires: &str, signer: &TestSigner) -> Vec<u8> {
        envelope(
            &payload(
                Channel::Stable,
                version,
                expires,
                vec![package("1.0.0", b"one"), package("1.1.0", b"two")],
            ),
            &[signer],
        )
    }

    #[test]
    fn valid_signed_metadata_is_accepted_and_selects_exact_immutable_key() {
        let signer = TestSigner::from_seed(7);
        let verified = verify(
            &signed(3, FUTURE, &signer),
            &root_for(&signer),
            None,
            ExpiryPolicy::Enforce,
        )
        .unwrap();
        assert_eq!(verified.version(), 3);
        let trusted = verified
            .select(
                "kato-test-brain",
                None,
                "macos-aarch64",
                "b11272",
                &prod_policy(),
            )
            .unwrap()
            .unwrap();
        assert_eq!(trusted.package().version, "1.1.0");
        assert_eq!(
            trusted.package().object_key,
            "packages/kato-test-brain/1.1.0/model.gguf"
        );
        assert_eq!(
            trusted.provenance(),
            &PackageProvenance::SignedIndex {
                metadata_version: 3,
                metadata_sha256: verified.payload_sha256().to_string(),
            }
        );
    }

    #[test]
    fn signed_metadata_version_and_hash_are_persisted_in_install_ledger() {
        let signer = TestSigner::from_seed(7);
        let verified = verify(
            &signed(3, FUTURE, &signer),
            &root_for(&signer),
            None,
            ExpiryPolicy::Enforce,
        )
        .unwrap();
        let trusted = verified
            .select(
                "kato-test-brain",
                None,
                "macos-aarch64",
                "b11272",
                &prod_policy(),
            )
            .unwrap()
            .unwrap();
        let package = trusted.package().clone();
        let store = dist::PackageStore::new(tempdir("signed-ledger"));
        dist::ensure_private_dir(&store.staging_dir()).unwrap();
        let part = dist::staging_part_path(&store.staging_dir(), &package.sha256);
        fs::write(&part, b"two").unwrap();
        let artifact = dist::verify_or_discard(
            &part,
            dist::ExpectedArtifact {
                sha256: &package.sha256,
                size_bytes: package.size_bytes,
            },
        )
        .unwrap();
        let ledger = store.promote(&trusted, artifact).unwrap();
        assert_eq!(
            ledger.active_entry().unwrap().provenance,
            Some(PackageProvenance::SignedIndex {
                metadata_version: 3,
                metadata_sha256: verified.payload_sha256().to_string(),
            })
        );
    }

    #[test]
    fn tampered_payload_or_signature_is_rejected() {
        let signer = TestSigner::from_seed(7);
        let root = root_for(&signer);
        let raw = signed(3, FUTURE, &signer);
        let mut envelope: SignedEnvelope = serde_json::from_slice(&raw).unwrap();

        // Payload nach dem Signieren veraendert (z. B. anderer SHA eines Pakets).
        let text = String::from_utf8(BASE64.decode(&envelope.payload).unwrap()).unwrap();
        let forged = text.replacen(&package("1.1.0", b"two").sha256, &"f".repeat(64), 1);
        assert_ne!(text, forged);
        let mut tampered = envelope.clone();
        tampered.payload = BASE64.encode(forged.as_bytes());
        let err = verify(
            &serde_json::to_vec(&tampered).unwrap(),
            &root,
            None,
            ExpiryPolicy::Enforce,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("nicht vertrauenswuerdig"),
            "{err:#}"
        );

        // Signatur-Bytes veraendert.
        let mut sig = BASE64.decode(&envelope.signatures[0].sig).unwrap();
        sig[0] ^= 0x01;
        envelope.signatures[0].sig = BASE64.encode(sig);
        assert!(verify(
            &serde_json::to_vec(&envelope).unwrap(),
            &root,
            None,
            ExpiryPolicy::Enforce
        )
        .is_err());

        // Payload-Typ veraendert (Signatur deckt ihn ueber PAE ab).
        let mut retyped: SignedEnvelope = serde_json::from_slice(&raw).unwrap();
        retyped.payload_type = "application/json".into();
        assert!(verify(
            &serde_json::to_vec(&retyped).unwrap(),
            &root,
            None,
            ExpiryPolicy::Enforce
        )
        .is_err());

        // Unsignierter Roh-Index (altes Format) wird nie akzeptiert.
        let raw_index = payload_for_tests();
        assert!(verify(&raw_index, &root, None, ExpiryPolicy::Enforce).is_err());
    }

    fn payload_for_tests() -> Vec<u8> {
        payload(Channel::Stable, 3, FUTURE, vec![package("1.0.0", b"one")])
    }

    #[test]
    fn unknown_signing_key_is_rejected() {
        let trusted = TestSigner::from_seed(7);
        let stranger = TestSigner::from_seed(9);
        let root = root_for(&trusted);
        let err = verify(
            &signed(3, FUTURE, &stranger),
            &root,
            None,
            ExpiryPolicy::Enforce,
        )
        .unwrap_err();
        assert!(
            err.to_string().contains("Unbekannter Signaturschluessel"),
            "{err:#}"
        );

        // Fremde Signatur unter der Key-ID des vertrauten Schluessels.
        let body = payload_for_tests();
        let mut spoof = stranger.signature(INDEX_PAYLOAD_TYPE, &body);
        spoof.keyid = trusted.key_id();
        let spoofed = serde_json::to_vec(&SignedEnvelope {
            payload_type: INDEX_PAYLOAD_TYPE.into(),
            payload: BASE64.encode(&body),
            signatures: vec![spoof],
        })
        .unwrap();
        assert!(verify(&spoofed, &root, None, ExpiryPolicy::Enforce).is_err());

        // Schwelle 2: ein gueltiger + ein doppelter Eintrag desselben Schluessels reichen nicht.
        let second = TestSigner::from_seed(11);
        let root2 = TrustRoot::new(&[&trusted.public_hex(), &second.public_hex()], 2).unwrap();
        let doubled = envelope(&body, &[&trusted, &trusted]);
        assert!(verify(&doubled, &root2, None, ExpiryPolicy::Enforce).is_err());
        let both = envelope(&body, &[&trusted, &second]);
        verify(&both, &root2, None, ExpiryPolicy::Enforce).unwrap();

        // Eine gueltige Root-Signatur darf einen unbekannten Zusatzschluessel nicht tarnen.
        let mixed = envelope(&body, &[&trusted, &stranger]);
        assert!(verify(&mixed, &root, None, ExpiryPolicy::Enforce).is_err());

        // Kein gepinnter Produktionsschluessel → signierter Kanal deaktiviert.
        assert!(TrustRoot::production().is_err());
        assert!(TrustRoot::new(&[], 1).is_err());
        assert!(TrustRoot::new(&["abcd"], 1).is_err());
    }

    #[test]
    fn expired_metadata_is_rejected_unless_debug_override() {
        let signer = TestSigner::from_seed(7);
        let root = root_for(&signer);
        let expired = signed(3, "2026-10-01T00:00:00Z", &signer);
        let err = verify(&expired, &root, None, ExpiryPolicy::Enforce).unwrap_err();
        assert!(err.to_string().contains("abgelaufen"), "{err:#}");
        assert!(verify(
            &signed(3, "not-a-date", &signer),
            &root,
            None,
            ExpiryPolicy::Enforce
        )
        .is_err());

        // Override wirkt nur in Debug-Builds; Release-Builds ignorieren ihn.
        let overridden = verify(&expired, &root, None, ExpiryPolicy::DeveloperAllowExpired);
        assert_eq!(overridden.is_ok(), cfg!(debug_assertions));
        // Ohne explizit gesetzte Variable bleibt die Produktion strikt.
        if std::env::var(DEV_EXPIRY_OVERRIDE_ENV).is_err() {
            assert_eq!(ExpiryPolicy::from_environment(), ExpiryPolicy::Enforce);
        }
    }

    #[test]
    fn rollback_and_fork_metadata_is_rejected() {
        let signer = TestSigner::from_seed(7);
        let root = root_for(&signer);
        let store = TrustStateStore::new(tempdir("trust-state"));
        let v5 = verify(
            &signed(5, FUTURE, &signer),
            &root,
            None,
            ExpiryPolicy::Enforce,
        )
        .unwrap();
        store.record(&v5).unwrap();
        let accepted = store.load(Channel::Stable).unwrap().unwrap();
        assert_eq!(accepted.version, 5);

        let err = verify(
            &signed(4, FUTURE, &signer),
            &root,
            Some(&accepted),
            ExpiryPolicy::Enforce,
        )
        .unwrap_err();
        assert!(err.to_string().contains("Rollback verweigert"), "{err:#}");

        // Gleiche Version, anderer Inhalt.
        let fork = envelope(
            &payload(Channel::Stable, 5, FUTURE, vec![package("1.0.0", b"one")]),
            &[&signer],
        );
        assert!(verify(&fork, &root, Some(&accepted), ExpiryPolicy::Enforce).is_err());

        // Identischer Stand bleibt gueltig, hoeherer wird akzeptiert und hebt die Untergrenze.
        verify(
            &signed(5, FUTURE, &signer),
            &root,
            Some(&accepted),
            ExpiryPolicy::Enforce,
        )
        .unwrap();
        let v6 = verify(
            &signed(6, FUTURE, &signer),
            &root,
            Some(&accepted),
            ExpiryPolicy::Enforce,
        )
        .unwrap();
        store.record(&v6).unwrap();
        assert!(store.record(&v5).is_err(), "Untergrenze sinkt nie");
        assert_eq!(store.load(Channel::Stable).unwrap().unwrap().version, 6);

        // Beschaedigter Stand setzt nicht still zurueck.
        fs::write(store.path(Channel::Stable), b"{broken").unwrap();
        assert!(store.load(Channel::Stable).is_err());
    }

    #[test]
    fn signed_index_rejects_channel_swap_duplicates_and_ungated_public_entries() {
        let signer = TestSigner::from_seed(7);
        let root = root_for(&signer);
        let beta = envelope(&payload(Channel::Beta, 3, FUTURE, Vec::new()), &[&signer]);
        assert!(verify(&beta, &root, None, ExpiryPolicy::Enforce).is_err());

        let dupes = envelope(
            &payload(
                Channel::Stable,
                3,
                FUTURE,
                vec![package("1.0.0", b"one"), package("1.0.0", b"other")],
            ),
            &[&signer],
        );
        assert!(verify(&dupes, &root, None, ExpiryPolicy::Enforce).is_err());

        let mut ungated = package("1.0.0", b"one");
        ungated.license.redistribution.status = dist::RedistributionStatus::PendingReview;
        let gated = envelope(
            &payload(Channel::Stable, 3, FUTURE, vec![ungated]),
            &[&signer],
        );
        assert!(verify(&gated, &root, None, ExpiryPolicy::Enforce).is_err());

        let oversized = vec![b' '; MAX_METADATA_BYTES + 1];
        assert!(verify(&oversized, &root, None, ExpiryPolicy::Enforce).is_err());
    }

    #[test]
    fn mutable_latest_keys_are_never_selected() {
        let mut latest = package("1.0.0", b"one");
        latest.object_key = "packages/kato-test-brain/latest/model.gguf".into();
        assert!(latest.validate(&prod_policy()).is_err());
        let mut unversioned = package("1.0.0", b"one");
        unversioned.object_key = "model.gguf".into();
        assert!(unversioned.validate(&prod_policy()).is_err());
        assert!(TrustedPackage::embedded(latest, &prod_policy()).is_err());
        assert_eq!(
            index_object_key(Channel::Stable),
            "channels/stable/index.json"
        );
    }

    /// Minimaler Loopback-Server, der genau einen Body ausliefert.
    fn serve_once(body: Vec<u8>) -> String {
        use std::io::{BufRead, BufReader, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            if let Some(Ok(mut stream)) = listener.incoming().next() {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                while reader.read_line(&mut line).unwrap_or(0) > 0 && line != "\r\n" {
                    line.clear();
                }
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(&body);
            }
        });
        base
    }

    #[tokio::test]
    async fn refresh_channel_verifies_then_raises_floor_before_any_download() {
        let signer = TestSigner::from_seed(7);
        let root = root_for(&signer);
        let policy = OriginPolicy::loopback_for_tests();
        let client = policy.http_client().unwrap();
        let store = TrustStateStore::new(tempdir("refresh"));

        let base =
            DistributionBase::parse(&serve_once(signed(8, FUTURE, &signer)), &policy).unwrap();
        let verified = refresh_channel(
            &client,
            &base,
            &store,
            &root,
            Channel::Stable,
            ExpiryPolicy::Enforce,
            &policy,
        )
        .await
        .unwrap();
        assert_eq!(verified.version(), 8);
        assert_eq!(store.load(Channel::Stable).unwrap().unwrap().version, 8);

        // Ein spaeter ausgelieferter aelterer (gueltig signierter) Index wird verworfen.
        let base =
            DistributionBase::parse(&serve_once(signed(7, FUTURE, &signer)), &policy).unwrap();
        assert!(refresh_channel(
            &client,
            &base,
            &store,
            &root,
            Channel::Stable,
            ExpiryPolicy::Enforce,
            &policy,
        )
        .await
        .is_err());
        assert_eq!(store.load(Channel::Stable).unwrap().unwrap().version, 8);
    }
}
