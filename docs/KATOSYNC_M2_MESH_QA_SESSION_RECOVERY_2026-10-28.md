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

## Physischer Freigabenachweis 28.10.2026
- Beide Geräte enthalten eine gültige Developer-ID Application Code-Signing-Identität derselben MK Heartbeat UG, Team T8SB89JPX7.
- Der bisher ad-hoc-signierte M2-Mesh-QA-Build wurde **ausschließlich im isolierten QA-Bundle** durch denselben Code-Stand commit 3adda572a5348ee54d00222aebf6b273ec9982e4, jetzt mit langlebiger Developer-ID-Identität ersetzt.
- macOS codesign --verify --deep --strict erfolgreich; Designated Requirement erfüllt, TeamIdentifier T8SB89JPX7. Nicht notarisiert/kein öffentliches Release, nur lokale QA.
- Vorherige QA-Version als vollständiges ZIP und als rückrollbares Bundle in KatoSync-QA-Archive-20261027 erhalten. Keine Keychain-, GitHub-, User- oder Projekteinträge gelöscht.
- **M2 Live-Test 1:** Nach Installation wurde über Vision > Verbinden eine signierte 5-Minuten-Einladung vorbereitet. Kein KATOOS-Sitzungsfehler.
- **M2 Live-Test 2:** QA-App vollständig beendet und neu gestartet; erneute signierte Einladung wurde erfolgreich vorbereitet. **Kein erneutes Passwort erforderlich**, kein Session-Revoke.
- **M2 GitHub-Test:** Provider-UI zeigt GitHub App und Verbundenes GitHub-Konto. Vorherige Zugänge vorhanden. Repo-Inventar wurde dabei nicht als funktionsfähig behauptet.
- **M3:** Candidate derselben Codebasis mit gleicher Developer-ID erfolgreich gebaut und verifiziert, aber installierte funktionierende QA-Version bewusst nicht ersetzt. Bisher keine M2-M3-Mesh-Kopplung.
- Ursache für frühere wiederholte Probleme: Ad-hoc-signierte Builds mit wechselnder Codeidentität sind mit dauerhaftem Keychain-Vertrauen nicht zuverlässig vereinbar. Dieser Hardwaretest unterstützt den Fix durch stabile Signatur; langfristige Update-QA und ggf. Notarisierung bleiben offen.
