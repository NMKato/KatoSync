// Created by NMKato Solutions
//! Versionierter Modellpaket-Vertrag und verifizierte Verteilung der Local-Brain-Gewichte.
//!
//! Runtime (llama.cpp) und Modellgewichte bleiben getrennt: Gewichte kommen ueber eine
//! Distribution-Base (Cloudflare R2 / Custom Domain) oder den gepinnten Upstream, landen
//! zuerst als inhaltsadressierte `.part`-Datei im Staging und werden erst nach exakter
//! Groessen- und SHA-256-Pruefung atomar in den installierten Paketbaum uebernommen.
//! Persistiert werden nur Version, Hash und Groesse – nie URLs, Tokens oder Signaturen.

use anyhow::{anyhow, bail, Context, Result};
use reqwest::{
    header::{CONTENT_RANGE, RANGE},
    StatusCode, Url,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    cmp::Ordering,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, UNIX_EPOCH},
};

pub const PACKAGE_SCHEMA: &str = "kato-model-package/1";
// Kanalindex-Vertrag: wird clientseitig ausgewertet, sobald `distribution.baseUrl` gesetzt ist.
#[cfg_attr(not(test), allow(dead_code))]
pub const INDEX_SCHEMA: &str = "kato-model-index/1";
const LEDGER_SCHEMA_VERSION: u32 = 1;
const MAX_PACKAGE_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_OBJECT_KEY_LEN: usize = 512;

// ---------------------------------------------------------------------------------------
// Vertrag
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
}

/// Veroeffentlichungsstufe. `Public` ist nur mit bestandenem Lizenz-/Redistribution-Gate gueltig.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReleaseState {
    Draft,
    Internal,
    Public,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RedistributionStatus {
    PendingReview,
    Approved,
    Denied,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Redistribution {
    pub status: RedistributionStatus,
    pub reviewed_by: Option<String>,
    pub reviewed_at: Option<String>,
    pub basis: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageLicense {
    pub spdx: String,
    pub notice_refs: Vec<String>,
    pub user_acceptance_required: bool,
    pub acceptance_text_ref: Option<String>,
    pub redistribution: Redistribution,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirement {
    pub id: String,
    pub versions: Vec<String>,
}

/// Paketmetadaten, die im Local-Brain-Manifest neben den bestehenden Modellfeldern stehen.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackagePublication {
    pub package_id: String,
    pub version: String,
    pub channel: Channel,
    pub release_state: ReleaseState,
    pub object_key: String,
    pub platforms: Vec<String>,
    pub runtime: RuntimeRequirement,
    pub context_tokens: u32,
    pub license: PackageLicense,
}

/// Vollstaendiges Paket – identisch mit `packages/<id>/<version>/manifest.json` im Bucket.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPackage {
    pub schema: String,
    pub package_id: String,
    pub version: String,
    pub channel: Channel,
    pub release_state: ReleaseState,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub quantization: String,
    pub minimum_ram_gb: u64,
    pub preferred_ram_gb: u64,
    pub context_tokens: u32,
    pub platforms: Vec<String>,
    pub runtime: RuntimeRequirement,
    pub license: PackageLicense,
    pub object_key: String,
    pub upstream_url: Option<String>,
}

/// Kanalindex – `channels/<channel>/index.json` im Bucket.
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelIndex {
    pub schema: String,
    pub channel: Channel,
    pub packages: Vec<ModelPackage>,
}

fn is_simple_token(value: &str, max: usize) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

pub fn validate_package_id(value: &str) -> Result<()> {
    let ok = value.len() <= 64
        && value
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !ok {
        bail!("Ungueltige Paket-ID: {value:?}");
    }
    Ok(())
}

pub fn validate_file_name(value: &str) -> Result<()> {
    let ok = is_simple_token(value, 200)
        && value
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphanumeric())
        && !value.contains("..")
        && value.ends_with(".gguf");
    if !ok {
        bail!("Ungueltiger Modell-Dateiname: {value:?}");
    }
    Ok(())
}

pub fn validate_sha256(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
    {
        bail!("SHA-256 muss aus 64 kleingeschriebenen Hex-Zeichen bestehen");
    }
    Ok(())
}

/// Objekt-Schluessel relativ zur Distribution-Base. Keine Traversal-, Escape- oder Leersegmente.
pub fn validate_object_key(key: &str) -> Result<()> {
    if key.is_empty() || key.len() > MAX_OBJECT_KEY_LEN || key.starts_with('/') {
        bail!("Ungueltiger Objekt-Schluessel");
    }
    for segment in key.split('/') {
        if segment == "." || segment == ".." || !is_simple_token(segment, 200) {
            bail!("Unsicheres Segment im Objekt-Schluessel: {segment:?}");
        }
    }
    Ok(())
}

fn validate_platform(value: &str) -> Result<()> {
    let mut parts = value.split('-');
    let ok = matches!(
        (parts.next(), parts.next(), parts.next()),
        (Some(os), Some(arch), None)
            if is_simple_token(os, 16) && is_simple_token(arch, 16)
    );
    if !ok {
        bail!("Ungueltige Plattform: {value:?}");
    }
    Ok(())
}

/// Lizenz-/Redistribution-Gate. Leere Liste = veroeffentlichbar.
pub fn release_gate_blockers(package: &ModelPackage) -> Vec<&'static str> {
    let license = &package.license;
    let review = &license.redistribution;
    let mut blockers = Vec::new();
    if license.spdx.trim().is_empty() {
        blockers.push("license_spdx_missing");
    }
    if license.notice_refs.iter().all(|r| r.trim().is_empty()) {
        blockers.push("license_notice_missing");
    }
    if license.user_acceptance_required
        && license
            .acceptance_text_ref
            .as_deref()
            .is_none_or(|r| r.trim().is_empty())
    {
        blockers.push("acceptance_text_missing");
    }
    if review.status != RedistributionStatus::Approved {
        blockers.push("redistribution_not_approved");
    }
    let filled = |value: &Option<String>| value.as_deref().is_some_and(|v| !v.trim().is_empty());
    if !filled(&review.reviewed_by) || !filled(&review.reviewed_at) || !filled(&review.basis) {
        blockers.push("redistribution_review_incomplete");
    }
    blockers
}

impl ModelPackage {
    pub fn validate(&self, policy: &OriginPolicy) -> Result<()> {
        if self.schema != PACKAGE_SCHEMA {
            bail!("Nicht unterstuetztes Paketschema: {}", self.schema);
        }
        validate_package_id(&self.package_id)?;
        let version = SemVer::parse(&self.version)?;
        if self.channel == Channel::Stable && version.is_prerelease() {
            bail!(
                "Stable-Kanal akzeptiert keine Vorabversion {}",
                self.version
            );
        }
        validate_file_name(&self.file_name)?;
        validate_sha256(&self.sha256)?;
        if self.size_bytes == 0 || self.size_bytes > MAX_PACKAGE_BYTES {
            bail!("Unplausible Paketgroesse {}", self.size_bytes);
        }
        if !is_simple_token(&self.quantization, 32) {
            bail!("Ungueltige Quantisierung");
        }
        if self.minimum_ram_gb == 0 || self.preferred_ram_gb < self.minimum_ram_gb {
            bail!("RAM-Empfehlung ist inkonsistent");
        }
        if !(512..=1_048_576).contains(&self.context_tokens) {
            bail!(
                "Kontextgroesse {} ausserhalb des Bereichs",
                self.context_tokens
            );
        }
        if self.platforms.is_empty() {
            bail!("Paket nennt keine Plattform");
        }
        for platform in &self.platforms {
            validate_platform(platform)?;
        }
        if !is_simple_token(&self.runtime.id, 64)
            || self.runtime.versions.is_empty()
            || !self.runtime.versions.iter().all(|v| is_simple_token(v, 64))
        {
            bail!("Runtime-Anforderung ist unvollstaendig");
        }
        validate_object_key(&self.object_key)?;
        let canonical = format!(
            "packages/{}/{}/{}",
            self.package_id, self.version, self.file_name
        );
        if self.object_key != canonical {
            bail!("Objekt-Schluessel muss {canonical} lauten");
        }
        if let Some(upstream) = &self.upstream_url {
            policy.check(upstream)?;
        }
        if self.release_state == ReleaseState::Public {
            let blockers = release_gate_blockers(self);
            if !blockers.is_empty() {
                bail!(
                    "Paket {}@{} darf nicht oeffentlich sein: {}",
                    self.package_id,
                    self.version,
                    blockers.join(", ")
                );
            }
        }
        Ok(())
    }

