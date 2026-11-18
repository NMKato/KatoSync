# KatoSync 3.5c – Geräteidentitäten ≠ physische Rechner

## Abnahmebefund 03.11.2026, 23:24 MEZ

Nutzer meldete auf dem M3 vier angebliche "Meine Geräte", obwohl physisch genau zwei Macs installiert sind. Direkt an beiden autorisierten Macs und aus der gemeinsamen Supabase-Registry bestätigt:

| Gerät | Stage3X QA Schlüssel/Cloud-Pseudonym | Stage35 QA Schlüssel/Cloud-Pseudonym |
|---|---|---|
| M2 Pro (Apple M2 Pro, 16 GiB) | KatoSync macos 6VdXK | KatoSync macos lHjPv |
| M3 (Apple M3, 16 GiB) | KatoSync macos aLn4D | KatoSync macos Pqna2 |

Alle vier sind im selben verifizierten KATOOS-Konto in katosync.mesh_devices und haben den Status **discovered**, nicht **trusted**. Der M3 Stage3X-Prozess lief zur jüngsten Prüfung nicht mehr, sein Cloud-Eintrag blieb trotzdem erhalten. Der M2 Stage3X-Prozess lief parallel zur Stage35-App. Die isolierten Stage3X-/Stage35-Bundle-IDs benutzen bewusst **getrennte lokale Keychain-Services**; die Cryptographic Ed25519-Identitäten sind somit verschieden.

**Keine vier Rechner, keine bewiesene doppelte physische Hardware:** vier registrierte *App*-Identitäten. "Zuletzt gesehen" ist nur letzte Cloud-Meldung, kein Echtzeit-Onlinestatus. Ein anderes angemeldetes Konto wurde nicht gefunden.

## Implementierte Korrektur im lokalen Stage35c-Arbeitszweig (noch nicht installiert)

- Aus dem öffentlichen Ed25519-Fingerprint abgeleitete stabile KAI-Namen (gleicher Algorithmus wie Rust): KAI Nexus Mac-AF99 auf M2, KAI Nika Mac-D048 auf M3. Zufällige Cloud-Kennungen bleiben nur als technische Unterzeile sichtbar. Dies ist ausschließlich Anzeige; Routing und Trust bleiben über kryptografische Schlüssel.\n- UI nennt die Liste "App-Registrierungen", nicht mehr "Meine Geräte"; erläuternder Hinweis zur Parallelinstallation der Testversionen; vier registrierte Identitäten werden nicht als vier physische Rechner ausgegeben.
- Der eigene verifizierte Ed25519-Fingerprint wird als **Diese KatoSync-Instanz** separat angezeigt und aus auswählbaren Peers entfernt.
- Weitere Identitäten werden nach einem bewusst konservativen Kriterium von zwei Stunden in "Kürzlich gemeldet" und unter einem standardmäßig geschlossenen "Ältere Registrierungen" eingeordnet. Die Einteilung beweist weder online, offline noch vertrauenswürdig; der Erkennungsstatus bleibt unverändert. Revoked/ungültig/futuristisch datierte Einträge sind immer "älter".
- Der irreführende Text "Kollege X entdeckt" wird nur noch nach einem wirklich vollendeten sicheren Peer-Zustand verwendet. Bloße Entdeckung heißt "weitere App-Registrierungen – noch kein vertrauter Kollege".
- Im reinen React-UI-Code liegen keine Cloud-Mutationen, Löschaktionen, neuen Peer-Freigaben, automatischen Trusts oder Remote-Schreibrechte. Vier Sprachen aktualisiert. Rückfall auf frühere Liste bei älterem Code ohne Stage35-Bootstrap.

## Noch nicht gelöst: echtes physisches Geräte-Kontingent

Die live gelesene katosync.mesh_owner_policy erlaubt **10 Registrierungen**, die Registry belegt jetzt **4 von 10 Slots**, da bisher jeder Schlüsselfingerprint unabhängig zählt. Das ist als isolierter QA-Test sachlich korrekt, aber die Produktregeln müssen klären, ob maximal 10 physische Hostgeräte oder 10 unabhängige ausführungsfähige Agenteninstanzen lizenziert sind.

**Vor allgemeiner Veröffentlichung erforderlich:**
1. Normaler App-Upgrade-Pfad muss das existente Konto und den eigenen, gespeicherten Ed25519-Key wiederverwenden. Keine Neuregistrierung bei Updates.
2. QA-Testversionen behalten ihre getrennten Schlüssel; optional kontrollierte, vom Kontoinhaber bestätigte Stilllegung alter Stage3X-Einträge erst nach geglückter Stage35-Kopplung und FK-/Rollback-Prüfung.
3. Falls zwei verschiedene App-Identitäten desselben physischen Rechners lizenzrechtlich auf genau einen Slot gebunden werden sollen, benötigt das Backend eine eigene **Workstation-Zuordnung mit Besitzerbestätigung und kryptografischer Bindung**. Ein von Clients frei übermittelter Hostname, MAC-Adresse oder beliebige Geräte-ID ist als Quotenbeweis zu unsicher und datenschutzrechtlich unnötig. Keine gemeinsame Freigabe von Keychain-Private Keys und kein automatischer Trust durch bloß gleiche Hardware.
4. Der lokale App-Text darf *niemals* die physische Geräteanzahl aus der Zahl der Schlüssel-Records ableiten; Workstation-Zahlen nur aus ausdrücklich verifizierter Zuordnung.
5. Erst nach Produktionstests mit zwei Macs, Reinstall/Upgrade, Revocation und Gerätewechsel das 10-Geräte-Produktlimit freigeben.

Die signierten/notarisierten Stage35-Apps von 03.11.2026 sind unverändert; diese Darstellung ist ausschließlich neuer Quellcode und wird erst nach erneuter Developer-ID-Signatur und Apple-Notarisierung ausgeliefert.
