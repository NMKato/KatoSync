// Created by NMKato Solutions
//! Sichere Entpackung verifizierter Archive (llama.cpp-Runtime) und Baum-Ledger.
//!
//! Das Archiv ist zu diesem Zeitpunkt bereits groessen- und SHA-256-geprueft. Trotzdem gilt
//! beim Entpacken:
//!
//! - harte Obergrenzen: dekomprimierter Gesamtstrom, Summe der Dateien, Einzeldatei,
//!   Eintragsanzahl, Pfadtiefe,
//! - Pfade werden normalisiert; `..`, absolute Pfade, Laufwerks-/Backslash-Pfade und
//!   Steuerzeichen werden abgelehnt,
//! - Hardlinks, Geraete, FIFOs und sonstige Spezialeintraege werden abgelehnt,
//! - es wird nie ein Dateisystem-Link angelegt. Symlink-Eintraege sind im Modus `Reject`
//!   ein Fehler; im Modus `CopySiblingAliases` (nur fuer gepinnte Runtime-Archive mit
//!   soname-Ketten wie `libllama.0.dylib -> libllama.0.5.0.dylib`) wird ein Alias nur dann als
//!   regulaere Kopie angelegt, wenn sein Ziel ein Geschwister-Dateiname ist, der innerhalb
//!   desselben Archivs auf eine regulaere Datei aufloest,
//! - Ziel ist ein frisches, KatoSync-eigenes Staging-Verzeichnis (Unix 0700); bei jedem Fehler
//!   wird es vollstaendig entfernt. Erst danach folgt die atomare Promotion.

use crate::model_distribution::{self as dist, sha256_file};
use anyhow::{anyhow, bail, Context, Result};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

const TREE_SCHEMA_VERSION: u32 = 1;
const MAX_ALIAS_DEPTH: usize = 8;
const MAX_LINK_TARGET_LEN: usize = 255;
/// Zuschlag fuer Tar-Header/Padding auf den dekomprimierten Gesamtstrom.
const STREAM_OVERHEAD_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
pub struct ExtractLimits {
    pub max_total_bytes: u64,
    pub max_entries: usize,
    pub max_entry_bytes: u64,
    pub max_depth: usize,
}

/// llama.cpp-Release-Archive: ~60 Eintraege, < 100 MB entpackt.
pub const RUNTIME_ARCHIVE_LIMITS: ExtractLimits = ExtractLimits {
    max_total_bytes: 1024 * 1024 * 1024,
    max_entries: 4096,
    max_entry_bytes: 512 * 1024 * 1024,
    max_depth: 8,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkPolicy {
    Reject,
    CopySiblingAliases,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveFormat {
    TarGz,
    Zip,
}

impl ArchiveFormat {
    pub fn parse(raw: &str) -> Result<Self> {
        match raw {
            "tar.gz" => Ok(Self::TarGz),
            "zip" => Ok(Self::Zip),
            other => bail!("Nicht unterstuetztes Runtime-Archiv: {other}"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ExtractSummary {
    pub files: usize,
    pub bytes: u64,
    pub aliases: usize,
}

/// Normalisiert einen Archivpfad zu rein "normalen" Komponenten unterhalb des Ziels.
pub fn normalize_entry_path(raw: &[u8], max_depth: usize) -> Result<PathBuf> {
    let text = std::str::from_utf8(raw).map_err(|_| anyhow!("Archivpfad ist kein UTF-8"))?;
    if text.is_empty()
        || text.starts_with('/')
        || text.contains(['\0', '\\', ':'])
        || text.chars().any(char::is_control)
    {
        bail!("Unsicherer Pfad im Archiv: {text:?}");
    }
    let mut out = PathBuf::new();
    let mut depth = 0;
    for segment in text.split('/') {
        match segment {
            "" | "." => continue,
            ".." => bail!("Pfad-Traversal im Archiv: {text:?}"),
            segment => {
                out.push(segment);
                depth += 1;
            }
        }
    }
    if depth == 0 || depth > max_depth {
        bail!("Unzulaessige Pfadtiefe im Archiv: {text:?}");
    }
    Ok(out)
}

fn validate_alias_target(target: &[u8]) -> Result<String> {
    let text =
        std::str::from_utf8(target).map_err(|_| anyhow!("Link-Ziel im Archiv ist kein UTF-8"))?;
    if text.is_empty()
        || text.len() > MAX_LINK_TARGET_LEN
        || text == "."
        || text == ".."
        || text.contains(['/', '\\', ':', '\0'])
        || text.chars().any(char::is_control)
    {
        bail!("Symlink im Archiv zeigt nicht auf eine Geschwisterdatei: {text:?}");
    }
    Ok(text.to_string())
}

/// Fehler, sobald mehr als `remaining` Bytes gelesen werden (Dekompressionsbombe).
struct LimitedReader<R> {
    inner: R,
    remaining: u64,
}

impl<R: Read> Read for LimitedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        // Hoechstens ein Byte ueber dem Rest lesen, damit die Ueberschreitung erkannt wird,
        // ohne einen beliebig grossen Dekompressionsblock vorab in den Speicher zu ziehen.
        let allowed = self.remaining.saturating_add(1).min(buf.len() as u64) as usize;
        let read = self.inner.read(&mut buf[..allowed])?;
        if read as u64 > self.remaining {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "dekomprimierter Archivstrom ueberschreitet das Limit",
            ));
        }
        self.remaining -= read as u64;
        Ok(read)
    }
}

fn create_private_dir(dir: &Path) -> Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(dir)
        .with_context(|| format!("Staging-Verzeichnis {} existiert bereits", dir.display()))
}

struct Extractor<'a> {
    root: &'a Path,
    limits: ExtractLimits,
    links: LinkPolicy,
    entries: usize,
    total: u64,
    files: HashMap<PathBuf, bool>,
    aliases: HashMap<PathBuf, String>,
}

