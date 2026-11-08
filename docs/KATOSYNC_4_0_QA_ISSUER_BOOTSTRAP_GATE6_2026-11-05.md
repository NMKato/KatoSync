# KatoSync 4.0 – Trust Gate 6: QA-Issuer-Vertrauensanker und Schlüsselbesitzprüfung

**Stand: 05.11.2026.** QA-Umgebung, **kein Beta-Release und keine bestätigten Feature-Abnahmen**. Branch auf Draft PR #236 gestapelt. Produktive KatoSync-Installationen bleiben unverändert.

## Live durchgeführt (KATOOS-Supabase)

Der Supabase-Cluster `xbnnlyyxiilklsygxcof` besitzt nun eine **dedizierte QA-Ed25519-Issuer-Identität** für `feature-approver-grant-qa`. Der Schlüssel wurde mit dem System-Zufallsgenerator in einem einmaligen, ausdrücklich bestätigten CLI-Vorgang erzeugt.

- Das geheime PKCS8-Schlüsselmaterial wurde **nur als Supabase-Secret** `KATOSYNC_APPROVER_ISSUER_PKCS8_B64` übertragen.
- Der QA-Schalter `KATOSYNC_FEATURE_APPROVAL_STAGE=qa` wurde gesetzt. Die Funktion muss weiterhin bei jedem Aufruf **aktive** Konto-, Projekt- und Approver-Datensätze prüfen; ein Schlüssel/Stage-Schalter allein reicht nicht.
- Der CLI-Bootstrap verwendet eine temporäre Datei mit **0600-Rechten**, schickt den Secret-Wert niemals als Prozessargument und entfernt die temporäre Datei anschließend. Keine privaten Keys, JWTs oder Service-Role-Credentials im Repository oder im Terminal-Output. Eine Dateilöschung garantiert auf SSD kein kryptografisches Löschen; für hochsensible Produktionsschlüssel ist eine externe HSM-/KMS-Lösung erforderlich.
- Das Skript verweigert die erneute Ausführung, wenn Schlüssel oder Schalter bereits existieren; es ist **kein automatischer Schlüsselrotator**. Die Wiederherstellung aus dem Cloud-Secret ist über dieses Skript nicht vorgesehen. Bei Verlust/Komprimittierung muss der Issuer-Key durch einen geprüften Rotationsprozess ersetzt und ein neuer signierter nativer Pin ausgeliefert werden.

Das ausschließlich öffentliche, nicht geheime QA-Verifikationsmaterial befindet sich in `docs/katosync-qa-issuer-public-key-v1.json`:

- Algorithmus: **Ed25519**
- Public Key (Base64url): `0YMIKm_iKp1TxRFSpVJ5PG5o1ooFZcGosZyInUY_wy8`
- SHA-256-Public-Key-Fingerprint: `c87f5292dc37eddc0fc67f6d085b7b0c87ed31c44c54830f6cd4de66bf6f544b`
- Getrennter Projekt-/Issuer-Vertrauensanker: Nur die **kompilierte, geprüfte QA-Binärdatei** akzeptiert den Schlüssel.

Die native Rust-Prüfung zieht den Issuer-Key **nicht** aus einer Netzwerknachricht, einem User-Setting oder der WebView. Der Trust-Anchor wird gegen SHA-256 abgesichert. Der read-only Gate-5-Issuer-Bridge-Aufruf bezieht Grant-Daten frisch von der festen Supabase-HTTPS-URL und prüft alle Signaturen mit dem eingebauten QA-Key. Er holt **nach** dem GitHub-/Git-/CI-Lauf einen zweiten aktuellen Grant und verlangt weiterhin identische Projekt-, Rollen-, Schlüssel- und Revisionsbindung; zwischenzeitliche Sperrung oder Rotation muss fail-closed reagieren.

## Administrative Schlüsselbesitzprüfung

`src/lib/featureOwnerKeyProof40.ts` führt ein unabhängig prüfbares Ed25519-`owner-key-possession`-Protokoll ein. Ein Eigentümerkandidat muss eine von **einem separaten Admin** gelieferte, projekt- und kontogebundene, 32-Byte-Zufallschallenge signieren:

