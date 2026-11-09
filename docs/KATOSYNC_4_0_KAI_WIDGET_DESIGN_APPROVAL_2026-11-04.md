# KatoSync 4.0 — freigegebenes Kato AI Widget-Design

**Freigabe:** 04.11.2026 · Entwurf: Kato AI / KatoSync · Umsetzungsslice: `feat/katosync-v40-kai-widget-brand-20261104`.

## Verbindliche Gestaltung

- Das originale **KAI-/Kato-AI-Symbol** ist die einzige Produktmarke im Widget-Kopf, bei `Ask Anything` und in der Schnellwahl. Der vorhandene hochauflösende, im Projekt gepflegte transparente Asset `public/kai-ai-icon.png` wird wiederverwendet; **kein OpenAI-/ChatGPT-Logo** in einer Kato-AI-eigenen Handlung.
- Dunkles, ruhiges, hochwertiges Glasdesign mit zurückhaltenden orange-goldenen Emblem-Glows, klarer Hierarchie und feiner Typografie. Keine überladene Neonoptik, keine generische AI-Bot-Grafik als Markenlogo.
- Standardmodus ist **kompakt** (396 × 330 logische px), bei Bedarf erweiterte Ansicht (520 × 580 logische px) mit vier Schnellaktionen. Frei verschiebbar; Widget-Position wird weiterhin lokal gespeichert.
- Aktueller Job, tatsächliche Warteschlange, Aufmerksamkeitsbedarf, lokales Modell und stale/online-Status stammen aus der vorhandenen, eingeschränkten Native-Statusprojektion. **Keine erfundenen Fortschrittsbalken, Zeitschätzungen, Aufgaben oder Modellversionen** nur um den Mock-up zu imitieren.
- `Ask Anything` mit KAI-Symbol ist derzeit eine **sichtbare, echte Schaltfläche zum vorhandenen KatoSync-Chat**. Keine unechte Eingabe, kein automatisch gestarteter Agentenauftrag und keine direkte Remote-Ausführung.
- Inaktive, abgemeldete oder veraltete Instanzen werden ausdrücklich als nicht bestätigt dargestellt; keine falsche Aussage, dass Gemma oder der Peer online sei. Vertrauliche Auftragsnamen bleiben bis zur expliziten lokalen Anforderung verdeckt.
- Tastaturfokus, reduzierter Bewegungseffekt und ein Modus mit höherem Kontrast sind vorgesehen. Freie Position, Quick-Menü und Fenster-Rückkehr bleiben von den bisherigen Sicherheitsgrenzen begrenzt.

## Technische QA

- Eigenständige `widget.html`-Vite-Seite und KAI-Logo aus `public/kai-ai-icon.png` im Production-Build nachgewiesen.
- 6 neue UI-/Brand-/Navigation-/Native-Command-Vertragstests plus 7 bestehende Widget-Tests: 13/13 erfolgreich.
- Vollständige Node-Regression dieses Branches: **666/666 Tests**, TypeScript/Vite-Build erfolgreich (1.907 Module). Native gezielte Rust-Widget-Tests: 3/3 bestanden.
- Ein realer Headless-Browser-Render des kompakten Dark/Orange-Widgets wurde visuell geprüft; die Abbildung basiert auf dem tatsächlichen CSS und der echten Kato-AI-Assetdatei.
- Noch **keine** produktive Freigabe: natives Fenstermanagement, echtes Live-Verhalten bei minimiertem Hauptfenster, verschiedene Displays, Barrierefreiheit und der erneut signierte/notarisierte M2/M3-Installer müssen separat auf echten Macs geprüft werden.

Tracking: Epic #224 und Setup-/Widget-Releasegate #226; Basis-Draft-PR #227. Kein Eingriff in produktive QA-Bundles, Keychains, Cloud-Registrierungen oder den parallelen Stage35e-Worktree.