impl<'a> Extractor<'a> {
    fn new(root: &'a Path, limits: ExtractLimits, links: LinkPolicy) -> Self {
        Self {
            root,
            limits,
            links,
            entries: 0,
            total: 0,
            files: HashMap::new(),
            aliases: HashMap::new(),
        }
    }

    fn count_entry(&mut self) -> Result<()> {
        self.entries += 1;
        if self.entries > self.limits.max_entries {
            bail!("Archiv hat mehr als {} Eintraege", self.limits.max_entries);
        }
        Ok(())
    }

    fn target(&self, rel: &Path) -> Result<PathBuf> {
        let full = self.root.join(rel);
        if !full.starts_with(self.root) {
            bail!("Archivpfad verlaesst das Staging-Verzeichnis");
        }
        Ok(full)
    }

    fn dir(&mut self, rel: &Path) -> Result<()> {
        fs::create_dir_all(self.target(rel)?)?;
        Ok(())
    }

    fn file(&mut self, rel: &Path, reader: &mut dyn Read, declared: u64, exec: bool) -> Result<()> {
        if declared > self.limits.max_entry_bytes {
            bail!("Archiveintrag {} ist zu gross", rel.display());
        }
        // Deklarierte Groesse vor dem Schreiben gegen das Gesamtlimit pruefen; die
        // tatsaechlich geschriebenen Bytes werden danach zusaetzlich exakt abgeglichen.
        if self.total.saturating_add(declared) > self.limits.max_total_bytes {
            bail!(
                "Entpackte Gesamtgroesse ueberschreitet {} Bytes",
                self.limits.max_total_bytes
            );
        }
        let full = self.target(rel)?;
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(if exec { 0o755 } else { 0o644 });
        }
        let mut out = options.open(&full).with_context(|| {
            format!(
                "Archiveintrag {} ist doppelt oder kollidiert",
                rel.display()
            )
        })?;
        let written = io::copy(&mut reader.take(self.limits.max_entry_bytes + 1), &mut out)?;
        if written > self.limits.max_entry_bytes {
            bail!(
                "Archiveintrag {} ueberschreitet das Einzellimit",
                rel.display()
            );
        }
        if written != declared {
            bail!(
                "Archiveintrag {} hat {} statt der deklarierten {} Bytes",
                rel.display(),
                written,
                declared
            );
        }
        self.total += written;
        if self.total > self.limits.max_total_bytes {
            bail!(
                "Entpackte Gesamtgroesse ueberschreitet {} Bytes",
                self.limits.max_total_bytes
            );
        }
        self.files.insert(rel.to_path_buf(), exec);
        Ok(())
    }

    fn symlink(&mut self, rel: &Path, target: &[u8]) -> Result<()> {
        if self.links == LinkPolicy::Reject {
            bail!("Symlink im Archiv abgelehnt: {}", rel.display());
        }
        let target = validate_alias_target(target)?;
        if self.aliases.insert(rel.to_path_buf(), target).is_some() {
            bail!("Symlink {} ist doppelt im Archiv", rel.display());
        }
        Ok(())
    }

    /// Materialisiert Aliase als regulaere Kopien ihres archivinternen Ziels.
    fn finish(mut self) -> Result<ExtractSummary> {
        let aliases = std::mem::take(&mut self.aliases);
        for (alias, first_target) in &aliases {
            let dir = alias.parent().map(Path::to_path_buf).unwrap_or_default();
            let mut candidate = dir.join(first_target);
            let mut resolved = None;
            for _ in 0..MAX_ALIAS_DEPTH {
                if let Some(exec) = self.files.get(&candidate) {
                    resolved = Some((candidate.clone(), *exec));
                    break;
                }
                match aliases.get(&candidate) {
                    Some(next) => candidate = dir.join(next),
                    None => break,
                }
            }
            let (source, exec) = resolved.ok_or_else(|| {
                anyhow!(
                    "Symlink {} zeigt nicht auf eine Datei desselben Archivs",
                    alias.display()
                )
            })?;
            let mut reader = File::open(self.target(&source)?)?;
            let declared = reader.metadata()?.len();
            self.file(alias, &mut reader, declared, exec)?;
        }
        Ok(ExtractSummary {
            files: self.files.len(),
            bytes: self.total,
            aliases: aliases.len(),
        })
    }
}