    pub fn supports(&self, platform: &str, runtime_version: &str) -> bool {
        self.platforms.iter().any(|p| p == platform)
            && self.runtime.versions.iter().any(|v| v == runtime_version)
    }
}

/// Waehlt aus einem Kanalindex die installierbare Version: nur gueltige, oeffentliche,
/// plattform-/runtime-kompatible Eintraege; ein Pin gewinnt gegen "neueste".
#[cfg_attr(not(test), allow(dead_code))]
pub fn select_release<'a>(
    index: &'a ChannelIndex,
    package_id: &str,
    pinned: Option<&str>,
    platform: &str,
    runtime_version: &str,
    policy: &OriginPolicy,
) -> Result<Option<&'a ModelPackage>> {
    if index.schema != INDEX_SCHEMA {
        bail!("Nicht unterstuetztes Indexschema: {}", index.schema);
    }
    let mut best: Option<(&ModelPackage, SemVer)> = None;
    for candidate in &index.packages {
        if candidate.package_id != package_id
            || candidate.channel != index.channel
            || candidate.release_state != ReleaseState::Public
            || candidate.validate(policy).is_err()
            || !candidate.supports(platform, runtime_version)
        {
            continue;
        }
        if pinned.is_some_and(|pin| pin != candidate.version) {
            continue;
        }
        let version = SemVer::parse(&candidate.version)?;
        if best.as_ref().is_none_or(|(_, current)| version > *current) {
            best = Some((candidate, version));
        }
    }
    Ok(best.map(|(package, _)| package))
}

