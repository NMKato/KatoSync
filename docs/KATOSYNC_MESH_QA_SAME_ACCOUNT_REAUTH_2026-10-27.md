# KatoSync Mesh QA – kontoerhaltende Wiederanmeldung (27.10.2026)

## Beobachtung
- M2 und M3 haben identische signierte Mesh-QA-Apps.
- M2: KATOOS hat die aktuelle Sitzung zurückgewiesen. Anmeldung erneuern.
- M3: signierte Einladung vorbereitet, aber kein Mesh-Peer freigegeben.
- Die Geräte-Registry aus Draft PR #155 wurde noch nicht produktiv migriert. Die Geräteabfrage muss bis dahin geschlossen bleiben.

## Fix
- Die isolierte KATOOS-QA zeigt einen optionalen Abschnitt zur sicheren Wiederanmeldung.
- Kontoinhaber gibt vorhandene E-Mail und Passwort ausschließlich im lokalen KatoSync-Fenster ein, nicht im Chat oder einem Terminal.
- Native Funktion renew_katoos_qa_session ist QA-only: Bestands-E-Mail muss übereinstimmen; nach Passwortlogin verlangt sie eine frische issuer-seitige /auth/v1/user Antwort samt UUID und E-Mail. Bereits zwischengespeicherte User-ID muss übereinstimmen.
- Erst nach erfolgreichem Identitätsnachweis schreibt sie den Refresh-Token in den isolierten QA-Schlüsselbund und hält einen Access-Token im Speicher.
- Keine GitHub-Abmeldung, kein Löschen von Schlüsseln, keine neue Peer-Freigabe. Fehlversuche ändern den gespeicherten Zugang nicht.
- Nach Erfolg wird die lokale Ed25519-Identität geprüft. Es wird weder automatisch gekoppelt noch Fernzugriff erteilt.

## Freigabe
- Frontend-, Rust- und TypeScript-Tests sowie Build erforderlich.
- Produktive Cloud/DB unverändert. Echter interaktiver KATOOS-Login ist noch vom Kontoinhaber direkt in der Anwendung zu testen.
- Entdeckung, Registry-Schreibdienst, Konto-gebundene Geräteaufnahme und mTLS sind weiterhin Folgearbeiten aus Issue #152.
- Dieser Patch bleibt Draft über PR #155, ohne Merge nach main.
