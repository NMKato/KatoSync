# Beta4: explizit freigegebener nativer Git-Status

## Implementierter Umfang

Der private Stage4J-Beta-Client kann über die vorhandene ausgehende WSS-Verbindung
einen signierten `katosync_git_status`-Auftrag bearbeiten. Die Standardverbindung
bleibt bei Gerätepräsenz. Git-Lesezugriff benötigt zwei getrennte, ausdrückliche
Freigaben:

1. Der ChatGPT-Client erhält nach erneuter MFA-Prüfung zusätzlich zu
   `devices.list` und `device.status` den Scope `git.status`. Bestehende Grants
   werden nicht erweitert. Die native Prüfung und die Bestätigungsansicht
   müssen genau dieselben gespeicherten Scopes anzeigen.
2. Der Eigentümer wählt in dieser App bis zu acht aktive registrierte Projekte
   aus und startet die Verbindung mit dieser Auswahl. Eine Registrierung allein
   erteilt keine Leseberechtigung. Die Auswahl bleibt ausschließlich im Speicher
   des gestarteten Relays und wird beim Stoppen oder Kontowechsel verworfen.

Die native IPC stellt hierfür nur bereinigte Projektnamen und stabile IDs bereit.
Dateisystempfade gelangen nicht in den Projektwähler, das Ticket oder das Ergebnis.
Andere Build-Profile behalten ihre bestehenden Konfigurationssperren.

## Bindungen und Ausführung

Das HTTPS-Ticket muss die genaue lokale Projektmenge und ausschließlich
`katosync_git_status` zulassen. Der signierte Auftrag verwendet den vorhandenen
RC67-Umschlag mit einer exakten Gültigkeit von 15 Sekunden. Die native Seite prüft
den unabhängig eingebauten Ed25519-Server-Pin, Eigentümer, Mandant, Grant,
Gerät, Sitzung, Request-ID, monotone Serversequenz und Ablauf. Der Auftragskörper
enthält genau `toolName`, `projectId`, `oauthClientId` und `authorityRevision`;
Client und Authority-Revision müssen mit dem Ticket übereinstimmen.

Requests und signierte Serverbestätigungen teilen sich denselben monotonen
Sequenzzähler. Bereits konsumierte Request-IDs, zusätzliche Argumente, fremde
Projekte, geänderte lokale Wurzeln und fehlende oder abgelaufene Heartbeat-Leases
werden abgelehnt. Pro Sitzung kann höchstens ein Git-Ergebnis ausstehen. Ein
Widerruf oder eine Änderung der Cloud-Autorität muss zusätzlich im Connector
vor Dispatch und vor Ergebnisfreigabe erneut geprüft werden.

Der Runner verwendet eine feste Git-Binärdatei und feste Argumente ohne Shell.
Geerbte `GIT_*`-Steuerungen werden entfernt; globale/systemweite Git-Konfiguration,
fsmonitor und optionale Schreib-Locks sind deaktiviert. Die registrierte kanonische
Projektwurzel wird vor und nach der Ausführung erneut gebunden. Alle Git-Prozesse
teilen sich ein Zeitbudget von höchstens acht Sekunden ab dem signierten
Ausstellungszeitpunkt des Auftrags, zusätzlich begrenzt durch
Request, Ticket, Heartbeat-Lease und Sitzungswechsel. Ein Abbruch beendet den
laufenden Kindprozess.

Das gemeinsame Budget beginnt erst nach dem frischen Autoritätscheck in der
Connector-Signierqueue. Warte- oder Übertragungszeit erzeugt auf dem Gerät keine
neue Ausführungsfrist. Native prüft Rotation und Uhrabweichung erneut nach jedem
Socket-Empfang und direkt vor Ergebnisversand. Regulärer Ablauf löst eine neue
Verbindung aus; ein bereits abgelaufenes Ergebnis wird nicht mehr gesendet.

Das Ergebnis enthält ausschließlich Projekt-ID, Branch, HEAD-Hash,
`dirty` und die feste Provenienz `local_git_verified_root`. `dirty` bezieht sich
auf getrackte Änderungen im ausgewählten Hauptprojekt. Ungetrackte Dateien und
Änderungen innerhalb von Submodul-Arbeitsverzeichnissen werden nicht untersucht.
Es werden keine Dateinamen, Inhalte, Diffs, Roh-Ausgaben oder Fehlertexte übertragen.
Das vorhandene Geräte-Ed25519-Schlüsselpaar signiert das Ergebnis mit derselben
Request-ID. `remoteExecutionAllowed` und `remoteJobsEnabled` bleiben `false`.

## Prüfnachweise und offene Abnahme

- 15 gezielte TypeScript-Tests bestanden: getrennte Client-/Gerätefreigabe,
  exakte Zwei-/Drei-Scope-Prüfung, Änderung einer vorbereiteten Freigabe,
  gültige lokale Projektmenge und Ablauf einer Präsenzanzeige.
- TypeScript-Prüfung und Produktions-Webbuild bestanden.
- 32 native Tests bestanden in einer isolierten Linux-Quellcode-Harness mit
  Rust 1.95.0, der im Repository festgelegten Version. Die echten Relay-,
  Owner-/Device-Review- und Codec-Module wurden kompiliert. Plattform-Auth,
  Keychain und Registry-Zugriff waren dort absichtlich nicht verfügbar.
- Ein echtes temporäres Git-Repository prüfte sauberen und geänderten Zustand,
  unveränderte Indexdatei, ausgeschlossene ungetrackte Dateien, Ablaufgrenzen
  und die Abwesenheit von Pfaden, Dateinamen und Inhalten im Ergebnis.
- Die öffentliche synthetische
  [Connector-Fixture](../src-tauri/tests/fixtures/beta4_native_read_wire.json)
  stammt aus den produktiven RC67/RC70-Signierern. Native Prüfung von Ticket,
  Challenge, Heartbeat-ACK, Auftrag und Ergebnis-ACK bestand; das native
  Ergebnis-JWS stimmt Byte für Byte mit der Connector-Fixture überein.

Diese Nachweise bestätigen Quellcode und Protokollkompatibilität. Sie ersetzen
keinen vollständigen macOS-App-Build und keinen Live-Aufruf aus ChatGPT auf einem
freigegebenen Gerät. Für die Beta-Freigabe bleiben der gebündelte finale CI-Lauf,
die gekoppelte Connector-/Datenbank-Bereitstellung und der echte Verbindungs- und
Git-Status-Test mit frischer Freigabe erforderlich. Allgemeine Terminal-, CLI-
oder Computersteuerung ist nicht Bestandteil dieser Erweiterung.

Quellcode:
[Relay](../src-tauri/src/remote_mcp_relay.rs),
[nativer Git-Dispatcher](../src-tauri/src/remote_mcp_relay/git_status.rs),
[Owner-Review](../src-tauri/src/remote_mcp_owner_review.rs),
[Projektwahl](../src/components/RemoteMcpRelayPanel.tsx).