- Kanonische Bytes (versionsgetrennt): `KatoSync owner-key-possession v1\n` + JSON-Array mit Projekt, KATOOS-Konto, Public Key, Nonce und Signaturzeit.
- Der Prüfer akzeptiert ausschließlich einen **bekannten, unabhängigen Admin-Challenge-Datensatz** mit höchstens fünf Minuten Laufzeit sowie eine gültige Ed25519-Signatur. Falsches Projekt, falsches Konto, neue/alte Nonce, Signaturmanipulation und abgelaufene Challenge werden abgewiesen.
- Der Prüfer liefert **nur den kryptografischen Schlüssel-Fingerprint** zurück, **niemals Projekt- oder Release-Rechte**. Signierter Schlüsselbesitz ist eine notwendige, aber **nicht hinreichende** Voraussetzung.
- Die serverseitige Challenge-Ausgabe, einmalige atomare Nonce-Verbrauchung, Prüfung der tatsächlichen Eigentümerrolle und dokumentierte **administrative Freigabeentscheidung** müssen noch umgesetzt werden, bevor ein erstes `feature_approver_grants`-Record als `active` erstellt werden darf.

## Geprüfte Grenzen und QA

Das QA-Skript wurde ohne `--apply` als fail-closed getestet. Die Secret-Namen im Live-KATOOS-Projekt wurden nach Installation geprüft, **ohne deren Werte auszugeben**.

Die vorhandenen Datenbanktabellen `katosync.feature_approval_projects`, `feature_approver_grants`, `feature_approver_audit` bleiben mit **RLS**, ausschließlich administrativer Schreibberechtigung und ohne automatisch erstellte Owner-Grants. Live-Tabelleinträge: zuletzt überall **0**.

Die Tests prüfen den exakt kompilierten Public-Key-Pin und SHA-256-Fingerprint, gefälschte/rotierte Owner-Keys und Grant-Revisionswechsel, eine zweite serverseitige Prüfung nach GitHub sowie die lokale Schlüsselbesitz-Signatur. Dies ist **kein nachgewiesener authentifizierter Live-End-to-End-Lauf mit echtem Owner-Grant**, sondern die verifizierte QA-Vorbereitung dafür.

## Abgeschlossene QA (05.11.2026)

- **290 von 290 Rust-Library-Tests bestanden**, 8 planmäßig ignoriert; der kompilierten Public-Key-Pin und Revision-/Rollenwechsel sind mit Negativtests abgesichert.
- **710 von 710 Node-Tests bestanden** mit kontrollierter Parallelität, darunter kryptografische Key-Possession-/Replay-/Challenge-Tests und Schutz des CLI-Bootstraps vor versehentlicher Wiederholung.
- TypeScript- und Vite-Frontend-Build erfolgreich (1.909 Module; bestehender Chunk-Size-Hinweis, kein Build-Fehler).
- Live-Supabase-Metadaten bestätigen beide erforderlichen Secret-Namen; **Werte wurden nicht gelesen oder ausgegeben**. Live SQL zeigt **0 Projekte, 0 Approver-Grants, 0 Auditereignisse**. HTTPS-GET ohne Auth gegen den QA-Edge-Endpunkt antwortet weiterhin HTTP **401**.
- Not-Aus \`scripts/qa-disable-owner-issuer.sh\` wurde **ausschließlich im Ablehnungsmodus** (ohne Bestätigung / falsche Projekt-ID) geprüft. Er wurde **nicht aktiviert**. Der QA-Aussteller-Schalter bleibt bewusst auf QA; auch damit werden bei null Owner-Grants keine Berechtigungen vergeben.
- QA-Build und Tests sind **kein signiertes, notarisiertes und auf M2/M3/Windows installiertes Beta-Paket**.

## Beta-Release-Abhängigkeiten (P0)

1. Admin-genehmigte Registrierung des tatsächlichen KATOOS-Projekts/Owners; sichere Owner-Key-Verwahrung, serverseitig einmalige Challenges und sofort wirksame Sperr-/Rotationswege.
2. Live-End-to-End: registriertes Projekt, echte geprüfte Login-/Approver-Identität, serverseitig signierter Grant, Besitzer-Signatur, GitHub-CI-Run/Jobs, exakter Git-HEAD, keine CI-Behauptung ohne Belege.
3. Separates append-only **Accepted-Ledger** und read-only Feature-Abnahmeprojektion; erst danach darf `verifiedPercent` von `null` abweichen und eine ETA angezeigt werden.
4. Signierte Beta-Pakete auf autorisierten M2/M3/Windows-Geräten und vollständige Mesh-QA; aktuell kein Nachweis eines produktiven Pairs. M2-Speicherziel mindestens 80 GiB frei vor großem Release-Build.
5. Ein definierter Release-Checkpoint mit Rollback, Feature-Flags und QA-Freigabe. Derzeit **keine automatische Beta-Freigabe**.

**Sicherheitsbewertung:** QA-Issuer-Konfiguration ist bereitgestellt; Owner-Rechte und echte Feature-Abnahmen sind weiterhin **nicht** erteilt.