fn exec_bit(mode: u32) -> bool {
    mode & 0o111 != 0
}

fn extract_tar_gz(path: &Path, extractor: &mut Extractor<'_>) -> Result<()> {
    let stream = LimitedReader {
        inner: GzDecoder::new(File::open(path)?),
        remaining: extractor.limits.max_total_bytes + STREAM_OVERHEAD_BYTES,
    };
    let mut archive = tar::Archive::new(stream);
    for entry in archive.entries()? {
        let mut entry = entry?;
        let kind = entry.header().entry_type();
        if kind == tar::EntryType::XGlobalHeader {
            continue;
        }
        extractor.count_entry()?;
        let rel = normalize_entry_path(&entry.path_bytes(), extractor.limits.max_depth)?;
        match kind {
            tar::EntryType::Directory => extractor.dir(&rel)?,
            tar::EntryType::Regular => {
                let declared = entry.header().size()?;
                let exec = exec_bit(entry.header().mode()?);
                extractor.file(&rel, &mut entry, declared, exec)?;
            }
            tar::EntryType::Symlink => {
                let target = entry
                    .link_name_bytes()
                    .ok_or_else(|| anyhow!("Symlink ohne Ziel im Archiv"))?
                    .into_owned();
                extractor.symlink(&rel, &target)?;
            }
            tar::EntryType::Link => bail!("Hardlink im Archiv abgelehnt: {}", rel.display()),
            other => bail!(
                "Spezialeintrag ({other:?}) im Archiv abgelehnt: {}",
                rel.display()
            ),
        }
    }
    // `tar` beendet die Iteration an den Endmarken. Den restlichen Gzip-Strom trotzdem
    // vollstaendig gegen das Dekompressionslimit lesen, damit angehaengte hochkomprimierte
    // Daten den Stream-Deckel nicht umgehen koennen.
    let mut stream = archive.into_inner();
    io::copy(&mut stream, &mut io::sink())?;
    Ok(())
}

const S_IFMT: u32 = 0o170000;
const S_IFDIR: u32 = 0o040000;
const S_IFREG: u32 = 0o100000;
const S_IFLNK: u32 = 0o120000;

fn extract_zip(path: &Path, extractor: &mut Extractor<'_>) -> Result<()> {
    let mut archive = zip::ZipArchive::new(File::open(path)?)?;
    if archive.len() > extractor.limits.max_entries {
        bail!(
            "Archiv hat mehr als {} Eintraege",
            extractor.limits.max_entries
        );
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        extractor.count_entry()?;
        let rel = normalize_entry_path(entry.name_raw(), extractor.limits.max_depth)?;
        let mode = entry.unix_mode();
        match mode.map(|m| m & S_IFMT) {
            Some(S_IFLNK) => {
                let mut target = Vec::new();
                (&mut entry)
                    .take(MAX_LINK_TARGET_LEN as u64 + 1)
                    .read_to_end(&mut target)?;
                extractor.symlink(&rel, &target)?;
            }
            Some(S_IFDIR) => extractor.dir(&rel)?,
            None | Some(0) if entry.is_dir() => extractor.dir(&rel)?,
            None | Some(0) | Some(S_IFREG) if !entry.is_dir() => {
                let declared = entry.size();
                let exec = mode.is_some_and(exec_bit);
                extractor.file(&rel, &mut entry, declared, exec)?;
            }
            _ => bail!("Spezialeintrag im Archiv abgelehnt: {}", rel.display()),
        }
    }
    Ok(())
}

