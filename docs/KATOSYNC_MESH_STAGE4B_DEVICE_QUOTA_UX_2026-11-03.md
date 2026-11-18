# Stage 4B – Gerätequote in Stage3X diagnostizieren, ohne Freigaben zu verändern

**03.11.2026 · Nur QA-Code · kein produktives Cloud-Deployment**

## Live-Nachweis

- Beide notarisierten Stage3X-Mac-Apps laufen; M3 meldet nach Nutzer-Anmeldung und dem manuell ausgelösten KATOOS-Schema-Preflight **Mitgliedschaft aktiv**.
- Das Produktionsschema `katosync` besitzt acht RLS-geschützte Tabellen; eine aktive Mitgliedschaft, zwei ältere Geräte (beide `discovered`), keine Trusted-Peers.
- Beim Klick auf **Geräte finden** erzeugte das M3 am 03.11. um 12:42:26 UTC eine Enrollment-Challenge (POST /functions/v1/mesh-device-enrollment 200), ohne ein weiteres Gerät zu registrieren. Die anschließende `/complete`-Anfrage lieferte **HTTP 429**. Die Challenge wurde nicht konsumiert und ist abgelaufen.
- Der tatsächlich aus Supabase gelesene deployed Source-Code der Edge-Funktion liefert bei `/complete` **429 DEVICE_QUOTA**, wenn der Schlüssel neu ist und die vorhandene Device-Anzahl die Quote erreicht. Es gibt für dieses Konto keinen Eintrag in `mesh_owner_policy`; die sichere Standardquote ist **2**. Damit ist die Ursache nachgewiesen, keine neue Anmeldung erforderlich.
- Die alten Geräte sind vom 28.10.2026; Stage3X nutzt bewusst isolierte App-Daten/Keychain und damit eine eigenständige Identität. Zwei QA-Instanzen würden neue Geräteplätze benötigen.
- **Nicht verändern:** alte Registrierung und Keychain, Stable/Stage2I, cloudseitige Gerätequote, RLS, Pairing/Trust, Produktions-Edge-Funktion. Insbesondere keine automatische Löschung oder stilles Identitätskopieren.

## Implementierung

- Client prüft bei non-2xx/429 den maximal 256 Byte großen Edge-Fehlerkörper und akzeptiert ausschließlich `DEVICE_QUOTA` bzw. `RATE_LIMIT`. Andere Antworten bleiben generisch; keine Tokens/Server-Payloads an das WebView.
- KatoSync zeigt im Geräteassistenten für `MESH_DISCOVERY_DEVICE_QUOTA` eine klare, lokalisierte Meldung in DE/EN/ES/RU. Die Nachricht sagt ausdrücklich: keine Kopplung. Über Loginwechsel, Refresh und erneute Anfrage wird veralteter Fehlerstatus gelöscht.
- Keine automatischen Retries, keine Quote-Erhöhung, keine Pairing-Freigabe. Die neue Fehlermeldung ist im aktuell installierten, signierten Stage3X noch **nicht** enthalten und erfordert einen neuen freigegebenen Build/Notarization-Zyklus.

## Sichere Entsperr-Optionen (separate ausdrückliche Freigabe)

1. **Kontrollierter Gerätewechsel:** zuerst bestätigen, welche der zwei alten Geräte noch benötigt werden, bei Bedarf gezielt widerrufen/entfernen, dann beide Stage3X-Geräte erneut registrieren. Kein blindes Löschen, weil Stage2I als Rollback erhalten bleiben soll.
2. **Temporäre zusätzliche QA-Plätze:** die `mesh_owner_policy` serverseitig und auditiert für diese Mitgliedschaft auf höchstens zehn Geräte setzen, später nach Test kontrolliert zurückführen. Das ist eine produktive Berechtigungs-/Quotenänderung und erfolgt nicht in diesem Draft.

Die neue Meldung behebt **nicht** die Quote selbst. Erst nach einer der beiden autorisierten Maßnahmen folgen echte M2/M3-Registrierung, gegenseitige SAS-Freigabe und Remote-Job-E2E.
