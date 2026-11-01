# KatoSync Mesh Stage 3S – getrennte Supabase-Preview-Anmeldung

**01.11.2026 · NMKato Solutions · gestapelter QA-Draft auf Stage 3R**

## Tatsächliche Umsetzung

Neues Rust-Modul `src-tauri/src/mesh_preview_auth.rs`, im Tauri-IPC registriert:

- `mesh_preview_auth_status`: ausschließlich lokale Konfigurationsdiagnose; selbst wenn ein alter Schlüsselbund-Eintrag existiert, behauptet diese **niemals** eine online geprüfte Anmeldung.
- `mesh_preview_auth_login`: ausdrücklich angeforderter GoTrue-Passwort-Login `POST /auth/v1/token?grant_type=password`, unmittelbar gefolgt von `GET /auth/v1/user` **auf demselben, exakt geprüften Preview-Issuer**. Nur danach wird der Refresh-Token gespeichert. Geprüfte UUID, nicht-anonymes Konto und identische E-Mail-Adresse sind erforderlich.
- `mesh_preview_auth_verify_session`: separat ausgelöster GoTrue-Refresh; die Session wird unter einem Tokio-Mutex serialisiert. Nach erneuter Online-Prüfung muss die UUID unverändert sein, bevor der rotierte Token im getrennten Schlüsselbund gespeichert wird.
- `mesh_preview_auth_logout`: entfernt nur die Preview-Credential, kein produktives oder bisheriges KatoSync-Konto.

**Credential-Isolation:** Ausschließlich Keychain-Dienst `com.nmkato.katosync.mesh.preview.auth.qa` und Konto `isolated-preview-refresh-v1`; die Eigentümer-UUID und der Refresh-Token werden als *ein* Credential gespeichert. Kein Import, Lesen, Refresh oder Migration der vorhandenen KATOOS-/Legacy-Token. Tokens, Passwörter und Serverfehlerkörper dürfen nicht in Logs, UI oder IPC-Antworten erscheinen. Eingebaute Key-/Grant-Limits, 12-Sekunden-Netzwerk-Timeout, Redirect-Verbot und begrenzte GoTrue-Antworten.

Das unabhängige Feature `mesh-preview-auth-qa` ist **nicht Bestandteil des Standard-Builds**. Alle folgenden Werte sind zwingende **öffentliche** Build-Konfigurationswerte, keine Service-Role-Keys: `KATOSYNC_MESH_PREVIEW_SUPABASE_URL`, `KATOSYNC_MESH_PREVIEW_PROJECT_REF`, `KATOSYNC_MESH_PREVIEW_DEPLOYMENT_ID`, `KATOSYNC_MESH_PREVIEW_PUBLISHABLE_KEY`. Die Adresse muss exakt `https://<20-character-project-ref>.supabase.co` sein; Ref und Edge-Deployment müssen zusammenpassen; bekannte produktive und bisherige Projekt-Refs werden abgelehnt. Ein fehlender oder unzulässiger Wert lässt den Login geschlossen.

Die bestehende `katoos-auth-qa`-App und die beiden installierten Stage2I-Bundles bleiben unverändert. Wenn eine bewusst isolierte QA-Anwendung später gebaut wird, kann sie mit der zusätzlichen Funktion kompiliert werden. Es wird ausdrücklich **kein** vorhandener Login automatisch auf den Preview-Mandanten übertragen.

## Benutzeroberfläche

Innerhalb der technischen Mesh-Details gibt es eine separate, mehrsprachige Preview-Anmeldung mit eigenem Formular sowie Schaltflächen für Online-Prüfung und Preview-Abmeldung. Sie erscheint nur, wenn der native Befehl einen gültig konfigurierten Preview-Issuer bestätigt; andernfalls zeigt die App „nicht konfiguriert“ oder „alter Build“. Ein erfolgreicher Preview-Login bedeutet lediglich **GoTrue-Identität online geprüft**. Der Status enthält weiterhin `paired=false`, `transportReady=false`, `remoteJobsEnabled=false`. Eine Aktualisierung der technischen Details löscht den nur temporär angezeigten Verifiziert-Status bis zur erneuten Online-Prüfung.

## Abnahmegrenzen

Lokale native Rust-Tests überprüfen das gesonderte Credential-Namespace, zeitlich beschränkte GoTrue-Tokenstruktur und das Fehlen von Mesh-Freigaben. Die Node-/React-Tests prüfen IPC-Registrierung, expliziten Build-Gate, Quellenisolierung und vier Sprachen. **Nicht durchgeführt:** tatsächlicher GoTrue-Login gegen einen separaten Cloud-Projektzweig, echte Passwort-/Refresh-Transaktionen, installierter M2/M3-Neubau, Inbox-Schreib-/Replay-Abwehr und SAS/mTLS-Pairing. Die neue Auth-Funktion ist Code-Reife, nicht bereits angemeldet oder vollständig Cloud-E2E-geprüft.

**Draft only.** Keine produktiven Migrationen, Cloud-Kosten, Deployments, App-Überschreibungen oder automatische Gerätekopplung.