/// Entpackt ein bereits verifiziertes Archiv in ein frisches, privates Verzeichnis
/// `destination` (darf noch nicht existieren). Bei Fehlern bleibt nichts zurueck.
pub fn extract_archive(
    archive: &Path,
    format: ArchiveFormat,
    destination: &Path,
    limits: ExtractLimits,
    links: LinkPolicy,
) -> Result<ExtractSummary> {
    create_private_dir(destination)?;
    let result = (|| {
        let mut extractor = Extractor::new(destination, limits, links);
        match format {
            ArchiveFormat::TarGz => extract_tar_gz(archive, &mut extractor)?,
            ArchiveFormat::Zip => extract_zip(archive, &mut extractor)?,
        }
        extractor.finish()
    })();
    if result.is_err() {
        fs::remove_dir_all(destination).ok();
    }
    result
}

// ---------------------------------------------------------------------------------------
// Baum-Ledger: Re-Verifikation vor Ausfuehrung
// ---------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeFile {
    pub path: String,
    pub sha256: String,
    pub size_bytes: u64,
}

/// Persistierter Nachweis eines verifiziert entpackten Baums (z. B. llama.cpp-Runtime).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTree {
    pub schema_version: u32,
    pub component: String,
    pub version: String,
    pub archive_sha256: String,
    pub executable: String,
    pub files: Vec<TreeFile>,
    pub verified_at: String,
}

impl InstalledTree {
    pub fn new(
        component: &str,
        version: &str,
        archive_sha256: &str,
        root: &Path,
        executable: &Path,
    ) -> Result<Self> {
        let executable = executable
            .strip_prefix(root)
            .map_err(|_| anyhow!("Executable liegt ausserhalb des Baums"))?;
        let executable = relative_string(executable)?;
        let files = hash_tree(root)?;
        if !files.iter().any(|file| file.path == executable) {
            bail!("Executable {executable} ist keine regulaere Datei des Baums");
        }
        Ok(Self {
            schema_version: TREE_SCHEMA_VERSION,
            component: component.to_string(),
            version: version.to_string(),
            archive_sha256: archive_sha256.to_string(),
            executable,
            files,
            verified_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        })
    }

    fn executable_path(&self, root: &Path) -> Result<PathBuf> {
        Ok(root.join(normalize_entry_path(
            self.executable.as_bytes(),
            RUNTIME_ARCHIVE_LIMITS.max_depth,
        )?))
    }
}

fn relative_string(path: &Path) -> Result<String> {
    let parts = path
        .components()
        .map(|component| match component {
            std::path::Component::Normal(part) => part
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| anyhow!("Pfad ist kein UTF-8")),
            _ => Err(anyhow!("Unerwartete Pfadkomponente")),
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(parts.join("/"))
}

/// Hasht alle Dateien eines Baums. Symlinks und Spezialdateien sind ein Fehler.
pub fn hash_tree(root: &Path) -> Result<Vec<TreeFile>> {
    let mut files = Vec::new();
    let mut total = 0u64;
    for entry in WalkDir::new(root).follow_links(false).sort_by_file_name() {
        let entry = entry?;
        let kind = entry.file_type();
        if kind.is_dir() {
            continue;
        }
        if !kind.is_file() {
            bail!(
                "Unerwarteter Link/Spezialeintrag {} im verifizierten Baum",
                entry.path().display()
            );
        }
        if files.len() >= RUNTIME_ARCHIVE_LIMITS.max_entries {
            bail!("Verifizierter Baum hat zu viele Dateien");
        }
        let rel = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| anyhow!("Pfad ausserhalb des Baums"))?;
        let normalized = normalize_entry_path(
            relative_string(rel)?.as_bytes(),
            RUNTIME_ARCHIVE_LIMITS.max_depth,
        )?;
        let meta = entry.metadata()?;
        if meta.len() > RUNTIME_ARCHIVE_LIMITS.max_entry_bytes {
            bail!("Datei {} im Runtime-Baum ist zu gross", rel.display());
        }
        total = total
            .checked_add(meta.len())
            .ok_or_else(|| anyhow!("Runtime-Baumgroesse ist uebergelaufen"))?;
        if total > RUNTIME_ARCHIVE_LIMITS.max_total_bytes {
            bail!("Runtime-Baum ueberschreitet die erlaubte Gesamtgroesse");
        }
        files.push(TreeFile {
            path: relative_string(&normalized)?,
            sha256: sha256_file(entry.path())?,
            size_bytes: meta.len(),
        });
    }
    Ok(files)
}

pub fn load_tree_ledger(path: &Path) -> Result<Option<InstalledTree>> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(err.into()),
    };
    let ledger: InstalledTree =
        serde_json::from_str(&text).context("Baum-Ledger ist beschaedigt")?;
    if ledger.schema_version != TREE_SCHEMA_VERSION {
        bail!("Baum-Ledger hat eine nicht unterstuetzte Version");
    }
    dist::validate_sha256(&ledger.archive_sha256)?;
    Ok(Some(ledger))
}

