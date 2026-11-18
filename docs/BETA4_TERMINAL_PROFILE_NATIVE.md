# Beta4: einmalig freigegebenes Terminalprofil

Created by NMKato Solutions

## Umfang

Der native Desktop unterstützt als ersten Terminalpfad ausschließlich das feste Profil `git_version`. Das MCP-Tool `katosync_run_terminal_profile` erhält nur `deviceId`, `projectId`, `profileId` und `operationId`. Es gibt keine Eingabe für einen Befehl, Shelltext, ein Executable oder ein Arbeitsverzeichnis. Allgemeine Terminalbefehle und Computer-Use-Eingaben sind damit nicht implementiert.

Die Ausführung verwendet den vorhandenen nativen Git-Runner mit absolutem Git-Pfad, strukturierten Argumenten, dem aktuell bestätigten kanonischen Projektverzeichnis und bereinigten Git-Umgebungsvariablen. Das einzige Profil ruft `git --version` auf. Das gemeinsame Budget endet acht Sekunden nach dem signierten Request-Zeitpunkt; Transportzeit setzt es nicht zurück. Ausgabegrenze und Prozessabbruch bleiben im bestehenden Runner.

## Freigabekette

1. Der Client benötigt zusätzlich zu `devices.list`, `device.status` und `git.status` den ausdrücklich beantragten Scope `terminal.run_profile`.
2. Der Nutzer aktiviert Terminalprofile für die konkrete native Verbindung und wählt registrierte Projekte aus. Ohne beide Schritte wird ein Terminal-Ticket abgelehnt.
3. Eine native Prüfung erzeugt einen einzelnen an Owner, Tenant, OAuth-Client, Grant, Gerät, Projekt, Profil und Authority-Revision gebundenen Auftrag. Nonce, Auth-Challenge und Gerätesignatur bleiben nativ.
4. Ein frischer Authenticator-Code wird über den vorhandenen nativen GoTrue-Pfad bestätigt. Der native Geräteschlüssel signiert die exakten UTF-8-Bytes des bestätigten Auftrags. Der Worker prüft die echte MFA-Metadatenbindung und reserviert die Operation bei Ausführung einmalig.
5. Der Desktop hält zusätzlich eine höchstens 60 Sekunden gültige lokale Einmalzustimmung. Sie bleibt bei einer normalen WSS-Erneuerung erhalten, ist an die aktuelle Owner- und Relaygeneration sowie den kanonischen Projektroot gebunden und wird vor jedem Prozessstart atomar verbraucht.
6. Der Dispatcher prüft die unabhängig gepinnte Request-Signatur und das separate Approval-JWS, sämtliche Bindungen, die Argument- und Geräteproof-Hashes sowie beide Fristen. Vor Ausführung und Ergebnisfreigabe werden aktuelle Generation, Projektzustimmung und Budget erneut geprüft.
7. Das tatsächliche Ergebnis wird mit dem registrierten Geräteschlüssel signiert. Ein erfolgreich vorbereiteter Auftrag wird in der UI ausdrücklich noch nicht als Ausführungsergebnis bezeichnet.

Der WebSocket-Handshake sendet zusätzlich das aktuelle native Owner-Bearer-Token ausschließlich als sensitiven Authorization-Header an den fest eingebauten WSS-Endpunkt. Es erscheint weder in URL noch JavaScript. Der Worker prüft den echten Owner vor der Auswahl eines Device-Durable-Objects; Ticket, Gerätesignatur und innere Authority-Prüfungen bleiben erhalten.

Das native Paket verwendet den öffentlichen Relay-Pin `katosync_beta4_relay_20261118c`. Der unabhängige Owner-Intent-Pin gehört zum Worker; der Desktop führt keinen ungenutzten zweiten Pin ein.

## Abbruch und Wiederholung

Die laufende Review-ID bleibt auch während einer asynchronen Bestätigung registriert. Ein passender Abbruch verhindert die späte lokale Approval-Eintragung und entfernt ein unmittelbar zuvor eingetroffenes Receipt derselben Prüfung. Ein verspäteter Abbruch einer alten Prüfung verändert keine neue Prüfung. Die UI behält die ID während der nativen Bestätigung und sendet den Abbruch auch bei Unmount oder einer unerwarteten IPC-Antwort.

Nach Ablauf, Abbruch, Verbindungsersatz oder einem bereits verbrauchten Auftrag ist eine neue einzelne Prüfung nötig. Es gibt keinen automatischen Wiederholungsversuch mit derselben Freigabe. Stop und Logout löschen lokale Freigaben.

## Bedienung

Bei der Client-Anforderung zusätzlich „Einzelne Git-Versionsabfragen mit eigener Bestätigung zusätzlich anfordern“ wählen. Das schließt den Git-Status-Scope ein. Client und aktuelles Gerät werden weiterhin separat bestätigt.

Unter „Projekte für diese Verbindung auswählen (maximal 8)“ das gewünschte Projekt auswählen, „Einzeln bestätigte Terminalprofile für diese Verbindung aktivieren“ einschalten und „Mit Git-Status und Profilfreigaben verbinden“ wählen.

Im Abschnitt „Einzelnes Terminalprofil freigeben“ Projekt und Authenticator auswählen. „Git-Version prüfen und freigeben“ öffnet die konkrete Prüfung. Nach Kontrolle von `git --version` und Projekt wird der Code ausschließlich im Feld „Sechsstelliger Authenticator-Code“ eingegeben und mit „Einmalig mit Code freigeben“ bestätigt. Die anschließend angezeigte Auftrags-ID wird innerhalb der sichtbaren Frist an ChatGPT übergeben.

## Nachweise und Grenze der Offline-Prüfung

Die synthetische Fixture in `src-tauri/tests/fixtures/beta4_terminal_profile_wire.json` stammt aus den produktiven Connector-Codecs. Native Tests vergleichen Argumenthash, rohe Geräte-ACK-Bytes und Signatur, Approval-/Request-JWS, signiertes Ergebnis und Ergebnis-ACK. Sie prüfen geänderte Bindungen, Ablauf, Replay, fehlende lokale Einmalfreigabe, den Abbruch während der Bestätigung und einen echten festen Git-Prozess.

Der schlanke Harness unter `qa/terminal-profile-harness` kompiliert die echten Consent-, Dispatch-, Git- und Signaturmodule. Authentifizierung, Live-Registry und WSS-Grenzen sind dort absichtlich nicht verfügbar. Die vollständige Tauri-/HTTP-/WSS-Komposition, das tatsächliche Frontend und das installierbare Paket werden über den vorhandenen Beta4-Native-Package-Workflow geprüft. Ein physischer MCP-Erfolg ist erst nach Nutzer-MFA, echten Client-/Gerätefreigaben und einem signierten Live-Ergebnis belegt.


## Verifiziertes Candidate5-Paket

Der einmalige native Package-Lauf [44411213526](https://github.com/NMKato/KatoSync/actions/runs/44411213526) auf Quellstand `a806ebc2825a5548928779dbf8c9d5648b4ce88e` bestand mit **505 bestandenen, 0 fehlgeschlagenen und 8 bewusst ignorierten Tests**. Das anschließend signierte, von Apple akzeptierte und gestapelte Candidate5-Paket wurde identisch auf M2/M3 installiert und tatsächlich gestartet. [Paket- und Laufzeitnachweis](KATOSYNC_BETA4_CANDIDATE5_20261118.md) enthält die genaue Artefaktbindung und Digests. Persönliche MFA/Freigaben, App→Worker-Lesestatus und ein signierter Live-Auftrag bleiben getrennte, noch offene Abnahmeschritte.
