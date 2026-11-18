# Gate 11 — Unabhängiges Reviewer-Key-Onboarding: Offline-PoP-Vorprüfung (QA)

**9. November 2026 · ausschließlich vorbereitend / kein Enrollment / kein Release**

## Warum dieser Schritt nötig ist

Gate 9 besitzt bereits eine administrative Reviewer-Rolle, Schlüsselregister und
die signierte Reviewer-Entscheidung. Gate 10 kann mit einer separat in einem
freigegebenen nativen QA-Build **gepinnten** Reviewer-Identität eine Ed25519-
Unterschrift unabhängig prüfen. Im Live-Setup gibt es jedoch noch **keinen
nachgewiesenen zweiten registrierten menschlichen Reviewer**. Die native
`RELEASE_REVIEWED_PINS`-Liste ist daher absichtlich leer. Niemals automatisch
eine Reviewer-Rolle oder einen Pin aus einer Serverantwort erzeugen.

## Neue Offline-Werkzeuge (kein Supabase, kein JWT, keine Token-Speicherung)

- `scripts/qa-reviewer-enrollment-pop.mjs`: signierter Challenge-Vertrag,
  erzeugt 32 zufällige Bytes und bindet sie an Reviewer-/Owner-UID, Projekt,
  Ed25519-**Public**-Key, SHA-256-Key-ID und ein 120-s-Zeitfenster.
- `scripts/qa-reviewer-enrollment-pop-cli.mjs`: `prepare` zeigt nur
  öffentliches Material und die exakt zu signierenden Bytes an;
  `verify` nimmt eine vom Reviewer separat erzeugte Signatur über STDIN
  entgegen und prüft sie mit Node-Crypto gegen den eingebetteten Public Key.
- `tests/reviewerEnrollmentPoPGate11.test.ts`: rein synthetische
  Ed25519-Tests einschließlich fremder Signatur, Fälschung, Ablauf,
  Account-/Projektwechsel, malformed Base64url und keinem Grant.
- Der Private Key wird **weder generiert, exportiert, geöffnet, gespeichert
  noch übertragen**. Er muss bereits vom tatsächlichen Reviewer unter dessen
  alleiniger Kontrolle verwaltet werden.

## Geplante echte Zwei-Personen-Zeremonie

1. Ein autorisierter Administrator verifiziert über einen unabhängigen
   Kommunikationskanal die Identität der **zweiten realen Person** und die
   eigene KATOOS-Mitgliedschaft mit aktiver Berechtigung. Reviewer-UID und
   Owner-UID sind verschieden. Keinen bestehenden Owner als Reviewer
   derselben Entscheidung eintragen.
2. Reviewer liefert seinen **öffentlichen** Ed25519-Key an den Administrator.
   Der Fingerprint wird über einen zweiten unabhängigen Kanal abgeglichen.
   Nur der Reviewer verwahrt den Private Key; keine Passwort- oder
   Schlüsselweitergabe an ChatGPT, Git, die WebView oder Edge.
3. Administrator startet auf einem isolierten Gerät die Vorbereitung:
   ```sh
   node scripts/qa-reviewer-enrollment-pop-cli.mjs prepare \
     --owner-uid "$VERIFIED_OWNER_UID" \
     --reviewer-uid "$VERIFIED_REVIEWER_UID" \
     --project-id katosync \
     --reviewer-public-key "$REVIEWER_PUBLIC_KEY_BASE64URL"
   ```
   Das JSON enthält `challenge` und `signingMessageBase64url`. Die
   Reviewer-Person muss **exakt die dekodierten Bytes** der Nachricht mit
   ihrem privat verwahrten Ed25519-Schlüssel signieren. Signaturformat:
   kanonisches Base64url ohne Padding, 64 Signatur-Bytes. Es werden keine
   PINs, Passwörter oder privaten Schlüssel übertragen.
