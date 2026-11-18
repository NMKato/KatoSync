# KatoSync Mesh Stage 2H: owner-gated Edge enrollment (28.10.2026)

## Umsetzung, reale Cloud-Schritte

Die dedizierte KatoSync-PostgreSQL-Struktur ist bereits auf der verbundenen
Supabase-Instanz mit dem Projekt-Ref `xbnnlyyxiilklsygxcof` aktiv. Sie ist
ein **eigenes Schema**, aber **keine separate Datenbank/kein separates
Auth-System**: KatoSync und KATOOS nutzen weiterhin die gleiche
Supabase-`auth.users`-Instanz. Ein beliebiges gültiges KATOOS-Login darf
deshalb keinesfalls automatisch ein KatoSync-Mesh-Gerät registrieren.

Neu per Live-Migration `20261028204216_katosync_account_membership_admission.sql`:

- `katosync.account_memberships` ist eine reine serververwaltete
  KatoSync-Mitgliederliste: `user_id` (FK auf `auth.users`),
  `access_state` (pending/active/suspended/revoked),
  `authorized_at` und `revoked_at`. Standardzustand `pending`.
- Row-Level Security aktiv, eigene Konto-Lese-Policy, **kein**
  INSERT/UPDATE/DELETE durch `authenticated`; `anon` hat weiterhin
  keinerlei KatoSync-Schema-Nutzung. Nur serverseitiger `service_role`
  darf Mitgliedschaften anlegen oder ändern.
- **Live-Abnahme: 0 Mitglieder.** Keine realen Nutzer, Kontositzungen
  oder Geräte-Schlüssel hinzugefügt. Fremde KATOOS-Nutzer haben dadurch
  keinen aktiven KatoSync-Enrollment-Zugang.
- Die echten SQL-Zugriffsrechte wurden live gegen die verbundenen
  Datenbankmetadaten geprüft. Zusätzlich prüft die lokale,
  vollständig wegwerfbare PostgreSQL-QA die Owner-SELECT-RLS,
  nicht autorisierte Client-Schreibzugriffe und Konto-Wechsel.

Cloud Edge `mesh-device-enrollment` wurde mit `verify_jwt=true`
bereitgestellt: zuerst Version 1 mit fehlendem Freigabeschalter und
HTTP 503/401 bei Negativtests, dann **Version 2** des gehärteten Codes mit
KatoSync-Mitgliedschaftsprüfung. Der serverseitige Secret-Schalter
`KATOSYNC_MESH_ENROLLMENT_STAGE=challenge-and-discovery` ist
gesetzt; die API meldet danach **aktive Function-Version 3**, mit verify_jwt=true. Das öffnet **ausschließlich die ohnehin eingeschränkten
Discovery-Endpoints**, keinen Peer-Trust, keine mTLS-Listener und
keine Remote-Jobs.

## Sicherheitsgrenze der HTTP-Endpunkte

1. Ein gültiges, online bei Supabase Auth geprüftes Nutzer-JWT
   ist notwendig, reicht aber **nicht** aus.
2. Vor Erstellung einer 90-Sekunden-Challenge oder Prüfung eines
   Enrollment-Proofs muss in `katosync.account_memberships` ein
   **aktiver Server-Eintrag** für genau den verifizierten User
   existieren. Fehlende/pending/suspended/revoked Einträge werden
   verweigert; inkonsistente Backenddaten oder Netzwerkfehler
   ergeben Fail-Closed 503.
3. Vor dem irreversiblen Challenge-Verbrauch wiederholt
   `complete.ts` die KatoSync-Mitgliedschaftsprüfung.
4. Die bisherige Ed25519-Signatur, atomare Challenge-Einmalnutzung,
   per-Owner-Limits, widerrufene-Geräte-Sperre und Fingerprint-
   Validierung bleiben zusätzlich aktiv.
5. Der Backend-Konto-Status ist eine **Zulassung zur Registrierung**
   und kein Vertrauensnachweis zwischen zwei Geräten. Für echte
   Mesh-Kopplung sind weiterhin manuelle gegenseitige SAS-Freigabe,
   lokal gespeicherte Peerschlüssel, mTLS und Live-Revoke nötig.

Live-Negativtests mit dem öffentlich bekannten anon-API-JWT
ergeben für Challenge **401**, für den absichtlich ungültigen
Complete-Proof **400**, und ohne Authorization-Header **401**.
Kein echter aktiver KatoSync-User-JWT wurde zum positiven E2E-Test
verwendet; dieser Nachweis bleibt somit **ausstehend**, ebenso die
realen M2↔M3-Enrollment- und mTLS-Läufe.

## Für echte M2/M3-QA erforderlich

- Die beiden KatoSync-App-Installationen mit der neuen QA-Version
  versorgen (nicht Teil dieser PR).
- Die tatsächlich angemeldete Eigentümeridentität **ohne
  Token-Export** über die App verifizieren. Die persönliche
  Freigabe muss serverseitig nach nachweisbarer Authentifizierung
  als aktive `katosync.account_memberships`-Zeile erfolgen.
  **Kein automatisches Hochstufen aller KATOOS-User**.
- Auf jedem Mac die bestehenden lokalen Ed25519-Keychain-Identitäten
  durch den Scan-Flow anmelden, im KatoSync-Owner-Roster prüfen.
- Erst danach auf beiden Macs den gleichen signierten SAS
  manuell bestätigen und echte mTLS-Probes testen. Kein verborgener
  Auto-Approve und keine Remote-Schreibrechte.

## Reproduzierbarkeit

`npm test` prüft die Mitgliedschafts- und Enrollment-HTTP-Mocks
einschließlich negativer BOLA-/Revocation-/Netzwerkfälle.
`npm run test:katosync-schema-local` prüft das echte SQL in einem
ephemeren lokalen PG17-Cluster ohne TCP-Socket; Testcluster wird nach
Abschluss gelöscht. `npm run build` prüft TypeScript und Vite.
Die Migration wurde über den verbundenen Supabase-Dienst angewendet
und im Git unter der **tatsächlich angewendeten** Version geführt.

Auf M2 und M3 ist eine KatoSync.app mit Versionsangabe 2.0.0 vorhanden; das beweist **nicht**, dass die gestapelten Draft-PRs oder die neue Enrollment-Logik in diesen Installationen liegen.

Keine Änderungen an KATOOS-CMS-Tabellen, bereits installierten
KatoSync-Apps, Passwörtern oder bestehenden GitHub-Draft-PRs.
