# KatoSync UX4 – Lizenzdialog bei niedrigen WebKit-Fenstern (21.11.2026)

Created by NMKato Solutions. **QA-Fix, nicht als native Produktfreigabe interpretieren.**

## Ausgangsbefund (echter M3-Screenshot)

In der isolierten `KatoSync 4.0 Inspector Autostart QA` war der Web Inspector unten angedockt. Dadurch verblieben ungefähr 390px WebView-Höhe. Die alte Lizenzdialog-Geometrie presste neun Rechtsabschnitte in einen rund **53px** hohen inneren Textbereich; Einleitung und Zustimmungszeile wirkten ineinander verschoben. Screenshot vom Owner am 21.11.2026.

Die UI zeigte die **Lizenz-/Nutzungsvereinbarung v2.0.0 vom 29.06.2026**, deren Wortlaut primär den historischen Mistral Library Uploader behandelt. Die Checkbox ist eine Nutzungsvereinbarung, **keine** automatische Erlaubnis für systemweite macOS-Rechte, Mesh-Pairing, Geräte-/Projektzugriff oder Remote-Commands. Inhaltliche Prüfung siehe [Issue #285](https://github.com/NMKato/KatoSync/issues/285). Ohne Legal/Product-Go keine automatische inhaltliche Änderung oder erneute Zustimmung.

## Isolierte Präsentationskorrektur

- `src/styles.css`: bei `max-height: 620px` wird der **gesamte Dialog** scrollbar, ohne den Lizenztext auf eine 0-53px große Grid-Zeile zu reduzieren; die Checkbox/Buttons bleiben am Ende der Scrollstrecke erhalten. Bei normaler Fensterhöhe bleibt die alte, große Dialogansicht mit eigenem Textscrollbereich bestehen.
- Bei `max-width: 620px`: kompaktere Header-/Button-Abstände und responsive Titelgröße.
- `src/App.tsx`: der scrollbare Lizenztext erhält einen benannten, per Tastatur fokussierbaren Bereich (`role=region`, `tabIndex=0`).
- **Keine Änderung** an Lizenzversion, juristischen Texten, Checkbox-Zustimmung, `disabled={!checked}`, Auth-, Keychain-, Rust-, Netz- oder Owner-/MCP-Berechtigungen.

## Prüfbelege

| Test | Befund |
|---|---|
| Baseline Browser 1380×860 | PASS, Textbereich 491px |
| Baseline Browser 1550×390 | **FAIL**, Textbereich nur 53px, Dialog nicht als Ganzes scrollbar |
| Korrigiert 1380×860 | PASS, 491px Standard-Textbereich |
| Korrigiert 1550×390 | PASS, Dialog-Höhe 366px, äußerer Scrollbereich 1678px, vollständige Lizenzabschnitte erhalten |
| Korrigiert 1040×720 | PASS |
| Korrigiert 390×600 | PASS, äußerer Scrollbereich bis zum Zustimmungsbereich |
| Source-Contract + UX4-Nachtests | **8/8 PASS** |
| Vollständige Node-Regression | **1056/1056 PASS**, 0 failures/skips |
| TypeScript/Vite mit KatoOS-QA-Flag | **Exit 0**, 1933 Module; unveränderte Bundle-Warnung |
| Eigenständiger nativer macOS-Inspector-QA-Build | **Exit 0**, 93MB, lokal Ad-hoc-Codesign strikt PASS |
| **Native geänderte Lizenzansicht** | **BLOCKED**: geänderte UX4-Frontend-JavaScript-Bundles starteten in realem WebKit nicht, `#root` blieb leer. Issue [#284](https://github.com/NMKato/KatoSync/issues/284) |

Der native QA-Build wurde **nicht** als erfolgreiches Endprodukt freigegeben. Der WebKit-Startfehler ist unabhängig vom hier nachgewiesenen CSS-Problem und muss vor einer Developer-ID-Beta behoben werden.

## Weitere Kriterien für die geschlossene Beta

1. Inspektionsmodus schließen oder WebKit-Fenster ausreichend hoch halten; zukünftige Lizenzdarstellung trotzdem bei niedriger Höhe stabil halten.
2. Erst nach Behebung von P0 #284 nativer WebKit-Lizenztest bei kurzer und normaler Fensterhöhe, Tastaturscroll, Light/Dark, DE/EN/ES/RU und ausdrücklicher, nicht vorausgewählter Checkbox.
3. Lizenz v2.0.0 für Agent Sync/Cloud-Provider/SmartMesh auf Relevanz prüfen, aber keine stillschweigenden Genehmigungen oder Rechtsinhalte ändern.
4. Sämtliche bestehenden C11-/KatoOS-Account- und Gerätefreigaben unverändert lassen; kein PR/main merge oder kostenpflichtiger Actions-Lauf durch diesen Fix.

**Status: QA-Quellfix erfolgreich; native Freigabe bis zum WebKit-P0 ausdrücklich NO-GO.**