/// Guenstige Statuspruefung: Ledger vorhanden, Executable ist regulaere Datei passender Groesse.
pub fn tree_present(root: &Path, ledger: &InstalledTree) -> bool {
    let Ok(executable) = ledger.executable_path(root) else {
        return false;
    };
    let expected = ledger
        .files
        .iter()
        .find(|file| file.path == ledger.executable)
        .map(|file| file.size_bytes);
    fs::symlink_metadata(executable)
        .is_ok_and(|meta| meta.file_type().is_file() && Some(meta.len()) == expected)
}

/// Strenge Pruefung vor Ausfuehrung: exakt dieselben Dateien mit identischem Hash, keine
/// zusaetzlichen (z. B. eingeschleuste Bibliotheken), keine Links. Liefert das Executable.
pub fn verify_tree(root: &Path, ledger: &InstalledTree) -> Result<PathBuf> {
    let meta = fs::symlink_metadata(root).context("Verifizierter Baum fehlt")?;
    if !meta.file_type().is_dir() {
        bail!("Verifizierter Baum ist kein reguläres Verzeichnis");
    }
    let actual = hash_tree(root)?;
    if actual != ledger.files {
        bail!(
            "{} {} wurde seit der Installation veraendert; bitte neu installieren",
            ledger.component,
            ledger.version
        );
    }
    ledger.executable_path(root)
}

