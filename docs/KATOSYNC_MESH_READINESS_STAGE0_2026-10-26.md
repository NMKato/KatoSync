# KatoSync 2.0 → 3.0 – Mesh-Stufe 0, lokaler Read-only-Check (26.10.2026)

## Ziel und verifizierter Ausgangsstand
Drei autorisierte Rechner waren über den separaten Remote Desktop Commander erreichbar: Mac M2 Pro, Mac M3 und Windows-ZenBook. M2 führte die isolierte KatoSync-2.0-Test-App mit aktivem lokalen Gemma Vision aus. Auf dem M3 war ein KatoSync-Local-Control-Dienst vorhanden; ein regulär aktives GUI war nicht belegt. Auf Windows waren Codex und Claude vorhanden, aber noch keine aktive KatoSync-App nachgewiesen.

Die unabhängige RDC-Erreichbarkeit ist kein Nachweis von KatoSync-Mesh-Pairing oder gegenseitiger sicherer Jobübergabe. Keine privaten Adressen, Konten, Seriennummern, Tokens oder personenbezogenen Geräte-IDs gehören in dieses öffentliche Dokument.

## Umsetzung – bewusst minimal und fail-closed
- Tauri-Befehl mesh_local_readiness liest nur den vorhandenen Local-Control-Daemon-Heartbeat, Betriebssystem und CPU-Architektur. Er erzeugt weder Netzwerk-Listener noch Peer-Registrierung, Token, Remotejobs oder Persistenz.
- Heartbeat: bis 90 Sekunden nach letzter gültiger Aktualisierung frisch; danach veraltet. Ungültige Zeit, unplausibel zukünftige Zeit, fremder Status oder fehlende Daten ergeben unbekannt – niemals verbunden.
- Vertrauensfelder bewusst fix: deviceIdentity=not_paired, peerTransport=not_connected, verifiedPeers=0, remoteReadOnlyDispatch=false, crossDeviceWrites=false.
- Vision-Oberfläche zeigt eine kompakte Mesh-Bereitschaft, Stufe 0 mit echtem lokalem Status, fehlender Kopplung und deaktiviertem Fernauftrag. Neu-Prüfen liest nur lokal. Vier Sprachen.
- Der bestehende Vision-Graph und die aktuellen Local-Control-/Orchestrator-Daten werden weiterverwendet, statt einen zweiten Mesh-/Job-Scheduler anzulegen.

## Separater LAN-Reachability-Test am 26.10.2026 (ohne Mesh-Pairing)
- M2 → M3: zwei von zwei ICMP-Proben beantwortet.
- M3 → M2: zwei von zwei ICMP-Proben beantwortet.
- Windows → M2: zwei von zwei ICMP-Proben beantwortet.
- M2 → Windows: null von zwei ICMP-Proben beantwortet; Ursache nicht festgestellt (möglicherweise Firewall/ICMP-Regel). Keine Windows-Einstellung geändert.
- Geräte befanden sich im gleichen privaten LAN-Adressbereich. Die Adressen wurden bewusst nicht in Issue, Commit oder Dokumentation geschrieben.
- ICMP beweist weder TCP-Port-Erreichbarkeit noch Benutzer-Authentizität, TLS-Vertrauen, Tauri-Zugriff, sichere Dateifreigabe oder KatoSync-Mesh-Funktion. Kein Listener und kein Fernjob gestartet.
- Nächster gezielter Test: M2↔M3 als zuerst manuell gekoppelte Kandidaten, vor echtem Transport jedoch verifizierte Geräteidentität, Opt-in und eine verschlüsselte Session nachweisen. Windows erst danach mit Firewall-/Installer-QA.

## Strikte nächste Stufen aus Issue #127
1. Geräteidentität pro KatoSync-Installation mit kryptografisch nachweisbarer Bindung an das authentifizierte Konto. Manuelles Zwei-Geräte-Pairing und separater Widerruf, niemals allein nach Gerätename, Hostname, IP oder RDC-Präsenz.
2. Beidseitig authentisierter und verschlüsselter LAN-Transport; keine automatische Weitergabe von Repos, Tokens, Memory oder Privatreferenzen. Heartbeat mit Ablaufzeit, Fähigkeiten nur nach ausdrücklichem Pairing und Zustimmung.
3. Genau ein Read-only-Git-Metadatenauftrag, eindeutige Job-ID, authentifiziert korreliertes Ergebnis und unveränderte Git-Hashes; Replay-/Doppelzustellung fail-closed.
4. Schreibaktionen/Shared-Worktrees bleiben bis zur separaten Freigabe von #76 (Cross-Device-Lease, isolierte Worktrees, Human Approval) blockiert.
5. Windows/macOS-Pakete, Gerätewechsel, Login/Logout/Revoke und Offline-/Wiederaufnahme gesondert testen.

## PR- und Release-Grenzen
Diese Stage-0-Bereitschaft darf nie als produktives Mesh vermarktet werden. Offene gestapelte PRs, KATOOS-SSO-Klärung, ad-hoc macOS-Signatur und Testgeräte-Installationen bleiben gesonderte 2.0-Gates. Keine automatischen Merges. Öffentliche Dokumentation ohne Secrets.
