# KatoSync Mesh – abgesicherte Geräte-Registry (27.10.2026)

## Ergebnis

Der Stand baut die **erste reale, aber rein lesende Registry-Schnittstelle** für KatoSync Mesh:
- Supabase-PostgreSQL-Migration: `katosync_mesh_devices`, `katosync_mesh_owner_policy`, `katosync_mesh_invites`.
- Alle drei Tabellen nutzen RLS. Nur `authenticated` darf **SELECT** auf `auth.uid() = owner_user_id` ausführen. `anon` sieht nichts; `authenticated` darf keine Geräte-/Einladungs-/Policy-Datensätze schreiben, bearbeiten oder löschen.
- Einladungen sind auf zwei unterschiedliche Geräte **desselben Kontos** durch zusammengesetzte Fremdschlüssel begrenzt; Signaturmaterial ist nur öffentlich, maximal 8192 Bytes, Gültigkeit maximal fünf Minuten.
- Native Tauri-Abfrage `mesh_account_devices_list` ist nur im `katoos-auth-qa`-Build aktiv. Sie verifiziert zuerst das KATOOS-Konto online, sendet das kurzlebige Zugriffstoken nur über HTTPS an die feste Supabase-URL, entfernt das Token automatisch aus dem Speicher, prüft **jede zurückgelieferte Gerätebesitzer-ID zusätzlich** und verifiziert die laufende Sitzung nochmals. Token, E-Mail und Private Keys werden nicht an die Oberfläche zurückgegeben.
- Vision zeigt „Meine Geräte“ und „Geräte finden“, weist auf den rein lesenden Status hin und unterscheidet `discovered/pending/trusted/revoked` von einer tatsächlichen Netzwerkverbindung. Kein Fernauftrag wird dadurch ermöglicht.

## Live-Status / Sicherheitsgrenzen

Die echte KATOOS-Datenbank `xbnnlyyxiilklsygxcof` wurde **nur lesend** überprüft. Dort gibt es bereits `kai_devices`, das aber zum KAI-Mandanten-/Agentenmodell gehört und nicht unkontrolliert KatoSync-Peer-Vertrauen übertragen darf. Die drei `katosync_mesh_*`-Tabellen waren am 27.10.2026 noch **nicht vorhanden**. **Die Migration wurde NICHT produktiv angewandt.**

Solange ein vertrauenswürdiges Backend für Enrollment fehlt, wäre jede Benutzer-Schreibberechtigung ein Einfallstor: dieselbe Konto-Session allein könnte ein fremdes Gerät als `trusted` einschreiben. Daher bleiben alle Writes explizit gesperrt, selbst im Auto-Modus. Das künftige Edge-Enrollment muss eine serverseitig gültige Sitzung (bei sensibler Aufnahme inklusive `auth.sessions`), gerätegebundene Ed25519-Challenge, frisches Passkey-Step-up, Owner-Opt-in, Revocation-/Quota-Policy und den einmaligen Signatur-Nachweis unabhängig prüfen.

### Belegte lokale Tests

`bash scripts/test-mesh-registry-postgres.sh` startet einen **temporären lokalen PostgreSQL-17-Cluster ohne Netzwerk-Listener**, wendet die Migration an und testet synthetische Accounts. Nachweis: eigene Geräte/Policy/Inbox sichtbar, Fremdkonto ausgeschlossen, kein anonymer Zugriff, kein Client-INSERT/UPDATE, keine kontoübergreifende Einladung, keine überlange Einladung, Opt-in-Schranke. Erfolgreiches Ergebnis: `MESH_RLS_LOCAL_TESTS_PASS`.

Zusätzlich native Rust-Regressionstests und Frontend-Tests/Build. Keine KATOOS-Sitzung, Mac-Keychain, GitHub-Token, KAI-Produktivtabelle oder M3-App wurden geändert.

## Bevor Production freigegeben werden darf

1. Eigentümerkonto: M2 QA abgelehnte Auth-Sitzung behutsam korrigieren, ohne GitHub-Abmeldung.
2. Gesondertes und kryptografisch korrektes Enrollment-Backend/Edge Function + Replay-/Rate-/Revocation-Tests entwickeln. Backend erhält niemals eine implizite Freigabe allein durch ein Konto-Login.
3. Separate Test-/Staging-DB oder ausdrücklich freigegebene kontrollierte Migration mit Backup/Forward-Rollout; anschließend Supabase Advisors und RLS-Negativtests **mit den tatsächlichen** `anon`/`authenticated`-Rollen und verifizierten JWTs.
4. Erst danach Registry veröffentlichen, M2↔M3 mit überprüften neuen Geräteschlüsseln anmelden und die Geräte aus dem tatsächlichen Backend anzeigen.
5. Vollständiges signiertes, beidseitig bestätigtes Device-Roster und mTLS als gesonderten Meilenstein implementieren. Der UI-Status `trusted` alleine ist niemals ein Transport- oder Schreibrecht.

Der PR ist absichtlich ein **Draft** und darf nicht als vollständiges automatisches Pairing kommuniziert werden.
