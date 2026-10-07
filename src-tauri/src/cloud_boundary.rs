//! Grenze zwischen lokal-only Operationen und Aufrufen, die Inhalte in eine Cloud hochladen.
//!
//! Lokal-only (verlassen nie diesen Rechner): Scan/Vorschau (`scan_project`), Dry-Run-Sync,
//! CURRENT-/Snapshot-Dateien, Context Pack, Local Brain (Loopback), Provider-Erkennung
//! (`discover_local`, Key-Praefix-Erkennung) und Provider-Statuspruefungen ohne Inhalte.
//!
//! Inhalts-Uploads (verlassen den Rechner):
//! - Mistral-Library-Sync (`sync_once` ohne Dry-Run) -> nur ueber [`check_upload`].
//! - API-Lane-Worker (`run_api_worker`): secret-gepruefter Text an den gewaehlten Provider.
//! - KatoSync-Web (`/api/...`): Einstellungen, Briefings, Ausfuehrungsergebnisse.
//!
//! Regeln fuer Datei-Uploads (fail-closed, keine Cloud-DLP):
//! - Nur Endungen aus einer festen Allowlist; alles andere wird nie hochgeladen.
//! - Text wird vollstaendig lokal auf Secret-Muster geprueft (siehe `secret_regex` in `lib.rs`).
//! - PDF/Bilder sind lokal NICHT auf Secrets pruefbar. Sie gehen nur nach ausdruecklicher
//!   Freigabe (`safety.allowUnscannedBinaryUploads`) raus, und nur wenn die Magic-Bytes zur
//!   Endung passen (keine umbenannten Textdateien am Secret-Scan vorbei).
//! - Harte Groessenobergrenze unabhaengig von der Nutzereinstellung.
//!
//! (Created by NMKato Solutions)

use std::{fs::File, io::Read, path::Path};

/// Harte Obergrenze pro Upload-Datei (entspricht dem Maximum des Einstellungsreglers).
pub const MAX_CLOUD_UPLOAD_BYTES: u64 = 50 * 1024 * 1024;

const TEXT_TYPES: [(&str, &str); 5] = [
    ("md", "text/markdown"),
    ("markdown", "text/markdown"),
    ("txt", "text/plain"),
    ("json", "application/json"),
    ("csv", "text/csv"),
];

const BINARY_TYPES: [(&str, &str); 4] = [
    ("pdf", "application/pdf"),
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
];

/// Wie der Inhalt einer Upload-Datei lokal geprueft werden kann.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentCheck {
    /// Text: wird vor dem Upload vollstaendig auf Secret-Muster geprueft.
    SecretScanned,
    /// Binaer (PDF/Bild): kein Secret-Scan moeglich, nur mit ausdruecklicher Freigabe.
    Unscannable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadType {
    pub mime: &'static str,
    pub check: ContentCheck,
}

/// Grund, warum eine Datei nicht hochgeladen wird. Die Texte enthalten nie Dateiinhalte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UploadBlock {
    UnsupportedType,
    TooLarge,
    /// Binaerdatei ohne ausdrueckliche Freigabe fuer ungepruefte Uploads.
    ConsentRequired,
    /// Magic-Bytes passen nicht zur Endung (z. B. umbenannte Textdatei).
    SignatureMismatch,
}

impl UploadBlock {
    pub fn message(self) -> &'static str {
        match self {
            UploadBlock::UnsupportedType => {
                "Dateityp ist nicht fuer Cloud-Uploads freigegeben (Allowlist: md, txt, json, csv, pdf, png, jpg)."
            }
            UploadBlock::TooLarge => "Datei ueberschreitet die maximale Upload-Groesse.",
            UploadBlock::ConsentRequired => {
                "PDF/Bild kann lokal nicht auf Secrets geprueft werden - Upload nur mit ausdruecklicher Freigabe (Einstellungen > Regeln)."
            }
            UploadBlock::SignatureMismatch => {
                "Dateiinhalt passt nicht zur Endung - Upload aus Sicherheitsgruenden blockiert."
            }
        }
    }
}

