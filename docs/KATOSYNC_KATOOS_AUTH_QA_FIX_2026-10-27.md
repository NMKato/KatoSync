# KatoSync – KATOOS-Konten in isolierter Mesh-QA (27.10.2026)

## Diagnose
Die bisherige KatoSync-Beta meldete beim Login mit bestehenden KATOOS-Zugangsdaten HTTP 400. Der Code zeigte eine andere Supabase Auth Instanz als KATOOS/KSP. Damit ist der Fehler kein Beleg für ein falsches Passwort. Der KATOOS-Auth-Bestand bestätigt das Testkonto mit bestätigter E-Mail und aktivierter Passwortauthentifizierung. Es wurden keine Passwörter oder Sessions gelesen.

## Implementierung
- Cargo-Feature katoos-auth-qa ist nur zusammen mit github-login-qa möglich und schaltet ausschließlich die isolierte QA-App auf den kanonischen KATOOS-Auth-Issuer mit öffentlichem Supabase Publishable Key.
- Normale KatoSync-Builds bleiben mit ihrem bisherigen Auth-Issuer unverändert. Keine automatische E-Mail-Verknüpfung, keine Migration, kein Shadow-User, keine Übernahme alter Tokens.
- Eigener QA-Keychain-Service und QA-AppSupport-Ordner KatoSync KATOOS Auth QA, ohne bestehende native oder QA-Sitzungen zu überschreiben. Der Geräte-Fingerprint bleibt issuer-gebunden.
- Backend sperrt im KATOOS-QA-Modus Signup, Password-Recovery, Cloud-Profil-Änderungen und Connector-Token-Ausgabe. Die UI bietet nur den bestehenden Konto-Login an. QA-Sync und LaunchAgent bleiben deaktiviert.
- KATOOS Family-Badge in der Sidebar erscheint ausschließlich nach Online-Prüfung des aktuellen KATOOS-Auth-JWT beim kanonischen Issuer. Das Badge ist rein visuell und bewirkt KEINE weiteren Fähigkeiten oder Rechte. Diese erfordern später serverseitige Subscription-/Tenant-Entitlements und aktive Sitzungsprüfung.
- Die GitHub-App-Verbindung ist weiterhin unabhängig und freiwillig.

## Nicht erreicht
Eine authentifizierte Anmeldung wurde ohne Nutzerpasswort nicht getestet; die tatsächliche End-to-End-Abnahme erfolgt durch den Eigentümer auf beiden QA-Macs. Die Verteilung wird nur mit geprüftem isoliertem signiertem Build durchgeführt; keine regelmäßige KatoSync-App wird aktualisiert. Der globale produktive Auth-Cutover bleibt bis zur geklärten Legacy-Migration gesperrt.
