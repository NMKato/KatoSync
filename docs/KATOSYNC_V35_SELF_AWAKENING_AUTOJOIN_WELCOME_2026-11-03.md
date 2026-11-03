# KatoSync 3.5 – Autonomer Agentenstart, Mesh-Discovery und Kollegen-Warm-up

Stand: 03.11.2026, lokaler Entwicklungszweig. **Nicht installiert, nicht gemergt, kein echter Peer-Tunnel.**

## Produktziel

Nach der Installation und KATOOS-Anmeldung erkennt jeder Agent das eigene Gerät und vergibt einen stabilen Namen. Er sucht selbstständig nach anderen Mitgliedern desselben KATOOS-Kontos. Nach autorisierter gegenseitiger Kopplung stellt er sich einem Kollegen vor. Ein erfahrener Agent darf ein kleines, ausdrücklich freigegebenes Arbeitsbriefing geben; private Chats, Secrets, Nutzerdateien und rohe Logs bleiben vertraulich. Pro besitzt bis zu zehn voneinander unabhängige Agenten-Slots.

Ein Konto-Login allein ist kein kryptografischer Peer-Trust. Der Nutzer kann die Auto-Join-Option einmalig erlauben. Jede spätere Verbindung benötigt trotzdem serverseitig geprüftes Pro-Entitlement, Enrollment, kein Revoke, gültige Ed25519-Identitäten, signierte Challenge, frischen Besitznachweis, lokale Peer-Pins und authentifiziertes mTLS. Niemals Zugriffsrechte allein wegen gleicher E-Mail vergeben.

## Umgesetzter Stage-3.5-Quellcode, noch keine Installation

1. Native Hardware- und Identitätsabfrage nach gültiger KATOOS-Sitzung in mesh_agent_bootstrap.rs: CPU-Architektur und Kerne, grobe RAM-Klasse, Apple-Chip-Name auf Mac, stabiles Pseudonym aus dem Ed25519-Gerätefingerprint. Keine Hardware-Seriennummer, E-Mail oder IP. Lokales Modell gilt ausdrücklich noch nicht als geprüft.
2. Neuer Tauri-Aufruf mesh_agent_bootstrap_snapshot ist in lib.rs registriert. Er initialisiert einen neuen lokalen Keychain-Schlüssel erst nach Login, ohne Cloud-Geräteregistrierung und ohne Pairing.
3. MeshConnectionCard.tsx führt beim Start nach Anmeldung sowie in Intervallen von 120 Sekunden ein read-only Device-Registry-Refresh aus. Ein erneuter Fingerprint-Abgleich verhindert die Anzeige einer Antwort aus einer zwischenzeitlich gewechselten Kontositzung. Die Oberfläche zeigt Agentenname, Hardware und noch ausstehenden Vertrauensstatus.
4. meshAgentAutoJoin35.ts modelliert nur die Kriterien für automatische signierte Einladungen, anschließende Besitzerprüfung und echten verschlüsselten Transport. Dieses Modul führt keine Netzwerkverbindung und keine Trust-Änderung aus. Remote-Schreibjobs bleiben gesperrt.
5. meshAgentIntroduction35.ts erzeugt ausschließlich nach beidseitiger Zulassung eine kurze einmalige „Hallo“-Nachricht und maximal drei genehmigte Kurzstatistiken (Projektthema, erledigte Aufgaben, Rolle). Ohne TLS/Trust gibt es kein Briefing. Kein Weitergeben von Prompts, Tokens oder Dateipfaden.
6. Vorbestehendes Provider-Fallback kann bei erschöpften Codex/Claude-Kontingenten das lokale Gemma-Modell vorschlagen; Fähigkeit und Hardware müssen separat geprüft werden.

## Verifizierter Ist-Zustand am 03.11.2026

- M2 Pro: Apple M2 Pro, 12 CPU-Kerne, 16 GB RAM, notarisiertes Stage3X-Testprogramm läuft.
- M3: Apple M3, 8 CPU-Kerne, 16 GB RAM, Stage3X und ältere Stage2I-Prozesse laufen.
- Cloud-Registry: exakt zwei am heutigen Tag registrierte Geräte, beide discovered, 0 trusted, 0 offene Einladungen, Kontingent zehn.
- LaunchAgent-Status: Auf dem M2 ist ein KatoSync-Continuation-Watchdog in launchd aktiv. Auf dem M3 existieren Always-On und Watchdog-LaunchAgents, der aktuelle Startstatus beweist jedoch keinen dauerhaften Always-On-Erfolg. Noch keine autonome Peer-Kommunikation.
- Alle neuen Komponenten sind nur im lokalen Arbeitszweig; keine Änderung am laufenden Stage3X, kein produktiver Auto-Pairing-Server.

## Release-Gates für „3.5 fertig“

1. Kompilierung, Rust-/Node-/UI-Tests, Developer-ID-Signierung und Apple-Notarisierung eines separaten QA-Builds; installierte Stable-/Stage3X-Versionen nicht überschreiben.
2. Native Start-/Login-/Hardware-/Identitätsprüfung auf M2 und M3. Neustarts dürfen keine neuen zufälligen Identitäten erzeugen. Auto-Discovery muss beide Geräte korrekt anzeigen.
3. Einmalige, authentifizierte Geräte-Registrierung beim erstmaligen Setup; keine Dubletten nach Neustarts, Quota- und Trial-Status vor Freigabe prüfen.
4. Gesicherte Auto-Join-Option mit Eigentümerzustimmung, Server-Entitlement, Signed Challenge, Passkey, Ed25519-SAS-/Pin-Besitznachweis, Revoke und mTLS. Kein stilles Umgehen der Sicherheitsprüfung.
5. Authentifizierte Agenten senden und quittieren genau eine Willkommen-Nachricht pro Peer-Paar. Nur ausdrücklich freigegebene, begrenzte Projekt-Zusammenfassungen dürfen übertragen werden.
6. Zwei echte M2/M3-Agenten führen zwei unabhängige Jobs durch, mit Log, Cancel, Reconnect, idempotentem Lease und Offline-Sicherheit. Erst danach Prüfung bis zu zehn realen Agenten.
7. OS-Autostart/Watchdog und lokales Gemma-Fallback testen. Schlafende oder ausgeschaltete Rechner können nicht weiterarbeiten; im aktiven Zustand soll KatoSync auch ohne externe KI-Quota weiterlaufen, soweit das lokale Modell die Aufgabe beherrscht.
8. Vor öffentlicher Freigabe App-Abos, Kündigung, Trialablauf, Produktgrenzen und cross-product Rechte getrennt verifizieren.

Eine konditionale Automation kontrolliert die echte 3.5-Abnahme und meldet sich erst nach nachgewiesener Funktionsfähigkeit. Grüne Unit-Tests oder zwei DB-Einträge allein sind keine fertige Mesh-Verbindung.