/// Atomare Promotion eines verifiziert entpackten Baums. Das alte Ledger wird zuerst
/// entfernt, das neue erst nach erfolgreichem Rename geschrieben: ein Abbruch dazwischen
/// hinterlaesst einen unverifizierten (also nicht ausfuehrbaren) Zustand, nie einen falschen.
pub fn promote_tree(
    extracted: &Path,
    destination: &Path,
    ledger_path: &Path,
    ledger: &InstalledTree,
) -> Result<()> {
    match fs::remove_file(ledger_path) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(err.into()),
    }
    let parent = destination
        .parent()
        .ok_or_else(|| anyhow!("Zielverzeichnis ohne Elternpfad"))?;
    fs::create_dir_all(parent)?;
    let mut displaced = None;
    if fs::symlink_metadata(destination).is_ok() {
        let trash = parent.join(format!(".replaced-{}", uuid::Uuid::new_v4().simple()));
        fs::rename(destination, &trash)?;
        displaced = Some(trash);
    }
    if let Err(err) = fs::rename(extracted, destination) {
        if let Some(trash) = &displaced {
            fs::rename(trash, destination).ok();
        }
        return Err(err).context("Atomare Promotion fehlgeschlagen");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(destination, fs::Permissions::from_mode(0o755))?;
    }
    dist::write_atomic(ledger_path, &serde_json::to_vec_pretty(ledger)?)?;
    if let Some(trash) = displaced {
        fs::remove_dir_all(trash).ok();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model_distribution::test_fixtures::tempdir;
    use std::io::Write;

    fn limits() -> ExtractLimits {
        ExtractLimits {
            max_total_bytes: 64 * 1024,
            max_entries: 16,
            max_entry_bytes: 32 * 1024,
            max_depth: 4,
        }
    }

    enum Item<'a> {
        File(&'a str, &'a [u8], u32),
        Dir(&'a str),
        Symlink(&'a str, &'a str),
        Hardlink(&'a str, &'a str),
        Fifo(&'a str),
        /// Roh-Header ohne Pfadpruefung des Builders (fuer Traversal-Faelle).
        RawFile(&'a [u8], &'a [u8]),
    }

    fn tar_gz(items: &[Item<'_>]) -> Vec<u8> {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut builder = tar::Builder::new(encoder);
        for item in items {
            let mut header = tar::Header::new_gnu();
            match item {
                Item::File(path, data, mode) => {
                    header.set_entry_type(tar::EntryType::Regular);
                    header.set_size(data.len() as u64);
                    header.set_mode(*mode);
                    builder.append_data(&mut header, path, *data).unwrap();
                }
                Item::Dir(path) => {
                    header.set_entry_type(tar::EntryType::Directory);
                    header.set_size(0);
                    header.set_mode(0o755);
                    builder.append_data(&mut header, path, &[][..]).unwrap();
                }
                Item::Symlink(path, target) | Item::Hardlink(path, target) => {
                    header.set_entry_type(if matches!(item, Item::Symlink(..)) {
                        tar::EntryType::Symlink
                    } else {
                        tar::EntryType::Link
                    });
                    header.set_size(0);
                    header.set_mode(0o777);
                    builder.append_link(&mut header, path, target).unwrap();
                }
                Item::Fifo(path) => {
                    header.set_entry_type(tar::EntryType::Fifo);
                    header.set_size(0);
                    header.set_mode(0o644);
                    builder.append_data(&mut header, path, &[][..]).unwrap();
                }
                Item::RawFile(path, data) => {
                    header.set_entry_type(tar::EntryType::Regular);
                    header.set_size(data.len() as u64);
                    header.set_mode(0o644);
                    let name = &mut header.as_old_mut().name;
                    name.fill(0);
                    name[..path.len()].copy_from_slice(path);
                    header.set_cksum();
                    builder.append(&header, *data).unwrap();
                }
            }
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    fn extract_bytes(
        bytes: &[u8],
        format: ArchiveFormat,
        limits: ExtractLimits,
        links: LinkPolicy,
    ) -> (PathBuf, Result<ExtractSummary>) {
        let dir = tempdir("archive");
        let archive = dir.join("input");
        fs::write(&archive, bytes).unwrap();
        let out = dir.join("out");
        let result = extract_archive(&archive, format, &out, limits, links);
        (out, result)
    }

    fn extract_tar(items: &[Item<'_>], links: LinkPolicy) -> (PathBuf, Result<ExtractSummary>) {
        extract_bytes(&tar_gz(items), ArchiveFormat::TarGz, limits(), links)
    }

    #[test]
    fn regular_tree_extracts_privately_with_exec_bits() {
        let (out, result) = extract_tar(
            &[
                Item::Dir("rt/"),
                Item::File("rt/llama-server", b"#!bin", 0o755),
                Item::File("./rt/README", b"docs", 0o600),
            ],
            LinkPolicy::Reject,
        );
        let summary = result.unwrap();
        assert_eq!(summary.files, 2);
        assert_eq!(fs::read(out.join("rt/llama-server")).unwrap(), b"#!bin");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = |p: &str| fs::metadata(out.join(p)).unwrap().permissions().mode() & 0o7777;
            assert_eq!(mode("rt/llama-server"), 0o755);
            assert_eq!(mode("rt/README"), 0o644);
            assert_eq!(
                fs::metadata(&out).unwrap().permissions().mode() & 0o777,
                0o700
            );
        }
    }

    #[test]
    fn path_traversal_is_rejected_after_normalization() {
        for raw in [
            &b"../escape"[..],
            b"rt/../../escape",
            b"/etc/passwd",
            b"rt\\..\\escape",
            b"C:/windows/x",
            b"rt/\x01ctl",
            b"./",
            b"a/b/c/d/e/f",
        ] {
            assert!(normalize_entry_path(raw, 4).is_err(), "{raw:?}");
        }
        assert_eq!(
            normalize_entry_path(b"./rt//bin/./x", 4).unwrap(),
            PathBuf::from("rt/bin/x")
        );

        let parent = tempdir("traversal-parent");
        let (out, result) = extract_tar(
            &[
                Item::File("ok", b"1", 0o644),
                Item::RawFile(b"../escape", b"pwned"),
            ],
            LinkPolicy::Reject,
        );
        assert!(result.is_err());
        assert!(!out.exists(), "Staging wird bei Fehler entfernt");
        assert!(!out.parent().unwrap().join("escape").exists());
        assert!(!parent.join("escape").exists());
    }

    #[test]
    fn symlink_hardlink_and_special_entries_are_rejected() {
        let (out, result) = extract_tar(
            &[
                Item::File("lib.1.0.dylib", b"lib", 0o755),
                Item::Symlink("lib.1.dylib", "lib.1.0.dylib"),
            ],
            LinkPolicy::Reject,
        );
        assert!(result.is_err());
        assert!(!out.exists());

        for items in [
            vec![Item::File("a", b"a", 0o644), Item::Hardlink("b", "a")],
            vec![Item::Fifo("pipe")],
        ] {
            for links in [LinkPolicy::Reject, LinkPolicy::CopySiblingAliases] {
                let (out, result) = extract_tar(&items, links);
                assert!(result.is_err());
                assert!(!out.exists());
            }
        }
    }

    #[test]
    fn sibling_aliases_become_regular_copies_never_links() {
        let (out, result) = extract_tar(
            &[
                Item::Dir("rt/"),
                // Alias vor seinem Ziel und als Kette, wie in den llama.cpp-Archiven.
                Item::Symlink("rt/libllama.dylib", "libllama.0.dylib"),
                Item::Symlink("rt/libllama.0.dylib", "libllama.0.5.0.dylib"),
                Item::File("rt/libllama.0.5.0.dylib", b"LIB", 0o755),
            ],
            LinkPolicy::CopySiblingAliases,
        );
        let summary = result.unwrap();
        assert_eq!(summary.aliases, 2);
        for name in ["libllama.dylib", "libllama.0.dylib", "libllama.0.5.0.dylib"] {
            let path = out.join("rt").join(name);
            let meta = fs::symlink_metadata(&path).unwrap();
            assert!(meta.file_type().is_file(), "{name} ist regulaere Datei");
            assert_eq!(fs::read(&path).unwrap(), b"LIB");
        }

        for (alias, target) in [
            ("rt/x", "../outside"),
            ("rt/x", "/etc/passwd"),
            ("rt/x", "sub/file"),
            ("rt/x", "missing"),
            ("rt/x", ".."),
        ] {
            let (out, result) = extract_tar(
                &[
                    Item::File("rt/real", b"r", 0o644),
                    Item::Symlink(alias, target),
                ],
                LinkPolicy::CopySiblingAliases,
            );
            assert!(result.is_err(), "{target}");
            assert!(!out.exists());
        }
        // Zyklus a -> b -> a.
        let (_, result) = extract_tar(
            &[Item::Symlink("a", "b"), Item::Symlink("b", "a")],
            LinkPolicy::CopySiblingAliases,
        );
        assert!(result.is_err());
    }

    #[test]
    fn decompression_bomb_and_entry_limits_are_enforced() {
        // Einzeldatei ueber dem Einzellimit (hochkomprimierbar).
        let big = vec![0u8; 40 * 1024];
        let (out, result) = extract_tar(&[Item::File("big", &big, 0o644)], LinkPolicy::Reject);
        assert!(result.is_err());
        assert!(!out.exists());

        // Summe ueber dem Gesamtlimit.
        let chunk = vec![0u8; 30 * 1024];
        let (_, result) = extract_tar(
            &[
                Item::File("a", &chunk, 0o644),
                Item::File("b", &chunk, 0o644),
                Item::File("c", &chunk, 0o644),
            ],
            LinkPolicy::Reject,
        );
        assert!(result.unwrap_err().to_string().contains("Gesamtgroesse"));

        // Zu viele Eintraege.
        let names: Vec<String> = (0..20).map(|i| format!("f{i}")).collect();
        let items: Vec<Item<'_>> = names
            .iter()
            .map(|name| Item::File(name, b"x", 0o644))
            .collect();
        let (_, result) = extract_tar(&items, LinkPolicy::Reject);
        assert!(result.unwrap_err().to_string().contains("Eintraege"));

        // Aliase zaehlen gegen dieselben Limits.
        let lib = vec![0u8; 30 * 1024];
        let (_, result) = extract_tar(
            &[
                Item::File("lib.so.1.0", &lib, 0o644),
                Item::Symlink("lib.so.1", "lib.so.1.0"),
                Item::Symlink("lib.so", "lib.so.1"),
            ],
            LinkPolicy::CopySiblingAliases,
        );
        assert!(result.is_err());

        // Gzip-Strom, der weit ueber das Gesamtlimit dekomprimiert, wird am Strom gestoppt.
        let tight = ExtractLimits {
            max_total_bytes: 1024,
            max_entries: 16,
            max_entry_bytes: 1024,
            max_depth: 4,
        };
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
        let zeros = vec![0u8; 1024 * 1024];
        for _ in 0..80 {
            encoder.write_all(&zeros).unwrap();
        }
        let bomb = encoder.finish().unwrap();
        assert!(bomb.len() < 200 * 1024, "hochkomprimiert: {}", bomb.len());
        let (out, result) = extract_bytes(&bomb, ArchiveFormat::TarGz, tight, LinkPolicy::Reject);
        assert!(result.is_err());
        assert!(!out.exists());
    }

    fn zip_bytes(entries: &[(&str, &[u8], Option<u32>)], symlinks: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data, mode) in entries {
            let mut options = zip::write::SimpleFileOptions::default();
            if let Some(mode) = mode {
                options = options.unix_permissions(*mode);
            }
            writer.start_file(*name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        for (name, target) in symlinks {
            writer
                .add_symlink(*name, *target, zip::write::SimpleFileOptions::default())
                .unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn zip_entries_get_the_same_protection() {
        let ok = zip_bytes(&[("rt/llama-server.exe", b"MZ", None)], &[]);
        let (out, result) = extract_bytes(&ok, ArchiveFormat::Zip, limits(), LinkPolicy::Reject);
        result.unwrap();
        assert_eq!(fs::read(out.join("rt/llama-server.exe")).unwrap(), b"MZ");

        for bad in [
            zip_bytes(&[("../escape.dll", b"x", None)], &[]),
            zip_bytes(&[("C:/escape.dll", b"x", None)], &[]),
            zip_bytes(
                &[("a.dll", b"x", None)],
                &[("link.dll", "../../etc/passwd")],
            ),
            zip_bytes(&[("big.dll", &vec![0u8; 40 * 1024], None)], &[]),
        ] {
            let (out, result) = extract_bytes(
                &bad,
                ArchiveFormat::Zip,
                limits(),
                LinkPolicy::CopySiblingAliases,
            );
            assert!(result.is_err());
            assert!(!out.exists());
        }
        let linked = zip_bytes(&[("a.dll", b"x", None)], &[("b.dll", "a.dll")]);
        let (_, result) = extract_bytes(&linked, ArchiveFormat::Zip, limits(), LinkPolicy::Reject);
        assert!(result.is_err());
    }

    #[test]
    fn tree_ledger_detects_tamper_and_injected_files_before_execution() {
        let root = tempdir("tree");
        let staging = root.join("staging-x");
        fs::create_dir_all(&staging).unwrap();
        let archive = root.join("rt.tar.gz");
        fs::write(
            &archive,
            tar_gz(&[
                Item::File("rt/llama-server", b"server", 0o755),
                Item::File("rt/libggml.dylib", b"ggml", 0o644),
            ]),
        )
        .unwrap();
        let extracted = staging.join("extract");
        extract_archive(
            &archive,
            ArchiveFormat::TarGz,
            &extracted,
            limits(),
            LinkPolicy::Reject,
        )
        .unwrap();
        let ledger = InstalledTree::new(
            "llama-cpp",
            "b1",
            &"a".repeat(64),
            &extracted,
            &extracted.join("rt/llama-server"),
        )
        .unwrap();
        let destination = root.join("runtime/b1");
        let ledger_path = root.join("runtime/b1.tree.json");
        promote_tree(&extracted, &destination, &ledger_path, &ledger).unwrap();
        assert!(!extracted.exists());

        let loaded = load_tree_ledger(&ledger_path).unwrap().unwrap();
        assert!(tree_present(&destination, &loaded));
        assert_eq!(
            verify_tree(&destination, &loaded).unwrap(),
            destination.join("rt/llama-server")
        );

        // Eingeschleuste Bibliothek.
        fs::write(destination.join("rt/libevil.dylib"), b"evil").unwrap();
        assert!(verify_tree(&destination, &loaded).is_err());
        fs::remove_file(destination.join("rt/libevil.dylib")).unwrap();
        // Veraenderte Bibliothek gleicher Groesse.
        fs::write(destination.join("rt/libggml.dylib"), b"GGML").unwrap();
        assert!(verify_tree(&destination, &loaded).is_err());
        fs::write(destination.join("rt/libggml.dylib"), b"ggml").unwrap();
        verify_tree(&destination, &loaded).unwrap();
        // Link im Baum.
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/bin/sh", destination.join("rt/sh")).unwrap();
            assert!(verify_tree(&destination, &loaded).is_err());
            fs::remove_file(destination.join("rt/sh")).unwrap();
        }
        // Ledger fehlt → nicht verifiziert.
        fs::remove_file(&ledger_path).unwrap();
        assert!(load_tree_ledger(&ledger_path).unwrap().is_none());
    }

    /// Manuelle Gegenprobe gegen echte, lokal geladene llama.cpp-Release-Archive (nicht im
    /// Repo): `KATOSYNC_RUNTIME_ARCHIVES=/pfad/a.tar.gz,/pfad/b.zip cargo test --lib -- --ignored`.
    #[test]
    #[ignore]
    fn real_runtime_archives_extract_under_runtime_policy() {
        let Ok(list) = std::env::var("KATOSYNC_RUNTIME_ARCHIVES") else {
            return;
        };
        for path in list.split(',').filter(|p| !p.is_empty()) {
            let format = if path.ends_with(".zip") {
                ArchiveFormat::Zip
            } else {
                ArchiveFormat::TarGz
            };
            let out = tempdir("real").join("out");
            let summary = extract_archive(
                Path::new(path),
                format,
                &out,
                RUNTIME_ARCHIVE_LIMITS,
                LinkPolicy::CopySiblingAliases,
            )
            .unwrap();
            let tree = hash_tree(&out).unwrap();
            let server = tree
                .iter()
                .find(|f| f.path.ends_with("llama-server") || f.path.ends_with("llama-server.exe"))
                .expect("llama-server vorhanden");
            println!(
                "{}: files={} bytes={} aliases={} server={}",
                Path::new(path).file_name().unwrap().to_string_lossy(),
                summary.files,
                summary.bytes,
                summary.aliases,
                server.path
            );
            assert!(!out.join("..").join("escape").exists());
            fs::remove_dir_all(out.parent().unwrap()).ok();
        }
    }
}
