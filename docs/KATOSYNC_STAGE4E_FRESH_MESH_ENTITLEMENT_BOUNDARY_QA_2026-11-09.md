# KatoSync 4.0 – Stage4E frische Entitlement-Schranke für Mesh (QA)

**09.11.2026 | KEIN PRODUKTIVDEPLOY | unabhängige Freigabe ausstehend**

## Sicherheitsbefund

Die bereits existierenden Ed25519-Handler für signierten Inbox-Versand,
Inbox-Empfang und das Stage3-Pairing-Relay überprüften KATOOS-Login,
aktive Mitgliedschaft, Geräteidentitäten, Signaturen und Replay-Schutz,
nicht aber die Pro-/Trial-Policy **nach** der Registrierung. Das heißt
nicht, dass sie bereits Remote-Jobs oder Peer-Trust erlauben:
Ihre Antworten bleiben `paired:false`, `transportReady:false`
und `remoteJobsEnabled:false`. Alte Inbox-Quellen sind aus Sicherheits-
und Provenienzgründen exakt SHA-256-gepinnt und bleiben BYTE-GLEICH.

Die vorhandenen Enrollment-/Heartbeat-Handler prüften eine serverseitige
Entitlement-Policy bereits. Die neue Schranke ergänzt auch dort eine
Prüfung direkt am HTTP-Einstieg und unmittelbar vor sensitiven DB-Zugriffen.

## QA-Implementierung

`supabase/functions/mesh-entitlement-boundary-qa/guard.ts` wird an
fünf **NEUEN ALTERNATIVEN QA-Einstiegspunkten** verwendet, ausdrücklich
nicht als stiller Austausch der historischen und SHA-gepinnten Quellen:

- `mesh-device-enrollment-entitled-qa/index.ts` (Challenge/Completion);
- `mesh-device-presence-qa-entitled-qa/index.ts` (Heartbeat);
- `mesh-inbox-send-entitled-qa/index.ts` (signierter Versand);
- `mesh-inbox-receive-entitled-qa/index.ts` (List/Accept/Reject);
- `mesh-pairing-relay-entitled-qa/index.ts` (signierte Relay-Nachrichten).

**Die bisherigen fünf originalen `index.ts`-Einstiegspunkte sind
unverändert**; insbesondere die zwei historisch SHA-gepinnten
Inbox-Indexdateien und ihre Ed25519-Handler wurden bytegenau
wiederhergestellt. Dieser eigene QA-Build ist noch kein produktives
Routing und wird nicht automatisch bei vorhandenen Edge-Funktionen
aktiv.

Ein weiterer expliziter Deploy-/Runtime-Schalter muss exakt
`KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE=qa-entitlement-boundary` sein.
Ohne ihn gilt bei **den neuen Alternativ-Endpunkten** `MESH_BOUNDARY_DISABLED`;
keiner ihrer alten internen Handler wird aufgerufen. Die bisherigen
Edge-Endpunkte werden **nicht** durch dieses neue Flag abgeschaltet;
ihre ursprünglichen endpoint-spezifischen QA-Schalter gelten weiterhin.
**Keiner der fünf neuen Alternativ-Endpunkte wurde deployt oder aktiviert.**

Der Wrapper authentifiziert den Bearer erneut über
`/auth/v1/user` am exakt erwarteten Supabase-Projekt, verifiziert
die aktive KatoSync-Mitgliedschaft und liest die *aktuelle*
`mesh_owner_policy` genau für die verifizierte Owner-UID.
Die Policy-Auswertung nutzt den vorhandenen strikten Serverparser:
fehlender Datensatz oder abgelaufene Policy = Free 0;
unbekannte/eindeutige ungültige Antwort und Netzwerkfehler = sperren;
nur explizit gesetzte 1–10 Geräte mit gültigem Friststatus sind
für diese QA-Mesh-Zulassung geeignet.

**Drei Kontrollpunkte:** am Eingang, vor jedem
Mesh-PostgREST-Zugriff (inkl. READ/INSERT/PATCH) sowie direkt vor
einer erfolgreichen HTTP-Antwort. Jeder Zwischenstatus wird neu
überprüft; ein zuvor erlaubter Request darf eine abgelaufene oder
widerrufene Berechtigung nicht für eine spätere Operation wiederverwenden.
Die aktuellen Owner-/Projekt-URLs werden isoliert: eine QA-Umgebung
darf nicht unbemerkt die produktive KATOOS-Policy abfragen.
Alle weitergereichten Fetch-Aufrufe verweigern HTTP-Redirects
(`redirect:"error"`) und unterbinden Cache-Wiederverwendung, damit
keine privilegierten Service-Role-Tokens über Redirects abfließen.
Es werden keine Kundensecrets an die WebView weitergereicht.

### Erfüllte QA-Negativbedingungen

- Free, Trial abgelaufen, kaputte Policy, Policy-API offline;
- KATOOS-Login fehlt/anonym/falsches Konto, Mitgliedschaft widerrufen;
- Entitlement läuft NACH Authentifizierung und VOR DB-Write ab;
- Entitlement verschwindet NACH erstem Lesen und VOR finaler Antwort;
- Beleg aus anderem Supabase-Projekt oder falsche Origin;
- fehlender QA-Runtime-Schalter; SHA-gepinnte Ed25519-Originalhandler
  dürfen nicht still umgeschrieben werden;
- Response bleibt `remoteJobsEnabled:false` in den bestehenden
  Messaging-Handlern; kein Auto-Pairing oder Grant.

## Read-only LIVE-Edge-Inventur, 09.11.2026

