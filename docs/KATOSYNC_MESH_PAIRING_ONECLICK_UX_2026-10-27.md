# KatoSync Mesh – Ein-Klick-Bedienkonzept (M2 ↔ M3)

## Zielbild
1. Beide Geräte sind mit derselben online verifizierten KATOOS-Identität angemeldet und halten je ihren eigenen Schlüssel im macOS-Schlüsselbund.
2. Die Verbindungsliste zeigt erreichbare, noch NICHT vertrauenswürdige Geräte mit Name, Plattform und letztem Kontakt. Die gleiche Kontoanmeldung ist keine Gerätefreigabe.
3. Der Benutzer drückt auf M2 „Einladen“. Auf M3 erscheint „Einladung von M2 – Annehmen / Ablehnen“ (5-Minuten-Ablauf).
4. Jede Einladung ist signiert, gerätegebunden, replaygeschützt und nur einmal verwendbar. Beide Geräte müssen dem Sicherheitsnachweis und der Verbindung explizit zustimmen.
5. Sichtbare Statusarten: Ausstehend / Abgelehnt / Lokal freigegeben / Verbindung gesichert / Offline. Die Aktivierung von Remote-Jobs ist ein gesondertes Recht, niemals Teil einer stillen Pairing-Nebenwirkung.

## Discovery-/Inbox-Service (noch nicht implementiert)
- Authentifiziertes Supabase-Realtime/Edge-Functions-Relay mit eng begrenzten RLS-Regeln. Nur auf dieselbe verifizierte Account-Scope begrenzte kurzlebige Presence.
- Invite-Daten: zufällige Request-ID, öffentlicher Schlüssel, kryptografische Signatur, Account-Scope, gebundener Empfänger-Key, Nonce, Ablauf, einmaliger Zustandswechsel (pending, accepted, rejected, expired). Keine Passwörter, Supabase-/GitHub-Tokens oder Signing-Seeds.
- Abruf/Push auch über verschiedene Netzwerke, ohne offene LAN-Ports. Optional lokal per mDNS mit zufällig rotierenden Kennungen, niemals öffentliche E-Mail-Broadcasts.
- IdP-Session bei Senden und Annehmen erneut prüfen; Rate Limit gegen Spam, Replay- und Race-Tests, Geräte-Reset, Kontowechsel, Revocation, Session-Revoke und Logout abdecken.
- Bei der ersten Kopplung optional expliziter SAS-Vergleich; risikobasiert stets verfügbar. Alle notwendigen Signaturen und Bestätigungen bleiben verpflichtend.
- Rechte feingranular: Geräte anzeigen, nur Read-only-Projektvorschau, Dateien freigeben, Fernauftrag erlauben. Kein standardmäßiger Schreib- oder Terminalzugriff. Geräteverwaltung mit Umbenennen, Entfernen, Widerruf und Status.

## Aktueller belegbarer Stand (27.10.2026)
- M3: Signierter Gerätekey vorhanden, Einladung erzeugen funktioniert.
- M2: KATOOS-Session wird online zurückgewiesen (PR #150). Korrektur durch isolierte interaktive Reauth erforderlich. Blindes Abmelden würde zusätzlich GitHub-App-Credentials löschen.
- Bislang kein Relay, keine Geräte-Inbox, kein Mesh-Netzwerktransport; keine echte Auto-Erkennung und kein E2E-Sync. Bestehende Stage-1B/Stage-3-Technik ist nur lokal signierte Beweisführung, nicht mTLS.
- Dieser Draft ergänzt zunächst nur die schnelle, ehrliche manuelle UI: ein Klick für Identity+Einladung, eingehende Signatur prüfen und Herausforderung erstellen, Copy-Feedback; JSON und SAS unter technischen Optionen. Keine ungesicherte automatische Verbindung.
- Nächste Gates: M2 Auth erneuern, M2+M3 signierte Proofs und lokale Zustimmung, Inbox/Discovery bauen, mTLS und negative Sicherheitstests, erst dann Deployment.