4. Der Administrator führt die rein lesende Prüfung mit einem lokal
   bereitgestellten JSON-Objekt `{"challenge":{...},"signature":"..."}` aus:
   ```sh
   node scripts/qa-reviewer-enrollment-pop-cli.mjs verify < reviewer-proof.json
   ```
   Das Tool meldet höchstens `public_key_possession_only_not_enrolled`,
   `grantsRights:false`, `reviewerAuthorized:false` und
   `reviewerKeyPinned:false`. Eine abgelaufene oder falsche Signatur
   wird abgewiesen.
5. Ein **tatsächlich berechtigter, unabhängiger Admin** entscheidet erst
   nach dem persönlichen Abgleich über Registrierung, Audit-Evidenz,
   Schlüsselrevision, späteren Widerruf und Freigabe. Dieser Schritt darf
   nicht durch das CLI vorgetäuscht werden. Das produktive administrative
   Enrollment, dessen Rechteprüfung und das Out-of-band-Protokoll sind noch
   separat umzusetzen/abzunehmen.
6. Nach echtem Enrollment und unabhängigem Source-Review muss der
   öffentliche Schlüssel explizit in die native Release-Pin-Liste
   aufgenommen, ein neues signiertes QA-Binary erstellt und im
   authentifizierten KATOOS→Owner-Challenge→Reviewer-Entscheidung→native
   Readback mit Widerruf und Kontowechsel real getestet werden.

## Klare Grenzen

- Offline-PoP ist **kein** aktueller KATOOS-Login, kein Nachweis einer
  realen Person, keine unabhängig administrative Entscheidung.
- Das 120-s-Offline-Challenge besitzt **keinen serverseitigen atomaren
  Einmalverbrauch**. Es ist nur ein kurzlebiger Schlüsselbesitzbeleg und
  darf **nie** für Rollen, Grants oder signierte Live-Owner-Freigaben
  verwendet werden. Die echte Owner-Challenge der Gates 7–10 bleibt separat.
- Challenge-Antworten dürfen nicht als vertraulicher automatischer
  Freigabebeleg in DB/Git eingefügt werden. Kein automatischer Pin,
  Reviewer-Enroll, Owner-Promotion, Mesh-Job, API-Tool-Aufruf oder Merge.
- Native Gate 10 bleibt `independentReviewerVerified:false` an der
  WebView-Grenze. `verifiedPercent=null` und Release-Hold bleiben bestehen.
- Das Skript kontaktiert keine Cloud-/lokalen Dienste, verwendet keine
  KATOOS-Session und schreibt kein öffentliches oder privates Key-Material
  auf Datenträger.

## Nachgewiesene lokale QA

- **6/6** neue Offline-PoP-Sicherheitsprüfungen mit synthetischen Ed25519-
  Schlüsseln grün; keine realen Reviewer-Schlüssel erzeugt.
- **754/754** Node-Regressionsprüfungen grün (`--test-concurrency=4`).
- **16/16** Remote-Usage-Prüfungen grün.
- TypeScript/Vite vollständig gebaut (bekannter Chunk-Size-Hinweis).
- Rust-Formatprüfung und Git-Diff-Prüfung bestanden; unveränderte native
  Rust-Funktionen sind mit dem vorherigen Gate10-Rust-Testnachweis abgedeckt.
- Kein produktiver Endpunkt, kein User-/Reviewer-/Admin-/Owner-Write und kein
  automatisches Provisionieren ausgeführt. Kein Live-E2E behauptet.

## Noch erforderlich vor einer echten Freigabe

Ein zweiter realer identitätsgeprüfter Reviewer, die zugehörige gültige
KATOOS-Mitgliedschaft, ein kontrolliertes administratives Enrollment mit
Audit-Nachweis, separater Native-Key-Pin-Review und ein durch Zeugen
bestätigter positiver/negativer Live-End-to-End-Test. Auch Stage4E
Free-0/Pro-10-Live-Quota/Expiry und vollständige M2/M3-Abnahme bleiben
separat gesperrt.
