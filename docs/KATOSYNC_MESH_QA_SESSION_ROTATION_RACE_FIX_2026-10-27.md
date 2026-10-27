# KatoSync Mesh QA – rotierende KATOOS-Sitzung stabilisieren (27.10.2026)

## Reproduzierter Hardware-Befund
- M2 und M3 sind online; die isolierten Mesh-QA-Versionen haben denselben Build-Hash.
- Beide Konten wurden direkt in QA erneuert. Danach zeigte die Oberfläche „Online verifiziert“.
- M2 erstellte eine signierte Einladung, M3 wies beim nächsten „Verbindung starten“ die Sitzung erneut zurück.
- Die vorherige QA-Erfolgsmeldung blieb fälschlicherweise sichtbar.
- „Meine Geräte“ bleibt ohne die noch nicht produktiv freigegebene Registry-Migration PR #155 ein gesperrter Discovery-Dienst.

## Codefehler und Korrektur
1. ensure_supabase_access_token tauschte Single-Use-Refresh-Tokens ohne Serialisierung paralleler Anfragen. Alle Refresh- und QA-Reauth-Vorgänge verwenden jetzt denselben asynchronen Mutex.
2. Paralleler 401-Recovery prüft nach Lock, ob bereits ein frisches Token vorhanden ist. Kein alter Request darf die neue Sitzung überschreiben.
3. Fehler bei save_supabase_refresh_token wurden teilweise verschluckt. Cache-Aktivierung erfolgt jetzt erst NACH erfolgreichem Keychain-Speichern.
4. Ein stiller Wechsel eines bereits geprüften Issuer-Benutzerkontos wird verweigert.
5. Der native Login greift auch auf den gemeinsamen Lock zu. Ein Login-Fehler löscht keine GitHub-Verbindung. QA-Kontowechsel werden gesperrt.
6. Vision meldet den Reauth-Erfolg erst nach erfolgreicher neuer Ed25519-Geräteprüfung. Nach einem späteren Sitzungsfehler wird die veraltete Erfolgsmeldung gelöscht und die sichere Diagnose sofort sichtbar.

## Qualität und Grenzen
- 273 Frontend-Tests bestanden, 196 native Rust-Tests bestanden (7 vorhandene ignoriert), TypeScript und Vite Production grün.
- Keine Passwörter, Refresh-Tokens oder privaten Geräteschlüssel gelesen, gespeichert oder exportiert.
- Kein Datenbank-Rollout, kein mTLS, keine Remote-Task-Ausführung und keine automatische Gerätefreigabe.
- Ein serverseitig widerrufener Refresh-Grant lässt sich nicht automatisch reparieren; in diesem Fall ist eine erneute Anmeldung direkt in QA erforderlich. Unabhängig prüfen, ob die KATOOS Supabase-Projekteinstellung „Single session per user“ aktiviert ist.
- Installation nur in signierte, isolierte QA-Bundles mit Rollback. Reguläre KatoSync-App und main bleiben unverändert.
