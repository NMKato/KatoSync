# KatoSync Mesh — Stage4U Relay-Scheduler-Sicherheitskorrektur (QA)

Created by NMKato Solutions
Datum: 11. November 2026
Base: qa/stage4t-human-first-mesh-ux-20261111, 35784cc3959b914cbc9697a93a1099ec573aea32

## Physischer Fehlernachweis, 11. November 2026

M2 und M3 waren in der Konto-Registry erfasst. Echte Einladungen wurden übertragen und auf beiden Macs angenommen, aber weder mTLS noch ein verschlüsselter Remote-Auftrag nachgewiesen. Es gab keine erfolgreich gespeicherten Challenge-/Response-Relay-Nachrichten für die beiden angenommenen Einladungen.

Read-only Supabase-Suche für 17:48–18:06 UTC:
- Für /functions/v1/mesh-pairing-relay-qa: 108 HTTP-200-Antworten und vier HTTP-503-Antworten.
- PostgreSQL bestätigt für vier Fehlzeitpunkte (18:00:07, 18:00:17, 18:01:42, 18:02:20 UTC) KATOSYNC_MESH_RELAY_READ_RATE_LIMIT, SQLSTATE 23514.
- Die Datenbankfunktion katosync.mesh_relay_read_rate_guard() limitiert auf höchstens zwölf signierte Reads pro Gerät in einer rollierenden Minute.
- Der unveränderte Stage4S-Client rief alle 5 Sekunden ab, zuzüglich initialer und durch Statewechsel ausgelöster Abfragen.
- Zusätzlich kann der bisherige relayInFlight-Schutz einen vorbereiteten Challenge-/Response-Versand überspringen. Der sendende Effekt wurde danach nicht garantiert erneut ausgelöst. Dieser mögliche Ablauf ist aus dem Quellcode reproduzierbar; er bleibt als Live-Ursache bis zum End-to-End-Test eine Hypothese.
- Parallel versandte Einladungen in beide Richtungen sind ein zusätzlicher Risikofaktor; der Datenbank-Invite-Guard meldete KATOSYNC_MESH_INVITE_ALREADY_PENDING während des realen Tests.

## Isolierte Codekorrektur

1. Signierte Relay-Reads höchstens alle zwölf Sekunden plus initialer Read; dadurch genügend Abstand zur unverändert strengen 12/min-Backend-Grenze.
2. Die gebundene, bereits vom Besitzer initiierte signierte Herausforderung bzw. Antwort hat Vorrang vor reinen Read-Polls. Bei gleichzeitig laufender Read-Operation wartet der Send-Effekt auf das Ende und prüft erneut, statt still zu verschwinden.
3. Kein Read während der Verarbeitung des akzeptierten Angebots, beim Pending Outbound, bei Fehler, bei abgelaufener oder bestätigter Sitzung.
4. Fehler beim Native Challenge oder Relay führen zu einem eindeutigen „Sicherheitsprüfung nicht abgeschlossen“-Zustand statt endlosem Prüfen. Keine automatische Neu-Einladung, kein unsicherer Retry.
5. Ein zweiter Eingangs-Annehmen/Ablehnen-Klick wird clientseitig während einer laufenden Kopplung blockiert. Backend-Guards für Rate-Limits, Replay und doppelte Einladungen bleiben unverändert.

## Prüfung & Release Gate

- Bestehende Stage4S-Regressionen: 28/28 PASS.
- Stage4T UX und Stage4U Poll-/Race-Tests: 14/14 PASS.
- Frontend-Build und CI: im jeweiligen Lauf separat nachzuweisen, bevor eine neue App freigegeben wird.
- Kein Backend-/Policy-/RLS-/Keychain-Write, kein autonomer Pairing-Approve, kein Remote-Execution, kein Merge auf main.
- End-to-End-Gate: genau eine neue, gerichtete Einladung nach Ablauf alter Requests, Empfänger nimmt an, signierte Challenge wird gespeichert, signierte Antwort wird gespeichert, beiden identischen SAS werden jeweils vom Nutzer bestätigt. Danach separate native mTLS- und Read-only-Remote-Gates.
- Kein Production- oder Beta-Rollout vor Signatur, Notarisierung und überprüfter physischer Zwei-Mac-QA.

Status: QA Source; eine gelungene Live-Kopplung darf nicht aus Quellcode-/CI-Ergebnissen abgeleitet werden.