Im produktiven Supabase-Projekt wurden die folgenden bisherigen
Functions als `status=ACTIVE`, `verify_jwt=true` gelistet:
`mesh-device-enrollment` v6, `mesh-device-presence-qa` v3,
`mesh-inbox-send-qa` v3, `mesh-inbox-receive-qa` v3 und
`mesh-pairing-relay-qa` v3. Dies beweist **weder**, dass die
zusätzlichen inneren QA-Schalter tatsächlich gesetzt sind, **noch**
dass die neuen Entitlement-Prüfungen dort installiert wären.
Diese bestehenden Online-Deployments blieben unangetastet.

Die neuen Dateien wurden ausschließlich unter *anderen*
`-entitled-qa`-Funktionsnamen vorbereitet. Der zusätzliche Quellschutz
hat sich bewährt: Der erste Gesamtregressionslauf mit Änderungen an
gepinnten Original-`index.ts`-Dateien schlug absichtlich fehl;
die Dateien wurden wieder bytegenau wiederhergestellt, bevor der
separate QA-Kandidat fertiggestellt wurde. Es wurden **keine**
SHA-256-Freigaben nachträglich umgeschrieben.

## Wichtig: Was diese Schranke ausdrücklich NICHT nachweist

1. **KEINE atomare Autorisierung:** Wenn Entitlement und DB-INSERT
   zeitlich kollidieren, ist ein Read-then-Write-Guard nicht
   gleichwertig zu einer im selben PostgreSQL-Commit geprüften
   Entitlement-/Revocation-Bedingung. Eine späte Antwortsperre kann
   eine bereits ausgeführte Mutation nicht zurücknehmen.
2. **Keine echten Stripe-Entitlements:** Die serververwaltete
   `mesh_owner_policy` ist noch kein vollständig mit Stripe,
   Kündigung, Trial-Ende und Zahlungsstatus synchronisierter
   Produktkatalog. Stage4F-Billing ist noch nicht produktiv.
3. **Kein Remote-Job-Executor:** Das bestehende Repository besitzt
   hier noch keinen freigegebenen produktiven Remote-Job-Start/
   Run-/Resume-Pfad. Bis dessen Annahme- und Ausführungsgates
   unabhängig belegt sind, bleiben Remote-Jobs gesperrt.
4. **Weitere Preview-Gates:** Isolierte V2 Preview-Endpunkte,
   direkte native Verbindungen sowie alle künftigen Relay-/Inbox-
   Router müssen vor Release gesondert nach gleicher Policy
   auditiert werden. Diese Änderung umfasst die fünf genannten
   Index-Einstiegspunkte, nicht eine pauschale globale Sperre.
5. **Live-Status unverändert:** Produktiver DB-Quota-Trigger
   fällt noch auf `coalesce(allowed,2)` zurück; vorbereiteter
   Stage4E-Migrationskandidat liegt im QA-Release-Hold,
   nicht im regulären Migrationsverzeichnis.

## Nachgewiesene QA-Regression (physischer M2, 09.11.2026)

- **10/10** gezielte Sicherheits- und Vertragsprüfungen bestehen:
  Free 0, abgelaufene Policy, mid-request-Expiry, Revoke,
  Membership-Entzug, malformed/503, QA-Tenant-Isolation, Default-off,
  Original-Hash-Pins und **fünf unabhängige neutral gebündelte
  QA-Deno-Entrypoints** via esbuild.
- **774/774** Node-Regressionsprüfungen grün; beide historischen
  `mesh-inbox-*`-Index-/Handler-Hashes stimmen exakt mit den
  älteren Review-Manifesten überein. Der nach den Änderungen
  fehlgeschlagene erste Regressionstest wurde **nicht** mit
  neuen Hash-Referenzen übergangen, sondern durch bytegenaues
  Zurücksetzen der Originaldateien und separate QA-Einstiege behoben.
- **16/16** Remote-Usage-Tests grün; TypeScript und Vite
  gebaut; Rust-Format und Git-Diff-Prüfung erfolgreich.
- Auf dem M2 ist keine lokale Deno-Laufzeit installiert; die fünf
  alternativen QA-Einstiege wurden syntaktisch/als vollständiges
  esbuild-Bundle geprüft, **nicht** in einer echten Deno-Edge-
  Runtime ausgeführt. Solch ein Test bleibt zwingend vor Deploy.
- GitHub-CI-Ergebnis und produktive Freigabe sind hiervon
  unabhängig zu kontrollieren. Live KATOOS wurde ausschließlich
  lesend auf aktive Edge-Funktionsnamen/-Versionen untersucht.

## Erforderliche nächste Freigaben

- Ausführliche CI auf allen drei OS, neue Tests gegen die
  **wirklichen** Edge-Deno-Einstiegspunkte mit echten
  GET/POST/PATCH-Mockverträgen und Edge-Sitzungswechsel;
  Deno Runtime/Deploy-Prüfung vor Live-Rollout.
- KatoOS Edge + Datenbank-Entitlement **atomar** am
  Aufnahme-/Entscheidungs- und Remote-Job-Ausführungspunkt,
  inklusive Revoke, Downgrade, 14-Tage-Trial-Ende, Free 0,
  Pro 10 und idempotenten Race-Tests.
- Stage4E-Migration und Stage4F-Billing mit signierter
  unabhängiger Reviewer-Freigabe, Rollback/Freeze,
  M2/M3-SAS/mTLS, Native Accepted-Ledger; echter
  `verifiedPercent` bleibt `null` bis zur Abnahme.

**Keine produktiven SQL-Schreiboperationen, keine Gerätefreigabe,
kein Rollout, kein `main`-Merge und keine Fernaufträge.**
