# KatoSync Mesh – Stufe 1B: gegenseitiger Schlüsselnachweis (26.10.2026)

## Implementiert
Die Stage-1A-Einladung (Ed25519, 5 Minuten, KatoSync-Issuer/UUID-Scope, Schlüssel im OS-Keychain) wird durch einen manuell ausgetauschten dreiteiligen Ablauf erweitert:
1. **M2 (A):** Eine neue signierte Einladung erstellen. Pro Benutzer und Gerät wird nur ein aktuell ausgestellter Angebots-Hash plus Ablaufzeit im lokalen Schlüsselbund vorgemerkt.
2. **M3 (B):** A-Einladung prüfen; B erstellt signierte Herausforderung mit neuer Nonce, Hash von A-Einladung, eigenen Schlüsseldaten und Ablauf. B speichert den Challenge-Hash einmalig im Schlüsselbund.
3. **M2 (A):** Herausforderung auf eigene, noch offene A-Einladung, Signatur, Ablauf und Kontobindung prüfen. Mit eigenem A-Key antworten und die A-Einladung im Schlüsselbund einmalig verbrauchen. A zeigt einen 12-stelligen hexadezimalen Sicherheitscode aus dem Transkript.
4. **M3 (B):** Antwort auf eigene noch offene B-Challenge und Signatur von A prüfen, B-Challenge einmalig verbrauchen und denselben Sicherheitscode anzeigen.

## Sicherheitsgrenzen
- Ein Schlüsselnachweis ist noch KEINE Kopplung oder Vertrauensentscheidung. Die Antwort bleibt explizit paired=false, peerCount=0 und transportReady=false. Kein Remote-Dispatch, kein Listener, kein LAN-Transport und keine Writer-Freigabe.
- Pending-State pro issuer-verifiziertem User im lokalen Schlüsselbund; höchstens fünf Minuten, während jeder Aktion nochmalige Nutzerverifikation, erneute Verwendung nach Verbrauch fail-closed. Keine private Geräteadresse, Tokens oder Schlüsselübertragung.
- Eine echte, manuell bestätigte Fingerprint-/SAS-Prüfung auf beiden Maschinen, widerrufbare Peer-Freigabe und verschlüsselter Transport fehlen noch. Kein automatisches Pairing bei gleichem Code.
- Teststatus und Release-Gates sind getrennt: M3-Installer und echtes Zwei-Mac-E2E-Pairing erst nach sicherer QA. Öffentliche Repo-Dateien enthalten keine realen Einladungen, Benutzer- oder Netzadressen.

## Nächste kontrollierte Schritte
1. Getrennte M3-QA-Installation ohne bestehende Arbeitsstände oder Konten zu überschreiben.
2. Gegenwärtige KatoSync-Anmeldung auf beiden Macs und echter Copy/Paste-Drei-Nachrichten-Test mit übereinstimmendem Sicherheitscode.
3. Beidseitige, ausdrückliche Vertrauensbestätigung mit Widerruf plus gegenseitig authentisierter verschlüsselter LAN-Kanal; erst dann eine einzelne Read-only-Jobübergabe. Cross-device Schreibfreigaben verbleiben hinter #76.
4. Nutzerabnahme, native macOS-/Windows-Buildprüfung, PR-Draft, kein Main-Merge vor grünen Gates.

Öffentliches Repo: ausschließlich Quellcode, synthetische Tests und öffentliche Statusinformationen, keine persönlichen oder geheimen Pairing-Materialien.


## Verifizierter Zwischenstand nach M2-Beta-Build
- 240/240 Frontend-Tests und 178/178 Rust-Library-Tests bestanden (7 absichtlich ignoriert); TypeScript, Vite und nativer macOS-Release-Build grün.
- Separater KatoSync-QA-Build auf dem Mac M2 ad-hoc signiert aktualisiert und gestartet. Zuvor aktive Sprach-/Inferenzaufträge ausgeschlossen; Vorgängerversion als Backup, reguläre KatoSync-Installation unverändert, lokales Gemma Vision weiterhin aktiv.
- Testmöglichkeit unter Vision → Mesh-Bereitschaft → gegenseitiger Schlüsselnachweis. Die aktuelle UI nutzt bewusst ein aufklappbares Expertenfeld, keine automatische Peer-Registrierung.
- Zweiter physischer Knoten M3: Installation und authentifizierte App-Sitzung **noch nicht verifiziert**, direkter App-Pakettransfer nicht abgeschlossen. Wegen der vorhandenen Ressourcen keine umfangreiche native Release-Kompilierung auf dem M3 gestartet. Keine vorhandenen M3-Repositories verändert, kein dauerhafter SSH-Zugang geöffnet. Ein kurzlebiger, auf Dateiübertragung beschränkter temporärer Dienst auf M2 wurde vollständig beendet.
- Eine echte M2↔M3-Sitzung mit übereinstimmenden SAS-Codes sowie Tests nach Neustart/Logout sind **NICHT** nachgewiesen. Erst danach dürfen weitere Freigabe- oder Transportarbeiten beginnen.
