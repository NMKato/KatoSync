# KatoSync Mesh QA – Sitzungs-Wiederherstellung (28.10.2026)

## Hardware-Befund M2
- Nach Austausch des ad-hoc-signierten QA-Bundles com.nmkato.katosync.meshqa wird beim Verbinden die KATOOS-Sitzung zurückgewiesen.
- QA-App läuft, Signatur formal gültig, TLS-Host erreichbar. Metadaten weisen KATOOS-, GitHub- und Mesh-Geräteschlüssel-Einträge nach. Keine geheimen Inhalte gelesen.
- Nach dem Update ist die manuelle Wiederanmeldung nötig. Ohne Passwort bleibt der Button Sitzung erneuern deaktiviert.
- Die abgelehnte KATOOS-Sitzung beweist nicht, dass GitHub-Autorisierung gelöscht wurde.

## UX-Fix
- Bei Account-/Session-/Refresh-Fehler wird in der kompakten Mesh-Leiste ein direkter Button Sitzung erneuern eingeblendet.
- Er öffnet Details und die QA-Anmeldung, keine neue Registrierung.
- Nur sichtbar in VITE_KATOOS_AUTH_QA=1 Builds.
- Keine automatisierte Passwort-Eingabe, kein Token-Export, kein Pairing, kein Disconnect, kein Keychain-Reset.
- Übersetzungen DE/EN/ES/RU.

## Tests und Release-Gates
- 280/280 Frontend-Tests bestanden; TypeScript grün; diff --check grün.
- Nur Code und QA UX. Noch kein neuer App-Austausch, um die Keychain-ACL nicht erneut zu stören.
- Dauerhafte Lösung braucht stabile macOS-Code-Signing-Identität und kontrollierte Keychain-ACL bei App-Updates. Danach M2/M3 Neustart- und wiederholte Einladungstests ohne erneuten Login.
- Kein behauptetes Peer-Pairing oder funktionierender Discovery-/Inbox-Dienst ohne echte Nachweise.
