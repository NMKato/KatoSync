# Stage 3U – Gemeinsamer KATOOS-Issuer, getrenntes katosync-Schema

**02.11.2026 · QA-only · gestapelter Draft auf Stage 3T · kein produktives DDL**

## Aktueller, lesend geprüfter Cloud-Stand

Das bestehende KATOOS-Supabase-Projekt hat bereits das Schema `katosync`. Fünf Tabellen existieren: `account_memberships`, `mesh_devices`, `mesh_enrollment_challenges`, `mesh_invites`, `mesh_owner_policy`. Alle fünf haben RLS aktiviert. Vier besitzen `authenticated`-SELECT-Policies mit `auth.uid()` als Eigentümerfilter; die Challenge-Tabelle hat bewusst keine Benutzer-Policy und kein direktes `authenticated`-SELECT. `anon` besitzt weder Schema-USAGE noch Tabellen-SELECT. Bereits existierende Daten/Registrierungen wurden **nicht** verändert.

Im Repository liegen acht Schema-/Mesh-Migrationsdateien. Drei Basismigrationen (`20261028202403`, `20261028202503`, `20261028204216`) sind auf dem KATOOS-Produktivprojekt im Migrationsverlauf vorhanden. Die fünf weiteren Inbox-/Relay-Migrationen des Repos stehen **nicht** in dessen Migrationsverlauf. Die aktive Cloud-Funktion `mesh-device-enrollment` existiert, ist aber keine vollständige Inbox-/Relay-E2E-Freigabe.

## Implementierter, explizit vom Benutzer ausgelöster Preflight

Das Tauri-Kommando `mesh_katoos_shared_preflight` ist ausschließlich mit dem opt-in Feature `katoos-auth-qa` und der exakt gepinnten KATOOS-Origin aktiv. Es führt den vorhandenen Online-`/auth/v1/user`-Nachweis aus und verwendet dieselbe native Sitzung für **einen** read-only-GET auf `/rest/v1/account_memberships`, `Accept-Profile: katosync`, `limit=2`, `user_id=eq.<verified-uid>`. Der Server steuert die Datenzugriffe weiterhin mit explizitem GRANT + RLS.

Alle Antworten werden auf 2048 Bytes beim Empfang begrenzt. Der Parser akzeptiert nur 0 oder 1 Datensätze mit identischer UUID, zulässigem Membership-State und plausiblem `authorized_at`; ein aktiver Nutzer darf nicht widerrufen sein. Nach dem GET wird dieselbe Konto-Identität erneut geprüft. Im Frontend wird der Prüflauf erst durch einen eigenen Button gestartet. Status: nicht geprüft, aktiv, nicht Mitglied oder Fehler, DE/EN/ES/RU. Keine Token, Nutzer-IDs oder Serverantworten in der UI.

**Grenze:** `discoveryAuthorized` ist nur eine bereits bestehende Membership-Voraussetzung, **keine** Kopplungsfreigabe. `paired=false`, `transportReady=false`, `remoteJobsEnabled=false` sind stets fest. Legacy-KatoSync-Sitzungen dürfen nicht umgebunden werden. Die getrennte Stage3S-Preview-Anmeldung wird nicht automatisch mit KATOOS zusammengeführt oder zum Umgehen der Auth-Gates genutzt.

## Vor Freigabe der fehlenden Migrationen

1. Den Ist-Stand aller vorhandenen Tabellen, Policies, Grants und Migrationsabhängigkeiten mit dem Git-Stand abgleichen; Schema-`katosync` nicht neu anlegen.
2. KATOOS-Backup/Restore-/PITR-Rückweg prüfen; geplante Änderung als neue versionierte Migration(en) vorbereiten und lokal auf einer synthetischen, frischen DB ausführen.
3. Neue Inbox- und Relay-Tabellen standardmäßig mit RLS, minimalen Grants und ohne `anon`-Rechte anlegen; sicherstellen, dass kein selbständig bestätigter Trust oder Remote-Job möglich ist.
4. Bei echten Tests KATOOS-Auth-Token online validieren, serverseitige `account_memberships` verlangen, Signatur-/Nonce-Replay-Sperren und Device-Revocation testen. Erst danach zwei signierte native QA-Builds mit ausdrücklicher M2/M3-Bestätigung.
5. Bestehende Produktionsfunktionen, KATOOS-`auth.users`, M2/M3-Stage2I-Apps und produktive Daten unverändert lassen, solange diese Abnahme offen ist.

**Keine Datenbankmigration oder produktives Function-Deployment in Stage 3U.**
