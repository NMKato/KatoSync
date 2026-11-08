# KatoSync Mesh Stage 3T – isolierter GoTrue-HTTP-Loopback und Cloud-Freigabeprüfung

**02.11.2026 · NMKato Solutions · nur QA, gestapelter Draft auf Stage 3S**

## Cloud-Bestandsaufnahme, 02.11.2026

Der verbundene Supabase-Account zeigt vier bestehende Projekte: `NMKato's Project`, `foodtracker-pignick`, `KatoOS (old Cirqa)` und `GenXLine`. **Keines** ist als eigenständiger KatoSync-Mesh-Preview-Mandant ausgewiesen. Die Cloud-Branch-Liste des gemeinsam produktiven KATOOS-Projekts enthält nur `main`, keine separate nutzbare Preview-Branch. Der ältere KatoSync-Issuer `wspcuiylctlrvvpnwufk` ist in dieser verbundenen Liste nicht verfügbar und daher **keine zulässige Ausweichlösung**.

**Entscheidung:** Kein automatisch neu erstelltes, potenziell kostenpflichtiges Supabase-Projekt, kein KATOOS-Branch, kein Deploy und keine Umwidmung anderer Projekte. Ein echter Cloud-Test bleibt blockiert, bis eine eigenständige QA-Umgebung explizit vorhanden ist.

## Verbesserte native Authentifizierung

Der Stage3S-GoTrue-Client ist jetzt **innerhalb des Preview-Namespace zusätzlich an den Projekt-Ref gebunden**: Dienst `com.nmkato.katosync.mesh.preview.auth.qa`, Keychain-Konto `isolated-preview-refresh-v1:<ref>`. Das gespeicherte Credential enthält `issuer_origin`, `owner_id` und den Refresh-Token. Eine nicht exakt passende Origin-Identität wird **vor** einer Netzwerkkommunikation als ungültige Session abgewiesen.

GoTrue-Token- und User-Antworten werden sowohl anhand von `Content-Length` als auch beim stückweisen HTTP-Lesen auf maximal 8192 Byte beschränkt. HTTP-Redirects sind weiterhin verboten. Mehrmandanten-Testfälle prüfen die unterschiedlichen Keychain-Kontennamen, ohne tatsächliche Credentials zu lesen oder zu schreiben.

## Native End-to-End-Prüfung ohne Cloud

Neu: `src-tauri/src/mesh_preview_auth_tests_3t.rs`, ein wegwerfbarer `127.0.0.1:0`-Server mit synthetischen Credentials. Er prüft mit dem **tatsächlichen Rust-reqwest-Client** Passwort-Grant `POST /auth/v1/token?grant_type=password`, Refresh-Grant, `GET /auth/v1/user`, unveränderte Eigentümer-ID, anonyme und ungültige Benutzer, ungültige/überlange Antwort sowie verweigerte HTTP-Weiterleitungen. Er verwendet niemals ein Produktivkonto, ein Keychain-Secret oder ein öffentliches Supabase-Ziel. Das ist ein HTTP-/GoTrue-Vertragsnachweis, **kein** realer Cloud-GoTrue-Integrationstest.

Stage3S-/Stage3R-Funktionen werden nicht umgehängt: Trotz möglicher GoTrue-Prüfung bleiben Paarung, Mesh-Transport, Jobs und Inbox-Schreibpfad gesperrt.

## Freigabekriterien für echten Cloud-QA-Schritt

1. Eigene, klar zugeordnete isolierte Supabase-QA-Projektkennung in EU-Region; Cloud-Kosten und Zugriffsrechte vorab prüfen und genehmigen.
2. Eigene Publishable-API-Key-Konfiguration sowie Preview-Deploy-ID; **keine** Service-Role-/Secret-Keys im Desktop-Bundle.
3. Synthetischer, ausdrücklich für QA angelegter Testbenutzer; Prüfung des GoTrue-Online-Login/Refresh und Ausschluss von KATOOS-Token.
4. Read-only Preview-Endpunkte Stage3M–3Q erst nach isolierten Migrationen, RLS-Review, Funktions-Deploy und bewusster Freigabe prüfen.
5. Danach Version-/Signaturprüfung eines **neuen separaten** QA-Builds auf M2 und M3; alte Stage2I-Apps nicht überschreiben.
6. Echte Einladung, Single-Use-Replay-Schutz, manuelle SAS-Verifikation und mTLS vor Kopplungsfreigabe.

**Keine automatischen Cloud-Aktionen oder Produktionsänderungen.**
