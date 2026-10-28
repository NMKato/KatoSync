# KatoSync Hybrid Mesh – Stage B0: bevorzugter Hub (28.10.2026)

## Entscheidung
- **Supabase Auth + Device Registry + private Realtime Presence/Inbox**: geringe Mengen öffentlicher Geräte-Metadaten und signierter Einladungen; keinerlei Projekte, Zugangsdaten oder private Schlüssel in Presence/Broadcast.
- **Tauri/Rust auf jedem Rechner**: lokaler Mesh-Agent für Identität, vertraute Peer-Verbindung, Auftragsverarbeitung und lokale Ressourcen.
- **Bevorzugter Hub pro Rechner**: lokale Benutzerpräferenz (siehe Details in Verbindungen), *nicht* ein zusätzlicher Server, nicht ein Rollen- oder Fernsteuerungsrecht.
- **Cloudflare Workers/Durable Objects**: nur optionaler Fallback, falls authentifizierte Geräte später standortübergreifendes Relay brauchen. Kein Warm Worker/Always-on-Cloudserver.
- **n8n**: nicht im Echtzeit-Datenpfad. Weiter für Workflows, GitHub-Sync und Automationen.

## Implementiert in diesem Branch
- Neue native Tauri-Kommandos `mesh_hub_preference_get` und `mesh_hub_preference_set`.
- Speicherung einer schema-versionierten, nicht-geheimen *gerätebezogenen* Einstellung im App-Konfigurationsverzeichnis.
- Default **aus**, atomarer Schreibvorgang, kontrolliertes Wiederlesen, Ablehnung beschädigter/unerwarteter Inhalte oder von Symlink-Pfaden.
- In Verbindungen → KatoSync Mesh → Details: Option „Diesen Rechner als bevorzugten Mesh-Hub markieren“.
- Explizite Rückmeldung „Noch kein Hub aktiv“; keine Netzwerklistenings, keine automatische Kopplung, keine Remote-Job-Rechte.
- Lokalisiert DE/EN/ES/RU. Vision bleibt unverändert und sauber.

## Für echten Hub/Failover noch erforderlich
1. PR #155/#160 Server-Registry und Schlüsselbesitznachweis isoliert als QA ausrollen und Online-Gerätemetadaten mit RLS verifizieren.
2. Private, kontogebundene Realtime Presence mit frischen Heartbeats (z. B. ~30–60s), *kein* Status aus alter `last_seen_at` als „online“.
3. Authentifizierter, bidirektionaler TLS 1.3/mTLS-Peer-Transport samt Trust-Store-Bindung. Cloud liefert nur öffentliche Rendezvous-/Signaling-Materialien.
4. **Hub-Election nur unter bestätigten Peers**, deterministische Präferenz und ein vom Koordinator mit monotonem Epoch-/Lease-Token abgesicherter Leader. Ein lokales Häkchen gewährt keine Leader-Autorität.
5. Fencing: sobald Lease abläuft oder der Controller die Session verliert, darf der Hub keine neuen Aufgaben vergeben. Bei Netzwerkpartition nicht zwei voneinander unabhängige aktive Writer zulassen.
6. Offline LAN: bereits bestätigte Geräte dürfen innerhalb gespeicherter Berechtigungen weiterarbeiten; automatische neue Vertrauensstellung bei Cloud-Ausfall ist verboten.
7. Erst nach echter Verbindung Uptime/RTT, Link-Qualität, automatische Wiederverbindung und „Trennen“ anzeigen.

## Release Gate
Nur Draft/Entwicklungszweig. Keine produktive Supabase-Migration, kein Cloudflare Deployment, keine Änderung an M2/M3-Installationen oder n8n. Eigentliche Hub-Wahl und Peer-Transport bleiben ausdrücklich **nicht implementiert**.
