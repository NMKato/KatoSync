# Stage4R – M2/M3 Einladungsannahme und Sicherheitscode: geprüfte Integration

Stand: 11. November 2026, Berlin, Quellstand Stage4Q
eb6dd9ab4e78840d78535de91c8f432d1e180cf2.

## Prüfgegenstand
Nur *eigens* signierte, besitzerautorisierte QA-Apps auf M2 und M3.
Kein produktiver Kundenzugang, keine DB-Migration, kein Merge/Deploy,
keine automatische Peer-Freigabe, kein Fernbefehl.

## Vorbereitende reale Befunde
- Beide physischen Macs laufen mit einer bestehenden signierten Stage4P-GUI
  und einem lokalen Auftrags-Daemon. Ein Remote-Mesh-TCP-Listener wurde
  nicht gefunden; Remote-Transport wird nicht als aktiv behauptet.
- KatoSync-Registry: sechs kryptografische App-Identitaeten, davon zwei
  juengst gemeldet und vier Altidentitaeten. Eine App-ID darf nicht als
  eigenstaendiger physischer Computer missverstanden werden.
- Supabase-Schema katosync: RLS aktiv; eine serververwaltete, nicht
  abgelaufene Geräte-Policy mit erlaubten zehn Geräten gefunden.
- Die drei isolierten Edge-Funktionen
  mesh-inbox-send-qa, mesh-inbox-receive-qa, mesh-pairing-relay-qa
  sind deployed, verify_jwt=true, Version 4. Das beweist nicht, dass
  die nachgelagerten QA-Secrets aktiv sind. Die Serverwrapper pruefen
  insbesondere KATOSYNC_MESH_QA_PAIRING_ENABLED, Eigentümer-ID,
  frisches Entitlement und Signaturen.
- Stage4Q korrigierte die drei Native-Routen auf die exakten QA-Slugs.
  Die produktiven, nicht suffigierten Funktionen werden nicht aufgerufen.

## Native Integration
- Ein *isolierter* Stage4R-Tauri-Build fuer die beiden physischen Macs
  kompiliert mit den voneinander getrennten, expliziten QA-Flags:
  KATOSYNC_MESH_INBOX_SEND_QA=1
  KATOSYNC_MESH_INBOX_RECEIVE_QA=1
  KATOSYNC_MESH_PAIRING_RELAY_QA=1
  VITE_KATOOS_AUTH_QA=1
  VITE_MESH_INBOX_SEND_QA=1
  VITE_MESH_INBOX_RECEIVE_QA=1
  VITE_MESH_RELAY_QA=1
- Buildgrundlage: dieselbe Stage4J-Isolationskennung; schwarzes
  Owner-Master-Icon; existierende gepruefte Runtime-Assets.
  Es duerfen niemals zwei gleichzeitige GUI-Instanzen mit derselben
  Bundle-ID laufen. Stage4P bleibt als archiviertes Rueckfallpaket.
- Es darf erst ein signierter, notariserter, stapled, per Gatekeeper
  akzeptierter Kandidat auf beiden Macs gestartet werden.
- Quellschutz: scripts/qa-stage4r-owner-gates.sh.
- Der Native-Singleton-Fix aus Stage4P ist in einer *neu kompilierten*
  Stage4R-Binary erstmals enthalten, muss nach Installation gegen
  Startreihenfolge und Boot-Verhalten getestet werden.

## Tatsächlicher Besitzer-Test (nur nach Freigabe aller vorherigen Gates)
1. M2 und M3 mit demselben verifizierten KatoOS-Konto anmelden.
2. Auf jedem Gerät 'Geräte finden' und Fingerprint-Endungen vergleichen.
3. Auf M2 den aktuellen M3-Eintrag wählen; 'Verbindung anfragen (QA)'.
4. Auf M3 'Posteingang prüfen' -> Anfrage prüfen -> Annehmen.
5. Signierte Challenge/Response auf beiden Seiten über QA-Relay ausführen.
6. Sicherheitscode **auf beiden Geräten** vergleichen und ausdruecklich
   denselben Nachweis lokal bestaetigen. Einseitige Entscheidung nie als
   gegenseitiges Trust oder Verbindung anzeigen.
7. Erst nach echtem TLS-Transport, beidseitiger Schluesselbindung,
   erfolgreichem Remote-Read-Only-Job und signiertem Ergebnis 'Verbunden'
   anzeigen. Diese Schritte sind **nicht** durch Einladungsannahme erfuellt.
8. Revoke, Replay, Offline, altes Device-ID und Neustart pruefen.

## Stop-Kriterien
- Server liefert NOT_CONFIGURED, MESH_PRO_REQUIRED,
  ENTITLEMENT_UNAVAILABLE, LOGIN_REQUIRED oder fremde Eigentümer-ID.
- Alte Identity statt M2/M3, abweichender SAS, nicht signierte
  Antwort, falsche Session, fehlendes RLS, unerwarteter DB-Write.
- Native QA-Flags fehlen; GUI-only statt echter Hardware-Kopplung.
- App-Gatekeeper nicht accepted; Binary- oder Archivinhalts-Hash
  weicht zwischen M2 und M3 ab.
- Keine automatische Annahme nur aufgrund desselben KatoOS-Kontos.

Created by NMKato Solutions
