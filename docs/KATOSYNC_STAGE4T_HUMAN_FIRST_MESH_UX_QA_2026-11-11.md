# KatoSync Mesh — Stage4T Human-First QA

Created by NMKato Solutions
11 November 2026 • isolated stacked QA source
Base: Stage4S source 0d59f79bae1d8bd48a1a9b52690209904c8db93b

## Nutzerbeobachtung und Produktziel

Beim realen Test M2 ↔ M3 konnte der Besitzer die signierten Einladungen senden und annehmen. Trotzdem war die bisherige Oberfläche überladen: gleichgewichtige Diagnose-/Gerätekarten, undifferenzierte Aktionsflächen, generische Sendernamen, irreführende Anzeige "Frühere App" bei aktiver Anfrage. Auch ein technikaffiner Nutzer konnte nicht erkennen, was als Nächstes zu tun ist.

**Ziel:** Drei unmittelbar verständliche Schritte:
1. **Gerät auswählen** (einmalige explizite Einladung; keine automatische Einladung).
2. **Anfrage annehmen** (großer, klar erkennbarer Button am anderen Gerät; Ablehnen getrennt).
3. **Code vergleichen** (nur wenn Rust den signierten Besitznachweis vollständig validiert hat; zwei separate bewusste Freigaben).

Alle technischen Details bleiben unter dem expliziten QA-Diagnosebereich. Die UI darf eine akzeptierte Einladung, einen Keychain-Pin und einen verifizierten Peer-Tunnel niemals als denselben Zustand darstellen.

## Stage4T implementiert (Source-Only)

- Drei-Schritte-Indikator und farblich getrennte Karten für Geräteliste, Verbindungsstatus und neue Anfragen; responsive, Tastatur-Fokus sichtbar, Reduced Motion respektiert.
- "Annehmen" klar grün hervorgehoben, "Ablehnen" separat; die native, signierte Benutzerentscheidung bleibt unverändert.
- Verifizierte Senderidentität wird über Geräte-ID **und** Fingerprint zugeordnet und als KAI-Agent angezeigt; keine Vertrauensbehauptung durch Anzeigename.
- Kein "Frühere App" für die aktive Anfrage: "Anfrage läuft", bei nicht auswählbaren aktuellen Einträgen "Bitte warten", historische Einträge "Nicht aktuell".
- Kein verwirrender "leerer Posteingang"-Text unmittelbar nach einer erfolgreichen Annahme.
- Gleichzeitige neue Einladung ist im UI blockiert, solange bereits eine eingehende Einladung zur Entscheidung sichtbar ist; kein vollständiger Ersatz für serverseitige Kollisionskontrolle.
- Vier Sprachen DE/EN/RU/ES. Keine neuen Backend-Endpunkte, RLS-Regeln, Keychain-Operationen oder Produktionsflags.
- HTML-Buttons zeigen keine irreführende Umschalt-Rolle \`aria-pressed\` mehr. Zustand wird rein visuell über \`data-selected\` angezeigt.

## Tatsächliches Mesh-Gate weiterhin OFFEN

Die realen beiden Einladungen wurden am 11. November 2026 als akzeptiert nachgewiesen, jedoch zeigte M3 eine fehlgeschlagene Vorbereitung und beide angenommenen Requests hatten **0** signierte Relay-Challenge-/Response-Nachrichten. Der Live-Peer-Tunnel und Remote-Aufträge sind nicht nachgewiesen. Diese UI-Änderung behebt den Backend-/Native-Signaturpfad nicht automatisch.

Sicherer Fortsetzungspfad: Exakte Native-Fehlercodes der Challenge-Initialisierung in einer getrennten isolierten QA diagnostizieren; Zustand und Request-IDs korrelieren; unabhängige Einladungen kreuzweise/parallel fail-closed testen; danach erst ein neues signiertes Stage4T-Binary erstellen, notarisieren und auf M2/M3 mit bewusst bestätigter SAS-Abnahme testen.

## QA-Nachweise

- 8/8 neue Stage4T UX-/Sicherheitsverträge bestanden.
- 28/28 bestehende Stage4S-Verträge bestanden. Ein veralteter Stage3E-Quellvertrag wurde von \`aria-pressed\` auf semantisch korrektes \`data-selected\` aktualisiert.
- TypeScript + Vite-Build (1.912 transformierte Module) erfolgreich.
- Vier Sprachdateien syntaktisch valide; keine unerwarteten Dateien committet.
- QA-Design **nur Quellstand**, noch keine Stage4T-App signiert, notarisiert oder gestartet.
- Stage4S bleibt auf beiden Macs im Einsatz. Kein Merge nach main, kein Production-Deployment, keine produktive Freigabe.

## Abnahmekriterien für GUI-Praxis

- Übersichtlichkeit bei 1440px, 1024px, 760px und 375px; keine Überlappung/Horizontal-Scroll.
- Volle Tastaturnutzung und deutlicher Fokus; klare Kontraste im hellen/dunklen Design.
- Einladung senderseitig nur auf expliziten Klick, empfangsseitig nur bewusst Annehmen/Ablehnen.
- Parallel- und Doppelanfragen fail-closed; eindeutige, nicht-technische Fehlertexte.
- Code-Anzeige erst nach zwei signierten, request-gebundenen Nachrichten; Klick auf SAS-Freigabe nie simulieren.
- Nach erster Nutzerfreigabe ist **nicht** automatisch "verbunden"; mTLS und Remote-Read-Only müssen separat nachgewiesen werden.

**Freigabestatus:** QA Source only. Do not merge/deploy.