fn extension(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// Ordnet eine Datei rein ueber die Endung der Allowlist zu.
pub fn upload_type(path: &Path) -> Option<UploadType> {
    let ext = extension(path);
    if let Some((_, mime)) = TEXT_TYPES.iter().find(|(known, _)| *known == ext) {
        return Some(UploadType {
            mime,
            check: ContentCheck::SecretScanned,
        });
    }
    BINARY_TYPES
        .iter()
        .find(|(known, _)| *known == ext)
        .map(|(_, mime)| UploadType {
            mime,
            check: ContentCheck::Unscannable,
        })
}

pub fn is_unscannable_binary(path: &Path) -> bool {
    upload_type(path).is_some_and(|kind| kind.check == ContentCheck::Unscannable)
}

/// Prueft die Magic-Bytes einer Binaerdatei gegen ihre Endung.
pub fn signature_matches(mime: &str, head: &[u8]) -> bool {
    match mime {
        "application/pdf" => head.starts_with(b"%PDF-"),
        "image/png" => head.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => head.starts_with(&[0xff, 0xd8, 0xff]),
        _ => false,
    }
}

fn read_head(path: &Path) -> Option<Vec<u8>> {
    let mut head = Vec::with_capacity(8);
    File::open(path).ok()?.take(8).read_to_end(&mut head).ok()?;
    Some(head)
}

/// Vorab-Gate fuer einen Datei-Upload, bevor Inhalte gelesen oder gesendet werden.
/// `allow_unscanned_binary` ist die ausdrueckliche Nutzerfreigabe fuer PDF/Bilder.
pub fn check_upload(
    path: &Path,
    size_bytes: u64,
    allow_unscanned_binary: bool,
) -> Result<UploadType, UploadBlock> {
    let kind = upload_type(path).ok_or(UploadBlock::UnsupportedType)?;
    if size_bytes > MAX_CLOUD_UPLOAD_BYTES {
        return Err(UploadBlock::TooLarge);
    }
    if kind.check == ContentCheck::Unscannable {
        if !allow_unscanned_binary {
            return Err(UploadBlock::ConsentRequired);
        }
        let head = read_head(path).unwrap_or_default();
        if !signature_matches(kind.mime, &head) {
            return Err(UploadBlock::SignatureMismatch);
        }
    }
    Ok(kind)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("katosync-boundary-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn only_allowlisted_types_are_uploadable() {
        for name in ["a.md", "b.TXT", "c.json", "d.csv", "e.markdown"] {
            assert_eq!(
                upload_type(Path::new(name)).map(|kind| kind.check),
                Some(ContentCheck::SecretScanned),
                "{name}"
            );
        }
        for name in ["a.pdf", "b.PNG", "c.jpg", "d.jpeg"] {
            assert_eq!(
                upload_type(Path::new(name)).map(|kind| kind.check),
                Some(ContentCheck::Unscannable),
                "{name}"
            );
        }
        for name in [
            "a.docx", "b.zip", "c.sqlite", "d.env", "e", "f.pem", "g.heic", "h.svg", "i.html",
        ] {
            assert_eq!(
                check_upload(Path::new(name), 10, true),
                Err(UploadBlock::UnsupportedType),
                "{name}"
            );
        }
    }

    #[test]
    fn unscannable_binary_upload_is_explicitly_gated() {
        let pdf = temp_file("offer.pdf", b"%PDF-1.7\n...");
        assert_eq!(
            check_upload(&pdf, 12, false),
            Err(UploadBlock::ConsentRequired)
        );
        assert_eq!(
            check_upload(&pdf, 12, true).map(|kind| kind.mime),
            Ok("application/pdf")
        );
        // Umbenannte Textdatei mit Secrets darf nicht als "Binaer" am Secret-Scan vorbei.
        let disguised = temp_file("notes.pdf", b"OPENAI_API_KEY=sk-should-never-leave");
        assert_eq!(
            check_upload(&disguised, 36, true),
            Err(UploadBlock::SignatureMismatch)
        );
        let png = temp_file(
            "shot.png",
            &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0],
        );
        assert!(check_upload(&png, 9, true).is_ok());
        let fake_jpg = temp_file("shot.jpg", b"GIF89a");
        assert_eq!(
            check_upload(&fake_jpg, 6, true),
            Err(UploadBlock::SignatureMismatch)
        );
    }

    #[test]
    fn hard_size_ceiling_applies_to_every_type() {
        let text = Path::new("CURRENT_MANIFEST.md");
        assert!(check_upload(text, MAX_CLOUD_UPLOAD_BYTES, false).is_ok());
        assert_eq!(
            check_upload(text, MAX_CLOUD_UPLOAD_BYTES + 1, false),
            Err(UploadBlock::TooLarge)
        );
        assert_eq!(
            check_upload(Path::new("big.pdf"), MAX_CLOUD_UPLOAD_BYTES + 1, true),
            Err(UploadBlock::TooLarge)
        );
    }

    #[test]
    fn block_messages_never_contain_content() {
        for block in [
            UploadBlock::UnsupportedType,
            UploadBlock::TooLarge,
            UploadBlock::ConsentRequired,
            UploadBlock::SignatureMismatch,
        ] {
            assert!(!block.message().contains("sk-"));
        }
    }
}
