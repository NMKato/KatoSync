# KatoSync Hybrid Mesh — Private Realtime Signaling Stage B1

Stand: 28. Oktober 2026. Draft; kein Produktiv-Deployment.

## Architektur
KATOOS / Supabase vermittelt PRIVATE, kontogebundene Presence- und Broadcast-Nachrichten. Native Rust-Agenten verifizieren Geräteschlüssel und signierte Einladungen. Realtime-Kanalzugriff gewährt KEINE Peer-Vertrauensstellung, keine Hub-Leader-Rolle, keine mTLS-Verbindung und keine Fernauftragsrechte.

## Berechtigungen
Ein signierter Nutzer kann ausschließlich den eigenen Kanal betreten:
katosync-mesh-owner:v1:<kanonische auth.uid>

Nur Presence und Broadcast werden zugelassen. Anonyme Sessions, fremde Konten, abweichende Kanalnamen und andere Nachrichtentypen werden abgewiesen. Vor dem Deployment müssen öffentliche Realtime-Kanäle in den Projekteinstellungen kontrolliert und private:true auf jeder Client-Subscription verwendet werden. Eine globale Einstellung ist nicht allein durch RLS ersetzt; vorhandene KATOOS-Kanäle müssen dabei berücksichtigt werden.

## Nachrichten
Versionierte, höchstens 8192 Byte große öffentliche Angebote/Challenges/Responses. Zielgerät, absendendes Gerät, Konto und Ablauf werden geprüft. Keine Passwörter, Access- oder Refresh-Tokens, privaten Schlüssel, Fernaufträge oder Projektinhalte. Eine formal gültige Nachricht ist weiterhin UNTRUSTED und muss im nativen Rust signaturgeprüft werden.

## Nachweise
- 314/314 Node-Frontend-/API-Tests, TypeScript und Vite-Produktionsbuild bestanden.
- Isolierter temporärer PostgreSQL-Cluster ohne Netzwerklistener: MESH_REALTIME_PRIVATE_RLS_PASS.
- Fehlende Live-Berechtigungen bleiben gesperrt; keine produktiven Datenbank-/Realtime-/Cloudflare-Änderungen.
- Stage A Registry, Inbox und Challenges nicht in KATOOS-Produktion ausgerollt.
- WebSocket-Subscription, dauerhafter Einladungseingang, echtes M2-M3-Pairing, mTLS und Hub-Election bleiben offene Folge-Gates.

Offizielle Dokumentation: https://supabase.com/docs/guides/realtime/authorization