// ---------------------------------------------------------------------------------------
// Semantische Versionen (SemVer 2.0 Praezedenz, Build-Metadaten werden ignoriert)
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum PreId {
    Numeric(u64),
    Alpha(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemVer {
    major: u64,
    minor: u64,
    patch: u64,
    pre: Vec<PreId>,
}

fn parse_numeric(part: &str) -> Option<u64> {
    if part.is_empty()
        || !part.bytes().all(|b| b.is_ascii_digit())
        || (part.len() > 1 && part.starts_with('0'))
    {
        return None;
    }
    part.parse().ok()
}

impl SemVer {
    pub fn parse(raw: &str) -> Result<Self> {
        let invalid = || anyhow!("Ungueltige semantische Version: {raw:?}");
        let (rest, build) = match raw.split_once('+') {
            Some((rest, build)) => (rest, Some(build)),
            None => (raw, None),
        };
        if let Some(build) = build {
            if build.split('.').any(|id| {
                id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            }) {
                return Err(invalid());
            }
        }
        let (core, pre) = match rest.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (rest, None),
        };
        let mut numbers = core.split('.');
        let (Some(major), Some(minor), Some(patch), None) = (
            numbers.next(),
            numbers.next(),
            numbers.next(),
            numbers.next(),
        ) else {
            return Err(invalid());
        };
        let pre = match pre {
            None => Vec::new(),
            Some(pre) => pre
                .split('.')
                .map(|id| {
                    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    {
                        None
                    } else if id.bytes().all(|b| b.is_ascii_digit()) {
                        parse_numeric(id).map(PreId::Numeric)
                    } else {
                        Some(PreId::Alpha(id.to_string()))
                    }
                })
                .collect::<Option<Vec<_>>>()
                .ok_or_else(invalid)?,
        };
        Ok(Self {
            major: parse_numeric(major).ok_or_else(invalid)?,
            minor: parse_numeric(minor).ok_or_else(invalid)?,
            patch: parse_numeric(patch).ok_or_else(invalid)?,
            pre,
        })
    }

    pub fn is_prerelease(&self) -> bool {
        !self.pre.is_empty()
    }
}

impl Ord for SemVer {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for SemVer {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

// ---------------------------------------------------------------------------------------
// Herkunfts-/HTTPS-Policy und Distribution-Base
// ---------------------------------------------------------------------------------------

/// Erlaubte Download-Herkuenfte. Produktion: nur HTTPS auf explizit gelisteten Hosts,
/// ohne Userinfo, Query oder Fragment (damit nie signierte URLs/Tokens im Manifest landen).
#[derive(Debug, Clone)]
pub struct OriginPolicy {
    allowed_hosts: Vec<String>,
    allow_loopback_http: bool,
}

impl OriginPolicy {
    pub fn new(allowed_hosts: &[String]) -> Result<Self> {
        let mut hosts = Vec::with_capacity(allowed_hosts.len());
        for host in allowed_hosts {
            let host = host.trim().to_ascii_lowercase();
            if host.is_empty()
                || host.parse::<std::net::IpAddr>().is_ok()
                || !host
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            {
                bail!("Ungueltiger erlaubter Host: {host:?}");
            }
            hosts.push(host);
        }
        Ok(Self {
            allowed_hosts: hosts,
            allow_loopback_http: false,
        })
    }

    #[cfg(test)]
    pub fn loopback_for_tests() -> Self {
        Self {
            allowed_hosts: Vec::new(),
            allow_loopback_http: true,
        }
    }

    pub fn check(&self, raw: &str) -> Result<Url> {
        let url = Url::parse(raw).with_context(|| format!("Ungueltige Download-URL {raw:?}"))?;
        self.check_url(&url)?;
        Ok(url)
    }

    fn check_url(&self, url: &Url) -> Result<()> {
        if !url.username().is_empty() || url.password().is_some() {
            bail!("Download-URL darf keine Zugangsdaten enthalten");
        }
        if url.query().is_some() || url.fragment().is_some() {
            bail!("Download-URL darf keine Query/Signatur enthalten");
        }
        let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
        match url.scheme() {
            "https" if self.allowed_hosts.contains(&host) => Ok(()),
            "http" if self.allow_loopback_http && host == "127.0.0.1" => Ok(()),
            "https" => bail!("Host {host} ist keine erlaubte Modell-Herkunft"),
            other => bail!("Nur HTTPS ist fuer Modell-Downloads erlaubt (nicht {other})"),
        }
    }

    /// Client mit Redirect-Policy: Weiterleitungen nur auf HTTPS (CDN-Hosts der Herkunft).
    pub fn http_client(&self) -> Result<reqwest::Client> {
        let allow_loopback = self.allow_loopback_http;
        let redirect = reqwest::redirect::Policy::custom(move |attempt| {
            let url = attempt.url();
            let secure =
                url.scheme() == "https" || (allow_loopback && url.host_str() == Some("127.0.0.1"));
            if attempt.previous().len() >= 10 {
                attempt.error("zu viele Weiterleitungen")
            } else if !secure || !url.username().is_empty() || url.password().is_some() {
                attempt.error("unsichere Weiterleitung")
            } else {
                attempt.follow()
            }
        });
        Ok(reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(60 * 60 * 6))
            .redirect(redirect)
            .build()?)
    }
}

/// Basis-URL eines Verteilkanals (z. B. R2 Custom Domain). Objekt-Schluessel werden
/// ausschliesslich relativ dazu aufgeloest.
#[derive(Debug, Clone)]
pub struct DistributionBase(Url);

impl DistributionBase {
    pub fn parse(raw: &str, policy: &OriginPolicy) -> Result<Self> {
        let mut url = policy.check(raw)?;
        if !url.path().ends_with('/') {
            let path = format!("{}/", url.path());
            url.set_path(&path);
        }
        Ok(Self(url))
    }

    pub fn resolve(&self, object_key: &str, policy: &OriginPolicy) -> Result<Url> {
        validate_object_key(object_key)?;
        let url = self.0.join(object_key)?;
        if url.origin() != self.0.origin() || !url.path().starts_with(self.0.path()) {
            bail!("Objekt-Schluessel verlaesst die Distribution-Base");
        }
        policy.check_url(&url)?;
        Ok(url)
    }
}

/// Download-Reihenfolge: oeffentlich freigegebene Pakete zuerst ueber die Distribution-Base,
/// danach der gepinnte Upstream. Nicht freigegebene Pakete nie ueber den eigenen Kanal.
pub fn download_sources(
    package: &ModelPackage,
    base: Option<&DistributionBase>,
    policy: &OriginPolicy,
) -> Result<Vec<Url>> {
    let mut sources = Vec::new();
    if let Some(base) = base {
        if package.release_state == ReleaseState::Public {
            sources.push(base.resolve(&package.object_key, policy)?);
        }
    }
    if let Some(upstream) = &package.upstream_url {
        sources.push(policy.check(upstream)?);
    }
    if sources.is_empty() {
        bail!(
            "Keine zulaessige Download-Quelle fuer {}@{}",
            package.package_id,
            package.version
        );
    }
    Ok(sources)
}

// ---------------------------------------------------------------------------------------
// Verifizierter, fortsetzbarer Download
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub struct ExpectedArtifact<'a> {
    pub sha256: &'a str,
    /// Pflicht fuer Modellgewichte; nur Runtime-Archive ohne Groessenangabe duerfen `None` nutzen.
    pub size_bytes: Option<u64>,
}

enum FetchError {
    /// Netzwerk/HTTP – Teil-Download bleibt erhalten, naechste Quelle oder spaeterer Versuch.
    Transport(anyhow::Error),
    /// Inhalt passt nicht zum Manifest – Teil-Download wird verworfen, kein Fallback.
    Integrity(anyhow::Error),
}

pub fn staging_part_path(staging: &Path, sha256: &str) -> PathBuf {
    staging.join(format!("{sha256}.part"))
}

fn existing_part_len(part: &Path) -> Result<u64> {
    match fs::symlink_metadata(part) {
        Ok(meta) if meta.file_type().is_file() => Ok(meta.len()),
        Ok(_) => {
            fs::remove_file(part).ok();
            Ok(0)
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(err) => Err(err.into()),
    }
}

/// `Content-Range: bytes <start>-<end>/<total>` – Start muss exakt am Teil-Download anschliessen.
fn content_range_matches(value: Option<&str>, start: u64, expected_total: Option<u64>) -> bool {
    let Some(range) = value.and_then(|v| v.strip_prefix("bytes ")) else {
        return false;
    };
    let Some((span, total)) = range.split_once('/') else {
        return false;
    };
    let Some((first, _)) = span.split_once('-') else {
        return false;
    };
    let start_ok = first.parse::<u64>().ok() == Some(start);
    let total_ok = match expected_total {
        Some(expected) => total == "*" || total.parse::<u64>().ok() == Some(expected),
        None => true,
    };
    start_ok && total_ok
}

async fn fetch_into_part(
    client: &reqwest::Client,
    url: &Url,
    part: &Path,
    expected: ExpectedArtifact<'_>,
    progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
) -> std::result::Result<(), FetchError> {
    let transport = |err: anyhow::Error| FetchError::Transport(err);
    let mut existing = existing_part_len(part).map_err(transport)?;
    if let Some(size) = expected.size_bytes {
        if existing > size {
            fs::remove_file(part).ok();
            existing = 0;
        }
        if existing == size {
            return Ok(());
        }
    }

    let mut request = client.get(url.clone());
    if existing > 0 {
        request = request.header(RANGE, format!("bytes={existing}-"));
    }
    let mut response = request
        .send()
        .await
        .map_err(|err| transport(anyhow!("Download-Anfrage fehlgeschlagen: {err}")))?;
    let mut offset = match response.status() {
        StatusCode::PARTIAL_CONTENT if existing > 0 => {
            let range = response
                .headers()
                .get(CONTENT_RANGE)
                .and_then(|v| v.to_str().ok());
            if !content_range_matches(range, existing, expected.size_bytes) {
                fs::remove_file(part).ok();
                return Err(transport(anyhow!(
                    "Server lieferte einen unpassenden Teilbereich; Download startet neu"
                )));
            }
            existing
        }
        StatusCode::OK => 0,
        // Ohne Groessenangabe kann der Teil-Download bereits vollstaendig sein; die
        // anschliessende SHA-Pruefung entscheidet (und verwirft ihn bei Abweichung).
        StatusCode::RANGE_NOT_SATISFIABLE if expected.size_bytes.is_none() => return Ok(()),
        StatusCode::RANGE_NOT_SATISFIABLE => {
            fs::remove_file(part).ok();
            return Err(transport(anyhow!(
                "Teil-Download wurde abgelehnt; naechster Versuch startet neu"
            )));
        }
        status => {
            return Err(transport(anyhow!(
                "Download-Quelle antwortete mit {status}"
            )))
        }
    };
    if let (Some(size), Some(length)) = (expected.size_bytes, response.content_length()) {
        if offset + length != size {
            if offset == 0 {
                fs::remove_file(part).ok();
            }
            return Err(FetchError::Integrity(anyhow!(
                "Groesse der Quelle ({}) passt nicht zum Manifest ({size})",
                offset + length
            )));
        }
    }

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(part)
        .map_err(|err| transport(err.into()))?;
    progress(offset, expected.size_bytes);
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(err) => {
                file.flush().ok();
                return Err(transport(anyhow!("Download unterbrochen: {err}")));
            }
        };
        offset += chunk.len() as u64;
        if expected.size_bytes.is_some_and(|size| offset > size) {
            drop(file);
            fs::remove_file(part).ok();
            return Err(FetchError::Integrity(anyhow!(
                "Quelle liefert mehr Bytes als das Manifest erlaubt"
            )));
        }
        file.write_all(&chunk)
            .map_err(|err| transport(err.into()))?;
        progress(offset, expected.size_bytes);
    }
    file.sync_all().map_err(|err| transport(err.into()))?;
    if expected.size_bytes.is_some_and(|size| offset < size) {
        return Err(transport(anyhow!(
            "Download nach {offset} Bytes beendet; Fortsetzung beim naechsten Versuch"
        )));
    }
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file =
        File::open(path).with_context(|| format!("Hash-Datei fehlt: {}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Nachweis einer bestandenen Groessen- + SHA-256-Pruefung. Nur `verify_or_discard` erzeugt
/// ihn; `PackageStore::promote` akzeptiert nichts anderes.
#[derive(Debug)]
pub struct VerifiedFile {
    path: PathBuf,
    sha256: String,
    size_bytes: u64,
}

impl VerifiedFile {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Exakte Groesse + SHA-256. Bei Abweichung wird die Datei verworfen (fail closed).
pub fn verify_or_discard(path: &Path, expected: ExpectedArtifact<'_>) -> Result<VerifiedFile> {
    let size = fs::metadata(path)?.len();
    if let Some(expected_size) = expected.size_bytes {
        if size != expected_size {
            fs::remove_file(path).ok();
            bail!("Groessen-Mismatch: erwartet {expected_size} Bytes, erhalten {size}");
        }
    }
    let actual = sha256_file(path)?;
    if !actual.eq_ignore_ascii_case(expected.sha256) {
        fs::remove_file(path).ok();
        bail!(
            "SHA256-Mismatch: erwartet {}, erhalten {actual}",
            expected.sha256
        );
    }
    Ok(VerifiedFile {
        path: path.to_path_buf(),
        sha256: actual,
        size_bytes: size,
    })
}

/// Laedt ein Artefakt inhaltsadressiert nach `<staging>/<sha256>.part` und gibt den Pfad erst
/// nach bestandener Verifikation zurueck. Unterbrochene Downloads werden per Range fortgesetzt.
pub async fn fetch_verified(
    client: &reqwest::Client,
    sources: &[Url],
    staging: &Path,
    expected: ExpectedArtifact<'_>,
    progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
) -> Result<VerifiedFile> {
    validate_sha256(expected.sha256)?;
    if sources.is_empty() {
        bail!("Keine Download-Quelle angegeben");
    }
    fs::create_dir_all(staging)?;
    let part = staging_part_path(staging, expected.sha256);
    let mut last_error = None;
    for url in sources {
        match fetch_into_part(client, url, &part, expected, progress).await {
            Ok(()) => {
                last_error = None;
                break;
            }
            Err(FetchError::Integrity(err)) => {
                return Err(err.context(format!(
                    "Quelle {} verworfen",
                    url.origin().ascii_serialization()
                )));
            }
            Err(FetchError::Transport(err)) => last_error = Some(err),
        }
    }
    if let Some(err) = last_error {
        return Err(err);
    }
    let verify_path = part;
    let sha = expected.sha256.to_string();
    let size = expected.size_bytes;
    tokio::task::spawn_blocking(move || {
        verify_or_discard(
            &verify_path,
            ExpectedArtifact {
                sha256: &sha,
                size_bytes: size,
            },
        )
    })
    .await
    .map_err(|err| anyhow!("Verifikation abgebrochen: {err}"))?
}

// ---------------------------------------------------------------------------------------
// Installierter Paketbaum, Ledger, Update/Rollback/Entfernen
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledVersion {
    pub version: String,
    pub channel: Channel,
    pub file_name: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub verified_at: String,
    /// mtime beim Promote; Abweichung erzwingt vor Nutzung eine erneute Hash-Pruefung.
    pub modified_unix_secs: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageLedger {
    pub schema_version: u32,
    pub package_id: String,
    pub active: Option<String>,
    pub previous: Option<String>,
    pub pinned: Option<String>,
    pub installed: Vec<InstalledVersion>,
}

impl PackageLedger {
    fn new(package_id: &str) -> Self {
        Self {
            schema_version: LEDGER_SCHEMA_VERSION,
            package_id: package_id.to_string(),
            active: None,
            previous: None,
            pinned: None,
            installed: Vec::new(),
        }
    }

    pub fn entry(&self, version: &str) -> Option<&InstalledVersion> {
        self.installed.iter().find(|entry| entry.version == version)
    }

    pub fn active_entry(&self) -> Option<&InstalledVersion> {
        self.active.as_deref().and_then(|v| self.entry(v))
    }

    fn validate(&self, package_id: &str) -> Result<()> {
        if self.schema_version != LEDGER_SCHEMA_VERSION || self.package_id != package_id {
            bail!("Paket-Ledger passt nicht zu {package_id}");
        }
        for entry in &self.installed {
            SemVer::parse(&entry.version)?;
            validate_file_name(&entry.file_name)?;
            validate_sha256(&entry.sha256)?;
        }
        for version in [&self.active, &self.previous, &self.pinned]
            .into_iter()
            .flatten()
        {
            SemVer::parse(version)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateState {
    NotInstalled,
    Current,
    UpdateAvailable,
    Pinned,
    NewerInstalled,
}

impl UpdateState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotInstalled => "not_installed",
            Self::Current => "current",
            Self::UpdateAvailable => "update_available",
            Self::Pinned => "pinned",
            Self::NewerInstalled => "newer_installed",
        }
    }
}

pub fn plan_update(ledger: Option<&PackageLedger>, available: &str) -> Result<UpdateState> {
    let available_version = SemVer::parse(available)?;
    let Some(active) = ledger.and_then(PackageLedger::active_entry) else {
        return Ok(UpdateState::NotInstalled);
    };
    if let Some(pinned) = ledger.and_then(|l| l.pinned.as_deref()) {
        if pinned != available {
            return Ok(UpdateState::Pinned);
        }
    }
    Ok(
        match SemVer::parse(&active.version)?.cmp(&available_version) {
            Ordering::Less => UpdateState::UpdateAvailable,
            Ordering::Equal => UpdateState::Current,
            Ordering::Greater => UpdateState::NewerInstalled,
        },
    )
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn modified_secs(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)?
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0))
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

/// Paketbaum unterhalb von `<root>`:
/// `packages/<id>/<version>/<file>`, `packages/<id>/ledger.json`, `staging/<sha256>.part`.
#[derive(Debug, Clone)]
pub struct PackageStore {
    root: PathBuf,
}

impl PackageStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn staging_dir(&self) -> PathBuf {
        self.root.join("staging")
    }

    fn packages_dir(&self) -> PathBuf {
        self.root.join("packages")
    }

    fn package_dir(&self, package_id: &str) -> Result<PathBuf> {
        validate_package_id(package_id)?;
        Ok(self.packages_dir().join(package_id))
    }

    fn version_dir(&self, package_id: &str, version: &str) -> Result<PathBuf> {
        SemVer::parse(version)?;
        Ok(self.package_dir(package_id)?.join(version))
    }

    fn ledger_path(&self, package_id: &str) -> Result<PathBuf> {
        Ok(self.package_dir(package_id)?.join("ledger.json"))
    }

    pub fn load_ledger(&self, package_id: &str) -> Result<Option<PackageLedger>> {
        let path = self.ledger_path(package_id)?;
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(err) => return Err(err.into()),
        };
        let ledger: PackageLedger =
            serde_json::from_str(&text).context("Paket-Ledger ist beschaedigt")?;
        ledger.validate(package_id)?;
        Ok(Some(ledger))
    }

    fn save_ledger(&self, ledger: &PackageLedger) -> Result<()> {
        let dir = self.package_dir(&ledger.package_id)?;
        fs::create_dir_all(&dir)?;
        write_atomic(
            &dir.join("ledger.json"),
            &serde_json::to_vec_pretty(ledger)?,
        )
    }

    fn artifact_path(&self, package_id: &str, entry: &InstalledVersion) -> Result<PathBuf> {
        validate_file_name(&entry.file_name)?;
        Ok(self
            .version_dir(package_id, &entry.version)?
            .join(&entry.file_name))
    }

    /// Guenstige Pruefung fuer Statusanzeigen: Ledger-Eintrag, reguläre Datei, exakte Groesse.
    pub fn active_installed(&self, package_id: &str) -> Result<Option<PathBuf>> {
        let Some(ledger) = self.load_ledger(package_id)? else {
            return Ok(None);
        };
        let Some(entry) = ledger.active_entry() else {
            return Ok(None);
        };
        let path = self.artifact_path(package_id, entry)?;
        let ok = fs::symlink_metadata(&path)
            .is_ok_and(|meta| meta.file_type().is_file() && meta.len() == entry.size_bytes);
        Ok(ok.then_some(path))
    }

    /// Strenge Pruefung vor dem Start: Groesse + mtime; bei veraenderter mtime erneuter
    /// SHA-256-Abgleich. Unverifizierte Gewichte werden nie zurueckgegeben.
    pub fn resolve_for_launch(&self, package_id: &str) -> Result<PathBuf> {
        let mut ledger = self
            .load_ledger(package_id)?
            .ok_or_else(|| anyhow!("Modellpaket {package_id} ist nicht installiert"))?;
        let entry = ledger
            .active_entry()
            .cloned()
            .ok_or_else(|| anyhow!("Modellpaket {package_id} hat keine aktive Version"))?;
        let path = self.artifact_path(package_id, &entry)?;
        let meta = fs::symlink_metadata(&path)
            .with_context(|| format!("Modelldatei fuer {} fehlt", entry.version))?;
        if !meta.file_type().is_file() || meta.len() != entry.size_bytes {
            bail!(
                "Modelldatei {}@{} ist unvollstaendig oder ersetzt",
                package_id,
                entry.version
            );
        }
        let modified = modified_secs(&path)?;
        if modified != entry.modified_unix_secs {
            let actual = sha256_file(&path)?;
            if !actual.eq_ignore_ascii_case(&entry.sha256) {
                bail!(
                    "Modelldatei {}@{} wurde veraendert (SHA256-Mismatch)",
                    package_id,
                    entry.version
                );
            }
            if let Some(stored) = ledger
                .installed
                .iter_mut()
                .find(|e| e.version == entry.version)
            {
                stored.modified_unix_secs = modified;
            }
            self.save_ledger(&ledger)?;
        }
        Ok(path)
    }

    /// Uebernimmt eine bereits verifizierte Datei atomar als neue aktive Version.
    /// Die bisher aktive Version wird Rollback-Ziel; aeltere Versionen werden entfernt.
    pub fn promote(&self, package: &ModelPackage, verified: VerifiedFile) -> Result<PackageLedger> {
        validate_package_id(&package.package_id)?;
        validate_file_name(&package.file_name)?;
        if !verified.sha256.eq_ignore_ascii_case(&package.sha256)
            || verified.size_bytes != package.size_bytes
        {
            bail!(
                "Verifizierte Datei gehoert nicht zu {}@{}",
                package.package_id,
                package.version
            );
        }
        let package_dir = self.package_dir(&package.package_id)?;
        let final_dir = self.version_dir(&package.package_id, &package.version)?;
        fs::create_dir_all(&package_dir)?;

        let incoming = package_dir.join(format!(".incoming-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&incoming)?;
        let incoming_file = incoming.join(&package.file_name);
        if let Err(err) = fs::rename(&verified.path, &incoming_file) {
            fs::remove_dir_all(&incoming).ok();
            return Err(err).context("Verifizierte Datei konnte nicht uebernommen werden");
        }
        let modified = modified_secs(&incoming_file)?;

        let mut displaced = None;
        if fs::symlink_metadata(&final_dir).is_ok() {
            let trash = package_dir.join(format!(".replaced-{}", uuid::Uuid::new_v4().simple()));
            fs::rename(&final_dir, &trash)?;
            displaced = Some(trash);
        }
        if let Err(err) = fs::rename(&incoming, &final_dir) {
            if let Some(trash) = &displaced {
                fs::rename(trash, &final_dir).ok();
            }
            fs::remove_dir_all(&incoming).ok();
            return Err(err).context("Atomarer Promote fehlgeschlagen");
        }
        if let Some(trash) = displaced {
            fs::remove_dir_all(trash).ok();
        }

        let mut ledger = self
            .load_ledger(&package.package_id)
            .ok()
            .flatten()
            .unwrap_or_else(|| PackageLedger::new(&package.package_id));
        ledger
            .installed
            .retain(|entry| entry.version != package.version);
        ledger.installed.push(InstalledVersion {
            version: package.version.clone(),
            channel: package.channel,
            file_name: package.file_name.clone(),
            sha256: package.sha256.to_ascii_lowercase(),
            size_bytes: package.size_bytes,
            verified_at: now_rfc3339(),
            modified_unix_secs: modified,
        });
        if ledger.active.as_deref() != Some(package.version.as_str()) {
            ledger.previous = ledger.active.take();
        }
        ledger.active = Some(package.version.clone());
        self.prune(&mut ledger)?;
        self.save_ledger(&ledger)?;
        Ok(ledger)
    }

    /// Behaelt aktive, Rollback- und gepinnte Version; alles andere wird entfernt.
    fn prune(&self, ledger: &mut PackageLedger) -> Result<()> {
        let keep = |version: &str| {
            [&ledger.active, &ledger.previous, &ledger.pinned]
                .into_iter()
                .any(|kept| kept.as_deref() == Some(version))
        };
        let stale: Vec<String> = ledger
            .installed
            .iter()
            .filter(|entry| !keep(&entry.version))
            .map(|entry| entry.version.clone())
            .collect();
        for version in stale {
            self.remove_version_dir(&ledger.package_id, &version)?;
            ledger.installed.retain(|entry| entry.version != version);
        }
        if ledger
            .previous
            .as_deref()
            .is_some_and(|v| ledger.entry(v).is_none())
        {
            ledger.previous = None;
        }
        Ok(())
    }

    /// Wechselt auf die vorherige Version und pinnt sie, damit kein Update sie sofort ersetzt.
    pub fn rollback(&self, package_id: &str) -> Result<PackageLedger> {
        let mut ledger = self
            .load_ledger(package_id)?
            .ok_or_else(|| anyhow!("Modellpaket {package_id} ist nicht installiert"))?;
        let target = ledger
            .previous
            .clone()
            .filter(|v| ledger.entry(v).is_some())
            .ok_or_else(|| anyhow!("Keine Rollback-Version fuer {package_id} vorhanden"))?;
        ledger.previous = ledger.active.replace(target.clone());
        ledger.pinned = Some(target);
        self.save_ledger(&ledger)?;
        Ok(ledger)
    }

    pub fn set_pin(&self, package_id: &str, version: Option<&str>) -> Result<PackageLedger> {
        let mut ledger = self
            .load_ledger(package_id)?
            .ok_or_else(|| anyhow!("Modellpaket {package_id} ist nicht installiert"))?;
        if let Some(version) = version {
            SemVer::parse(version)?;
        }
        ledger.pinned = version.map(str::to_string);
        self.save_ledger(&ledger)?;
        Ok(ledger)
    }

    fn remove_version_dir(&self, package_id: &str, version: &str) -> Result<()> {
        let dir = self.version_dir(package_id, version)?;
        let meta = match fs::symlink_metadata(&dir) {
            Ok(meta) => meta,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(err) => return Err(err.into()),
        };
        if !meta.file_type().is_dir() {
            bail!("Versionspfad {version} ist kein reguläres Verzeichnis; Entfernen verweigert");
        }
        let packages = fs::canonicalize(self.packages_dir())?;
        if !fs::canonicalize(&dir)?.starts_with(&packages) {
            bail!("Versionspfad liegt ausserhalb des Paketbaums; Entfernen verweigert");
        }
        fs::remove_dir_all(dir)?;
        Ok(())
    }

    /// Entfernt eine Version sicher. Die aktive Version wird nicht entfernt, solange sie laeuft.
    pub fn remove_version(
        &self,
        package_id: &str,
        version: &str,
        active_in_use: bool,
    ) -> Result<Option<PackageLedger>> {
        let mut ledger = self
            .load_ledger(package_id)?
            .ok_or_else(|| anyhow!("Modellpaket {package_id} ist nicht installiert"))?;
        if ledger.entry(version).is_none() {
            bail!("Version {version} von {package_id} ist nicht installiert");
        }
        let is_active = ledger.active.as_deref() == Some(version);
        if is_active && active_in_use {
            bail!("Aktive Version {version} wird gerade genutzt; zuerst stoppen");
        }
        self.remove_version_dir(package_id, version)?;
        ledger.installed.retain(|entry| entry.version != version);
        if is_active {
            ledger.active = ledger.previous.take();
        }
        if ledger.previous.as_deref() == Some(version) {
            ledger.previous = None;
        }
        if ledger.pinned.as_deref() == Some(version) {
            ledger.pinned = None;
        }
        if ledger.installed.is_empty() {
            let dir = self.package_dir(package_id)?;
            fs::remove_file(dir.join("ledger.json")).ok();
            fs::remove_dir(&dir).ok();
            return Ok(None);
        }
        self.save_ledger(&ledger)?;
        Ok(Some(ledger))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        net::TcpListener,
        sync::{Arc, Mutex},
    };

    fn sha_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn approved_license() -> PackageLicense {
        PackageLicense {
            spdx: "Apache-2.0".into(),
            notice_refs: vec!["packages/example/1.0.0/NOTICE".into()],
            user_acceptance_required: false,
            acceptance_text_ref: None,
            redistribution: Redistribution {
                status: RedistributionStatus::Approved,
                reviewed_by: Some("NMKato".into()),
                reviewed_at: Some("2026-10-06".into()),
                basis: Some("Apache-2.0 erlaubt Weitergabe mit NOTICE".into()),
            },
        }
    }

    fn package(version: &str, bytes: &[u8]) -> ModelPackage {
        ModelPackage {
            schema: PACKAGE_SCHEMA.into(),
            package_id: "kato-test-brain".into(),
            version: version.into(),
            channel: if version.contains('-') {
                Channel::Beta
            } else {
                Channel::Stable
            },
            release_state: ReleaseState::Public,
            file_name: "model.gguf".into(),
            size_bytes: bytes.len() as u64,
            sha256: sha_hex(bytes),
            quantization: "Q4_0".into(),
            minimum_ram_gb: 12,
            preferred_ram_gb: 16,
            context_tokens: 8192,
            platforms: vec!["macos-aarch64".into()],
            runtime: RuntimeRequirement {
                id: "llama-cpp".into(),
                versions: vec!["b11272".into()],
            },
            license: approved_license(),
            object_key: format!("packages/kato-test-brain/{version}/model.gguf"),
            upstream_url: None,
        }
    }

    fn prod_policy() -> OriginPolicy {
        OriginPolicy::new(&["models.example.org".into(), "huggingface.co".into()]).unwrap()
    }

    fn tempdir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "katosync-model-dist-{tag}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ----- Vertrag ------------------------------------------------------------------------

    #[test]
    fn valid_public_package_passes_validation() {
        package("1.2.0", b"weights")
            .validate(&prod_policy())
            .unwrap();
    }

    #[test]
    fn manifest_validation_rejects_malformed_fields() {
        let policy = prod_policy();
        type Mutation = Box<dyn Fn(&mut ModelPackage)>;
        let cases: Vec<(&str, Mutation)> = vec![
            (
                "schema",
                Box::new(|p| p.schema = "kato-model-package/9".into()),
            ),
            ("version", Box::new(|p| p.version = "1.0".into())),
            ("leading zero", Box::new(|p| p.version = "01.0.0".into())),
            ("sha", Box::new(|p| p.sha256 = "ABC".into())),
            ("size", Box::new(|p| p.size_bytes = 0)),
            ("ram", Box::new(|p| p.preferred_ram_gb = 4)),
            ("ctx", Box::new(|p| p.context_tokens = 16)),
            ("platform", Box::new(|p| p.platforms = vec!["macos".into()])),
            ("runtime", Box::new(|p| p.runtime.versions.clear())),
            ("file", Box::new(|p| p.file_name = "model.bin".into())),
            ("id", Box::new(|p| p.package_id = "Kato_Brain".into())),
            (
                "key layout",
                Box::new(|p| p.object_key = "packages/other/1.2.0/model.gguf".into()),
            ),
            (
                "stable prerelease",
                Box::new(|p| {
                    p.version = "1.3.0-beta.1".into();
                    p.object_key = "packages/kato-test-brain/1.3.0-beta.1/model.gguf".into();
                }),
            ),
        ];
        for (label, mutate) in cases {
            let mut candidate = package("1.2.0", b"weights");
            mutate(&mut candidate);
            assert!(
                candidate.validate(&policy).is_err(),
                "{label} muss scheitern"
            );
        }
    }

    #[test]
    fn path_traversal_is_rejected_everywhere() {
        for key in [
            "../secrets",
            "packages/../../etc/passwd",
            "/packages/a/1.0.0/model.gguf",
            "packages//model.gguf",
            "packages/a/./model.gguf",
            "packages\\a\\model.gguf",
            "packages/%2e%2e/model.gguf",
            "",
        ] {
            assert!(validate_object_key(key).is_err(), "{key:?}");
        }
        for name in [
            "../model.gguf",
            "a/b.gguf",
            "..gguf",
            ".hidden.gguf",
            "model.gguf\0",
        ] {
            assert!(validate_file_name(name).is_err(), "{name:?}");
        }
        for id in ["..", "a/b", "", "-lead"] {
            assert!(validate_package_id(id).is_err(), "{id:?}");
        }
        let store = PackageStore::new(tempdir("traversal"));
        assert!(store.version_dir("kato-test-brain", "../../x").is_err());
        assert!(store.package_dir("../escape").is_err());
    }

    #[test]
    fn release_gate_blocks_public_without_license_review() {
        let policy = prod_policy();
        let mut pending = package("1.0.0", b"w");
        pending.license.redistribution = Redistribution {
            status: RedistributionStatus::PendingReview,
            reviewed_by: None,
            reviewed_at: None,
            basis: None,
        };
        assert_eq!(
            release_gate_blockers(&pending),
            vec![
                "redistribution_not_approved",
                "redistribution_review_incomplete"
            ]
        );
        assert!(pending.validate(&policy).is_err());
        pending.release_state = ReleaseState::Internal;
        pending.validate(&policy).unwrap();

        let mut acceptance = package("1.0.0", b"w");
        acceptance.license.user_acceptance_required = true;
        acceptance.license.notice_refs.clear();
        assert_eq!(
            release_gate_blockers(&acceptance),
            vec!["license_notice_missing", "acceptance_text_missing"]
        );
        assert!(release_gate_blockers(&package("1.0.0", b"w")).is_empty());
    }

    // ----- Versionen ----------------------------------------------------------------------

    #[test]
    fn semver_precedence_follows_spec() {
        let ordered = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.0.1",
            "1.10.0",
            "2.0.0",
        ];
        for pair in ordered.windows(2) {
            let (a, b) = (
                SemVer::parse(pair[0]).unwrap(),
                SemVer::parse(pair[1]).unwrap(),
            );
            assert!(a < b, "{} < {}", pair[0], pair[1]);
        }
        assert_eq!(
            SemVer::parse("1.0.0+build.5").unwrap(),
            SemVer::parse("1.0.0").unwrap()
        );
        for bad in [
            "1", "1.0", "1.0.0.0", "v1.0.0", "1.0.0-", "1.0.0-01", "1..0",
        ] {
            assert!(SemVer::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn index_selection_respects_channel_gate_platform_and_pin() {
        let policy = prod_policy();
        let mut gated = package("1.5.0", b"w");
        gated.license.redistribution.status = RedistributionStatus::PendingReview;
        let mut foreign_platform = package("1.4.0", b"w");
        foreign_platform.platforms = vec!["windows-x86_64".into()];
        let mut internal = package("1.3.0", b"w");
        internal.release_state = ReleaseState::Internal;
        let index = ChannelIndex {
            schema: INDEX_SCHEMA.into(),
            channel: Channel::Stable,
            packages: vec![
                package("1.0.0", b"w"),
                package("1.2.0", b"w"),
                gated,
                foreign_platform,
                internal,
            ],
        };
        let pick = |pin| {
            select_release(
                &index,
                "kato-test-brain",
                pin,
                "macos-aarch64",
                "b11272",
                &policy,
            )
            .unwrap()
            .map(|p| p.version.clone())
        };
        assert_eq!(pick(None).as_deref(), Some("1.2.0"));
        assert_eq!(pick(Some("1.0.0")).as_deref(), Some("1.0.0"));
        assert_eq!(pick(Some("1.5.0")), None);
        assert!(select_release(
            &index,
            "kato-test-brain",
            None,
            "macos-aarch64",
            "b9999",
            &policy
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn update_plan_reports_current_available_pinned_and_newer() {
        let store = PackageStore::new(tempdir("plan"));
        let pkg = package("1.0.0", b"v1");
        assert_eq!(
            plan_update(None, "1.0.0").unwrap(),
            UpdateState::NotInstalled
        );
        let mut ledger = install(&store, &pkg, b"v1");
        assert_eq!(
            plan_update(Some(&ledger), "1.0.0").unwrap(),
            UpdateState::Current
        );
        assert_eq!(
            plan_update(Some(&ledger), "1.1.0").unwrap(),
            UpdateState::UpdateAvailable
        );
        assert_eq!(
            plan_update(Some(&ledger), "0.9.0").unwrap(),
            UpdateState::NewerInstalled
        );
        ledger.pinned = Some("1.0.0".into());
        assert_eq!(
            plan_update(Some(&ledger), "1.1.0").unwrap(),
            UpdateState::Pinned
        );
    }

    // ----- Herkunft -----------------------------------------------------------------------

    #[test]
    fn origin_policy_requires_https_allowlist_and_no_credentials() {
        let policy = prod_policy();
        policy
            .check("https://models.example.org/packages/a/1.0.0/m.gguf")
            .unwrap();
        for bad in [
            "http://models.example.org/m.gguf",
            "https://evil.example.com/m.gguf",
            "https://user:pw@models.example.org/m.gguf",
            "https://models.example.org/m.gguf?X-Amz-Signature=abc",
            "https://models.example.org/m.gguf#frag",
            "file:///etc/passwd",
            "http://127.0.0.1:9/m.gguf",
        ] {
            assert!(policy.check(bad).is_err(), "{bad}");
        }
        assert!(OriginPolicy::new(&["10.0.0.1".into()]).is_err());
        assert!(OriginPolicy::new(&["bad host".into()]).is_err());
    }

    #[test]
    fn distribution_base_resolves_only_inside_its_prefix() {
        let policy = prod_policy();
        let base = DistributionBase::parse("https://models.example.org/kato", &policy).unwrap();
        assert_eq!(
            base.resolve("packages/a/1.0.0/m.gguf", &policy)
                .unwrap()
                .as_str(),
            "https://models.example.org/kato/packages/a/1.0.0/m.gguf"
        );
        assert!(base.resolve("../m.gguf", &policy).is_err());
        assert!(base.resolve("//evil.example.com/m.gguf", &policy).is_err());
        assert!(DistributionBase::parse("https://models.example.org/?token=1", &policy).is_err());
    }

    #[test]
    fn non_public_packages_never_use_own_distribution_channel() {
        let policy = prod_policy();
        let base = DistributionBase::parse("https://models.example.org/", &policy).unwrap();
        let mut pkg = package("1.0.0", b"w");
        pkg.upstream_url = Some("https://huggingface.co/org/repo/resolve/rev/model.gguf".into());
        let public = download_sources(&pkg, Some(&base), &policy).unwrap();
        assert_eq!(public.len(), 2);
        assert_eq!(public[0].host_str(), Some("models.example.org"));

        pkg.release_state = ReleaseState::Internal;
        let internal = download_sources(&pkg, Some(&base), &policy).unwrap();
        assert_eq!(internal.len(), 1);
        assert_eq!(internal[0].host_str(), Some("huggingface.co"));

        pkg.upstream_url = None;
        assert!(download_sources(&pkg, Some(&base), &policy).is_err());
    }

    // ----- Download -----------------------------------------------------------------------

    #[derive(Clone, Copy)]
    enum Serve {
        Full,
        CutAfter(usize),
        IgnoreRange,
        Status(u16),
    }

    /// Loopback-Server mit Range-Unterstuetzung; je Verbindung ein Verhalten aus `plan`.
    fn mock_origin(payload: Vec<u8>, plan: Vec<Serve>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/model.gguf", listener.local_addr().unwrap());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        std::thread::spawn(move || {
            for (stream, serve) in listener.incoming().zip(plan) {
                let Ok(mut stream) = stream else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range_start = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range_start = value.trim().trim_end_matches('-').parse::<usize>().ok();
                    }
                }
                seen.lock().unwrap().push(
                    range_start
                        .map(|s| format!("bytes={s}-"))
                        .unwrap_or_default(),
                );
                let total = payload.len();
                let (head, body): (String, &[u8]) = match (serve, range_start) {
                    (Serve::Status(code), _) => {
                        (format!("HTTP/1.1 {code} X\r\nContent-Length: 0\r\n"), &[])
                    }
                    (Serve::IgnoreRange, _) | (_, None) => (
                        format!("HTTP/1.1 200 OK\r\nContent-Length: {total}\r\n"),
                        &payload,
                    ),
                    (_, Some(start)) => (
                        format!(
                            "HTTP/1.1 206 Partial\r\nContent-Length: {}\r\nContent-Range: bytes {start}-{}/{total}\r\n",
                            total - start,
                            total - 1
                        ),
                        &payload[start..],
                    ),
                };
                let body = match serve {
                    Serve::CutAfter(n) => &body[..n.min(body.len())],
                    _ => body,
                };
                let _ = write!(stream, "{head}Connection: close\r\n\r\n");
                let _ = stream.write_all(body);
            }
        });
        (base, ranges)
    }

    fn payload() -> Vec<u8> {
        (0..64 * 1024u32).flat_map(|n| n.to_le_bytes()).collect()
    }

    async fn fetch(url: &str, staging: &Path, sha: &str, size: u64) -> Result<VerifiedFile> {
        let policy = OriginPolicy::loopback_for_tests();
        let client = policy.http_client().unwrap();
        let sources = vec![policy.check(url).unwrap()];
        let mut progress = |_: u64, _: Option<u64>| {};
        fetch_verified(
            &client,
            &sources,
            staging,
            ExpectedArtifact {
                sha256: sha,
                size_bytes: Some(size),
            },
            &mut progress,
        )
        .await
    }

    #[tokio::test]
    async fn interrupted_download_keeps_part_and_resumes_with_range() {
        let data = payload();
        let sha = sha_hex(&data);
        let (url, ranges) = mock_origin(data.clone(), vec![Serve::CutAfter(100_000), Serve::Full]);
        let staging = tempdir("resume");

        assert!(fetch(&url, &staging, &sha, data.len() as u64)
            .await
            .is_err());
        let part = staging_part_path(&staging, &sha);
        assert_eq!(fs::metadata(&part).unwrap().len(), 100_000);

        let done = fetch(&url, &staging, &sha, data.len() as u64)
            .await
            .unwrap();
        assert_eq!(fs::read(done.path()).unwrap(), data);
        assert_eq!(ranges.lock().unwrap().as_slice(), ["", "bytes=100000-"]);
    }

    #[tokio::test]
    async fn server_ignoring_range_restarts_cleanly() {
        let data = payload();
        let sha = sha_hex(&data);
        let (url, _) = mock_origin(data.clone(), vec![Serve::IgnoreRange]);
        let staging = tempdir("norange");
        fs::write(staging_part_path(&staging, &sha), &data[..5000]).unwrap();
        let done = fetch(&url, &staging, &sha, data.len() as u64)
            .await
            .unwrap();
        assert_eq!(fs::read(done.path()).unwrap(), data);
    }

    #[tokio::test]
    async fn hash_mismatch_fails_closed_and_discards_part() {
        let data = payload();
        let wrong = sha_hex(b"other weights");
        let (url, _) = mock_origin(data.clone(), vec![Serve::Full]);
        let staging = tempdir("mismatch");
        let err = fetch(&url, &staging, &wrong, data.len() as u64)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("SHA256-Mismatch"), "{err:#}");
        assert!(!staging_part_path(&staging, &wrong).exists());
    }

    #[tokio::test]
    async fn size_mismatch_fails_before_downloading_wrong_object() {
        let data = payload();
        let sha = sha_hex(&data);
        let (url, _) = mock_origin(data.clone(), vec![Serve::Full]);
        let staging = tempdir("size");
        let err = fetch(&url, &staging, &sha, data.len() as u64 + 1)
            .await
            .unwrap_err();
        assert!(format!("{err:#}").contains("Groesse"), "{err:#}");
        assert!(!staging_part_path(&staging, &sha).exists());
    }

    #[tokio::test]
    async fn sizeless_complete_part_is_verified_not_trusted_on_416() {
        let data = payload();
        let sha = sha_hex(&data);
        let policy = OriginPolicy::loopback_for_tests();
        let client = policy.http_client().unwrap();
        let mut progress = |_: u64, _: Option<u64>| {};
        let expected = ExpectedArtifact {
            sha256: &sha,
            size_bytes: None,
        };

        let staging = tempdir("sizeless-ok");
        fs::write(staging_part_path(&staging, &sha), &data).unwrap();
        let (url, _) = mock_origin(data.clone(), vec![Serve::Status(416)]);
        let done = fetch_verified(
            &client,
            &[policy.check(&url).unwrap()],
            &staging,
            expected,
            &mut progress,
        )
        .await
        .unwrap();
        assert_eq!(fs::read(done.path()).unwrap(), data);

        let staging = tempdir("sizeless-bad");
        fs::write(staging_part_path(&staging, &sha), b"stale").unwrap();
        let (url, _) = mock_origin(data.clone(), vec![Serve::Status(416)]);
        assert!(fetch_verified(
            &client,
            &[policy.check(&url).unwrap()],
            &staging,
            expected,
            &mut progress
        )
        .await
        .is_err());
        assert!(!staging_part_path(&staging, &sha).exists());
    }

    #[tokio::test]
    async fn transport_failure_falls_back_to_next_source() {
        let data = payload();
        let sha = sha_hex(&data);
        let (broken, _) = mock_origin(data.clone(), vec![Serve::Status(503)]);
        let (good, _) = mock_origin(data.clone(), vec![Serve::Full]);
        let policy = OriginPolicy::loopback_for_tests();
        let client = policy.http_client().unwrap();
        let staging = tempdir("fallback");
        let mut progress = |_: u64, _: Option<u64>| {};
        let path = fetch_verified(
            &client,
            &[policy.check(&broken).unwrap(), policy.check(&good).unwrap()],
            &staging,
            ExpectedArtifact {
                sha256: &sha,
                size_bytes: Some(data.len() as u64),
            },
            &mut progress,
        )
        .await
        .unwrap();
        assert_eq!(fs::read(path.path()).unwrap(), data);
    }

    // ----- Installierter Baum -------------------------------------------------------------

    fn install(store: &PackageStore, pkg: &ModelPackage, bytes: &[u8]) -> PackageLedger {
        fs::create_dir_all(store.staging_dir()).unwrap();
        let part = staging_part_path(&store.staging_dir(), &pkg.sha256);
        fs::write(&part, bytes).unwrap();
        let verified = verify_or_discard(
            &part,
            ExpectedArtifact {
                sha256: &pkg.sha256,
                size_bytes: Some(pkg.size_bytes),
            },
        )
        .unwrap();
        store.promote(pkg, verified).unwrap()
    }

    #[test]
    fn promote_update_rollback_and_prune() {
        let root = tempdir("ledger");
        let store = PackageStore::new(root.clone());
        let v1 = package("1.0.0", b"one");
        let v2 = package("1.1.0", b"two");
        let v3 = package("1.2.0", b"three");

        install(&store, &v1, b"one");
        let ledger = install(&store, &v2, b"two");
        assert_eq!(ledger.active.as_deref(), Some("1.1.0"));
        assert_eq!(ledger.previous.as_deref(), Some("1.0.0"));
        assert!(!staging_part_path(&store.staging_dir(), &v2.sha256).exists());

        let rolled = store.rollback("kato-test-brain").unwrap();
        assert_eq!(rolled.active.as_deref(), Some("1.0.0"));
        assert_eq!(rolled.previous.as_deref(), Some("1.1.0"));
        assert_eq!(rolled.pinned.as_deref(), Some("1.0.0"));
        assert_eq!(
            plan_update(Some(&rolled), "1.1.0").unwrap(),
            UpdateState::Pinned
        );
        let launch = store.resolve_for_launch("kato-test-brain").unwrap();
        assert_eq!(fs::read(launch).unwrap(), b"one");

        store.set_pin("kato-test-brain", None).unwrap();
        let ledger = install(&store, &v3, b"three");
        assert_eq!(ledger.active.as_deref(), Some("1.2.0"));
        assert_eq!(ledger.previous.as_deref(), Some("1.0.0"));
        assert!(
            ledger.entry("1.1.0").is_none(),
            "alte Version wird entfernt"
        );
        assert!(!root.join("packages/kato-test-brain/1.1.0").exists());
    }

    #[test]
    fn tampered_or_truncated_weights_are_never_resolved() {
        let store = PackageStore::new(tempdir("tamper"));
        let pkg = package("1.0.0", b"genuine");
        install(&store, &pkg, b"genuine");
        let path = store.resolve_for_launch("kato-test-brain").unwrap();

        fs::write(&path, b"short").unwrap();
        assert!(store.active_installed("kato-test-brain").unwrap().is_none());
        assert!(store.resolve_for_launch("kato-test-brain").is_err());

        // Gleiche Groesse, anderer Inhalt + andere mtime → Re-Hash scheitert.
        fs::write(&path, b"forgery").unwrap();
        let file = File::options().write(true).open(&path).unwrap();
        file.set_modified(UNIX_EPOCH + Duration::from_secs(1))
            .unwrap();
        assert!(store.resolve_for_launch("kato-test-brain").is_err());
    }

    #[test]
    fn remove_version_is_safe() {
        let root = tempdir("remove");
        let store = PackageStore::new(root.clone());
        install(&store, &package("1.0.0", b"one"), b"one");
        install(&store, &package("1.1.0", b"two"), b"two");

        assert!(store
            .remove_version("kato-test-brain", "1.1.0", true)
            .is_err());
        assert!(store
            .remove_version("kato-test-brain", "9.9.9", false)
            .is_err());
        assert!(store
            .remove_version("kato-test-brain", "../..", false)
            .is_err());

        let ledger = store
            .remove_version("kato-test-brain", "1.1.0", false)
            .unwrap()
            .unwrap();
        assert_eq!(ledger.active.as_deref(), Some("1.0.0"));
        assert_eq!(ledger.previous, None);
        assert!(store
            .remove_version("kato-test-brain", "1.0.0", false)
            .unwrap()
            .is_none());
        assert!(!root.join("packages/kato-test-brain").exists());
        assert!(
            root.join("packages").exists(),
            "Nur das Paket wird entfernt"
        );
    }

    #[cfg(unix)]
    #[test]
    fn remove_refuses_symlinked_version_dir() {
        let root = tempdir("symlink");
        let outside = tempdir("outside");
        fs::write(outside.join("keep.txt"), b"keep").unwrap();
        let store = PackageStore::new(root.clone());
        install(&store, &package("1.0.0", b"one"), b"one");
        let version_dir = root.join("packages/kato-test-brain/1.0.0");
        fs::remove_dir_all(&version_dir).unwrap();
        std::os::unix::fs::symlink(&outside, &version_dir).unwrap();
        assert!(store
            .remove_version("kato-test-brain", "1.0.0", false)
            .is_err());
        assert!(outside.join("keep.txt").exists());
    }

    #[test]
    fn persisted_state_contains_no_urls_or_secrets() {
        let root = tempdir("secrets");
        let store = PackageStore::new(root.clone());
        let mut pkg = package("1.0.0", b"one");
        pkg.upstream_url = Some("https://huggingface.co/org/repo/resolve/rev/model.gguf".into());
        install(&store, &pkg, b"one");
        for entry in walkdir::WalkDir::new(&root)
            .into_iter()
            .filter_map(Result::ok)
        {
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(!name.contains("://") && !name.contains('?'), "{name}");
            if entry.file_type().is_file() && name.ends_with(".json") {
                let text = fs::read_to_string(entry.path()).unwrap().to_lowercase();
                for needle in [
                    "://",
                    "token",
                    "signature",
                    "secret",
                    "authorization",
                    "huggingface",
                ] {
                    assert!(!text.contains(needle), "{name} enthaelt {needle}");
                }
            }
        }
    }

    #[test]
    fn corrupt_or_foreign_ledger_fails_closed() {
        let root = tempdir("corrupt");
        let store = PackageStore::new(root.clone());
        let dir = root.join("packages/kato-test-brain");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("ledger.json"), b"{not json").unwrap();
        assert!(store.load_ledger("kato-test-brain").is_err());
        assert!(store.resolve_for_launch("kato-test-brain").is_err());

        let foreign = serde_json::json!({
            "schemaVersion": 1, "packageId": "kato-test-brain", "active": "1.0.0",
            "previous": null, "pinned": null,
            "installed": [{ "version": "1.0.0", "channel": "stable", "fileName": "../../x.gguf",
              "sha256": "0".repeat(64), "sizeBytes": 1, "verifiedAt": "", "modifiedUnixSecs": 0 }]
        });
        fs::write(dir.join("ledger.json"), foreign.to_string()).unwrap();
        assert!(store.load_ledger("kato-test-brain").is_err());
    }
}
