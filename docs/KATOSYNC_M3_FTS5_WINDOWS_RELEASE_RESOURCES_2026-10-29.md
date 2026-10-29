# KatoSync 2.0 – M3 FTS5-Live-QA und Windows Release-Ressourcengate

Stand: 29.10.2026. Separater Stacked-Draft-PR auf #175.

## M3: gleiche Frage, verbesserte lokale Antwort – tatsächlich bestanden

- QA-Quellbasis: `fix/p0-readonly-chat-diag-20261029`,
  Commit `d76c939` (FTS5-Quellretrieval).
- Auf M2 ein neues signiertes Mesh-QA-Bundle mit genau diesem
  Rust-/Frontendstand erstellt. Tauri-Feature `katoos-auth-qa`,
  App-ID `com.nmkato.katosync.meshqa`; gültige bestehende
  Developer-ID-Signatur.
- Ausschließlich das signierte App-Bundle **unverschlüsselt, aber
  SHA-256-integritätsgeprüft** über einen kurzzeitig geöffneten,
  auf den M2 begrenzten LAN-Transfer auf den M3 gebracht;
  keine Geheimnisse/Keychains/Benutzerdaten übertragen.
  Backup des vorigen QA-Bundles verbleibt separat in `/tmp`.
  SHA-256 der installierten neuen ausführbaren Datei:
  `39ac12719107e0cf012ca9f6442a49ce8660e0862f2e403a0fe311bc01f2b521`.
- Gemma 4 E4B Q4_0 (mit lokalem MMProj) über den **Starten**-
  Button der App von externer DevSSD gestartet. Auf Loopback begrenzter
  lokaler Endpoint `127.0.0.1:17842/v1/models` meldete
  `kato-local-brain`. Keine Cloud-Anfrage als Ersatz.
- Master-Chat in der signierten **M3-App**: registriertes
  `KatoSync`-Projekt ausgewählt; die exakt gleiche Frage wie im
  vorherigen Fehltest erneut gestellt:
  „Welche lokalen Code-Runner sind laut KatoSync-Projektquellen
  dokumentiert? Bitte kurz mit Quellen.“
- Vorheriger Turn #1 aus der alten Version:
  behauptete, keine spezifisch benannten Runner belegen zu
  können; in der Antwort weder `Codex` noch `Claude`.
- Turn #2 aus der **neuen** Version: **beide** Namen `Codex`
  und `Claude` ausdrücklich enthalten, mit **sechs**
  verifizierten Projektquellen. Die weitere Erwähnung von
  „Kato AI (lokaler Runtime)“ ist eine sprachliche
  Vermischung von Agent-Runnern und lokalem Modell:
  **inhaltliche Präzisionsverbesserung bleibt eine Nacharbeit**,
  nicht Teil dieser FTS5-Recall-Abnahme.
- Über UI zwischen Verbindungen und Master-Chat gewechselt:
  die neue Antwort nach erneutem Auswählen des Projekts
  **wieder sichtbar**. SQLite (schema 4) zeigt zwei Turns,
  `PRAGMA quick_check=ok`, beide Vorher/Nachherfragen samt
  Antworten erhalten.
- Danach lokalen Server **über den App-Stoppen-Button**
  beendet, um 16-GB-M3 nicht dauerhaft mit Modell + Swap
  zu belasten. Modellgewichte (~4,8 GB) bleiben auf DevSSD.
- Weder Projekte/History noch lokale Identitäten wurden
  auf den anderen Mac kopiert. Keine Git-Änderung am
  M3-Checkout. Keine SAS-/Mesh-Kopplung freigegeben.

## Windows: reale Packaging-Lücke isoliert korrigiert

Die Windows-Debug-App startete bereits; `poppler` und
`typst` waren jedoch nur leere QA-Sentinel-Verzeichnisse.
Der vorhandene `pdftotext_bin()`/`typst_bin()`-Pfad suchte
ausschließlich nach Unix-Dateinamen unter macOS
`Contents/Resources`.

`src-tauri/src/lib.rs` sucht nun **nur auf Windows** auch
die tatsächlich gebündelten `pdftotext.exe` und
`typst.exe` neben der Tauri-App (mit den üblichen
`resources`-Mappings). macOS-Suche und Homebrew-Fallback
bleiben unverändert.

## Fail-closed Release-Ressourcenprüfung

`npm run release:check` blockiert das Packen ohne
getrennt erstellte `src-tauri/release-resources.lock.json`
mit Zielplattform und SHA-256 der tatsächlich gebündelten
Binaries. Zusätzlich werden abgelehnt:
- alle `.test-only`-Marker in `poppler`, `typst`, `stt`;
- fehlende Binärdateien, abweichende SHA-256, falsches Ziel,
  Symlinks und bloße Textdateien statt PE-/Mach-O-Signaturen;
- Windows-Release, das den dort noch nicht implementierten
  Offline-STT-Dienst nicht ausdrücklich deaktiviert.

Lock-Beispiel (Platzhalterwerte sind **nicht**
veröffentlichungsfähig):

```json
{
  "schemaVersion": 1,
  "target": "win32-x64",
  "features": {"offlineDictation": false},
  "files": {
    "poppler/pdftotext.exe": "<SHA256 der echten .exe>",
    "typst/typst.exe": "<SHA256 der echten .exe>"
  }
}
```

Eine synthetische Fixture bestätigt die Prüflogik;
**der reale Build wird absichtlich mit RELEASE_LOCK_MISSING
blockiert**, da wir noch keine abgenommenen Drittanbieter-
Binaries besitzen. Der Debug-Build darf nur als Debug-Build
verwendet werden. Dieser Check ist aktuell ein manuell
aufrufbares Release-Gate; er ist **noch nicht vollständig**
in sämtliche möglichen Tauri-/CI-Releasepfade integriert.

### Weitere Release-Gates

- Echte geprüfte Poppler-/Typst-Resourcen samt
  Lizenznachweisen, Dependency- und Sicherheitsprüfung.
- macOS: tatsächlichen STT-Helper mit Developer ID signieren,
  notarisieren und aus dem aktuellen ad-hoc-QA-Pfad entfernen.
- Windows: gebündelte Binärpfade sowie ihre
  Funktionsfähigkeit unter dem installierten Tauri-Installer
  real testen; dort bleibt natives Offline-Diktat bislang
  ausdrücklich nicht unterstützt.
- Installer-Signatur/Update-Pfade/Quarantäne prüfen,
  dann kontrollierter Merge der gestapelten Draft-PRs.

Keinerlei Veränderungen an produktiven KATOOS-Tabellen,
M2/M3-Kontositzungen oder KAI-/THEORG-Anwendungen.
