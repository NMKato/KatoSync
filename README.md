<!-- Created by NMKato on 2026-07-01 -->

<div align="center">

<img src="docs/images/logo.png" width="120" alt="KatoSync Logo" />

# KatoSync

**KI, die liefert statt nur redet.**
Dein Projekt-Wissen → ausgeführte Arbeit. Lokal &amp; sicher.

![Release](https://img.shields.io/badge/release-v2.0.0--beta.27-FF6B35)
![macOS](https://img.shields.io/badge/macOS-signiert%20%2B%20notarisiert-000000?logo=apple&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri_2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)

**[⬇️ Download (macOS) → Releases](https://github.com/NMKato/KatoSync/releases/latest)**

</div>

<p align="center">
  <img src="docs/images/dashboard.png" width="840" alt="KatoSync Dashboard-Cockpit" />
</p>

---

## 🚀 Was ist KatoSync?

**KatoSync verwandelt dein Projekt-Wissen in ausgeführte Arbeit.** Die KI (Mistral) versteht deine
Projekte und plant konkrete Aufgaben — **du gibst frei** — und ein **lokaler Runner (Codex oder
Claude)** setzt sie in deinem echten Repo um: eigener Branch, Commit, Pull Request.

> Kein Chat, der nur redet. Kein Auto-Agent, der unkontrolliert loslegt.
> Sondern KI-Ergebnisse, die **du kontrollierst — lokal und sicher.**

---

## ❌ Das Problem

- **KI redet, liefert aber nicht** — Vorschläge statt fertiger, eingecheckter Arbeit → Copy-Paste-Chaos.
- **Projekt-Wissen ist verstreut** — Status, Notizen, Roadmaps, Code überall; die KI hat nie den vollen Kontext.
- **Auto-Agenten sind ein Blindflug** — Ausführen/Mergen ohne Freigabe = Risiko für Code, Secrets und Kosten.

---

## ✅ Die Lösung — der Coding-Workflow

KatoSync ist der **kontrollierte Brückenkopf** zwischen KI-Verständnis und lokaler Ausführung:

- [x] **Scannen** — deine Projektordner werden als saubere Wissensbasis bereitgestellt _(Secrets ausgeschlossen)_
- [x] **Planen** — Mistral-Agenten erzeugen projektbezogene Aufgaben → ein aufgeräumtes **Aufgaben-Board** (Vorschau, nach Projekt gruppiert)
- [x] **Freigeben** — du prüfst, gibst Pläne frei oder entfernst sie _(Human-in-the-Loop — nichts läuft automatisch)_
- [x] **Ausführen** — lokaler Runner (**Codex CLI** oder **Claude Code CLI**) arbeitet auf einem **eigenen Branch von main**
- [x] **Liefern** — Auto-Commit → Push → **Pull Request** _(opt-in)_. **Kein Auto-Merge in main.**
- [x] **Abschließen** — Task ist „ausgeführt" → du prüfst/merged → „erledigt"; ein **Live-Feed** zeigt **jeden echten Schritt** (Befehl · Datei · Websuche · Denken) mit Icon
- [x] **Fortsetzen** — nach dem Lauf eine **interaktive Terminal-Session** öffnen: volle History + **deine eigenen Connectoren** (Gmail, Blender …), Human-in-the-Loop — z. B. eine E-Mail direkt über den Connector senden

<p align="center">
  <img src="docs/images/briefings.png" width="840" alt="Briefings – Mistral-Ergebnisse kommen als lesbare Briefings zurück" /><br/>
  <sub>📨 <b>Die KI-Ergebnisse kommen zurück</b> — als lesbare, priorisierte Briefings (Executive Summary, Status-Ampeln, To-dos). Annehmen · an den Runner übergeben · ablehnen.</sub>
</p>

<p align="center">
  <img src="docs/images/codex-bridge.png" width="840" alt="Codex Bridge – Runner (Codex/Claude) &amp; Modus (Datei/Coding)" /><br/>
  <sub>⚙️ <b>… und werden lokal ausgeführt</b> — Runner-Picker (Codex/Claude) &amp; Modus (Datei/Coding), eigener Branch, kein Auto-Merge.</sub>
</p>

---

## 🎯 Nutzen

- [x] Von der **Idee zum Pull Request** — ohne Copy-Paste
- [x] **Volle Kontrolle** — jede Ausführung ist freigegeben, nachvollziehbar (Branch/PR/Audit-Trail), reversibel
- [x] **Kein Vendor-Lock** — Codex ODER Claude, ein Klick
- [x] **Keine API-Kosten** — läuft über dein Abo-Login (ChatGPT/Claude), kein API-Key im Runner
- [x] **Lokal &amp; privat** — Code und Daten bleiben auf deinem Gerät

---

## 🔒 Sicherheit

- [x] **Human-in-the-Loop-Gate** — keine automatischen Merges, keine kritischen Aktionen ohne Freigabe
- [x] **Nichts läuft blind in main** — eigener Branch + Pull Request, du merged selbst
- [x] **Secrets bleiben lokal** — API-Key &amp; Connector-Token in der macOS-Keychain; **kein** Service-Role-Key in der App
- [x] **Cloud-Profil Zero-Knowledge** — Ende-zu-Ende verschlüsselt (Argon2id + AES-256-GCM, Schlüssel nur im RAM); der Server kann sie **nicht** lesen
- [x] **Gehärtet gegen Missbrauch** — Prompt-Injection-Leitplanken, Host-Allowlist, strikte CSP, Out-of-Scope-Schutz für den Runner
- [x] **Referenzdaten bleiben lokal** — private Dokumente (z. B. Lebenslauf) landen nie in Git oder der Cloud-Library

---

## 🗂️ Auch für den Alltag (Datei-Modus)

Derselbe Ablauf **ohne GitHub**: das Ergebnis landet lokal im Ordner `KatoResults` statt als Pull
Request — ideal für **Dokumente, Bewerbungen, Präsentationen**. KatoSync ist nicht nur für Code,
sondern für **jede wissensbasierte Aufgabe**.

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><b>Mistral-Zugang &amp; MCP</b><br/><img src="docs/images/settings.png" width="420" alt="Einstellungen – Mistral-Zugang" /></td>
    <td align="center"><b>Sync-Regeln &amp; Uploadplan</b><br/><img src="docs/images/sync-rules.png" width="420" alt="Sync-Regeln und lokaler Uploadplan" /></td>
  </tr>
</table>

---

## 🧩 Architektur

Ein schlanker **MCP-Server** (Cloudflare Worker + Supabase) ist der Rückkanal: Mistral Work pusht
Aufgaben/Briefings via MCP-Tools, die Desktop-App liest sie über eine kontrollierte REST-Brücke und
führt **lokal** aus. **Der Server führt selbst nichts aus.**

- **Frontend** — React/TypeScript in **MVVM + Repository** (`src/App.tsx` ↔ `viewmodels/` ↔ `repositories/`)
- **Core** — Rust/Tauri (`src-tauri/src/lib.rs`): Scan, Secret-Filter, CURRENT-Dateien, Upload, macOS-Keychain, Runner-Lauf, LaunchAgent
- **i18n** De/En/Es/Ru · Light/Dark · Präsentationsmodus (maskiert Token/IDs/E-Mail für Screenshots)
- Mistral-API-Key &amp; Connector-Token liegen ausschließlich in der macOS-Keychain

---

## ⬇️ Installation (macOS)

Signiert (Developer ID, MK Heartbeat UG) + Apple-notarisiert — kein Gatekeeper-Umweg.

1. **[Neueste Version → Releases](https://github.com/NMKato/KatoSync/releases/latest)** laden
2. ZIP entpacken → `KatoSync.app` nach **„Programme"** ziehen
3. Starten → geführtes Onboarding (Login → 5-Schritt-Tour)

---

## 🛠️ Entwicklung &amp; Build

<details>
<summary>Setup, Dev-Server, Desktop-Build</summary>

```bash
npm install --cache ./.npm-cache
npm run dev          # Frontend (Browser-Demo)

# Desktop (braucht Rust):
rustup default stable
npm run tauri dev

# Build:
npm run build        # tsc + Vite (Frontend)
npm run tauri build  # Desktop-Bundle
```

Release-Builds werden auf einer APFS-Kopie signiert (Developer ID, MK Heartbeat UG) und von Apple notarisiert.
Hinweis: Auf exFAT-Volumes scheitert Tauris Signier-Schritt an `xattr` → daher die APFS-Kopie.

</details>

---

## 🔭 Als Nächstes: KatoSync 3.0 — lokal-first

<div align="center">

**Die Intelligenz wandert auf dein Gerät.**
Eigene Domain-Agenten statt externem Chat — direkt über deine lokalen Runner, direkt auf deinen Ordnern.
_Deine Daten bleiben lokal — im Sinne des EU AI Act._

</div>

<table>
<tr>
<td width="50%" valign="top">

#### 🤖 Eigene Domain-Agenten
Vorgefertigte, editierbare Personas — **ein Klick**:

🧑‍💼 HR &nbsp;·&nbsp; 🗂️ Projektstatus
🛡️ Cybersecurity &nbsp;·&nbsp; 🤝 Assistenz
📸 Fotograf &nbsp;·&nbsp; 🎨 Grafikdesign

</td>
<td width="50%" valign="top">

#### 🪄 Skill-Generator 2.0
**Beschreibe deine Rolle** (oder die eines Mitarbeiters) → fertiger Agent-Skill, sofort einsatzbereit.
Custom-Skills bleiben natürlich möglich.

</td>
</tr>
</table>

**So läuft's — vollautomatisch, aber unter deiner Kontrolle:**

`📁 Ordner sammeln` → `⏰ zur festgelegten Zeit auswerten` → `📨 Briefing / Aufgabe` → `✅ du gibst frei` → `⚙️ lokaler Runner führt aus`

- [x] **Lokal-first** — planen **und** ausführen on-device, keine Remote-Library
- [x] **Optional vollständig lokal** — kleines Modell (z. B. via Ollama) für Planung/Triage; fokussierte Aufgaben brauchen keine Top-Maschine
- [x] **Zero-Config** — installieren → Runner-Login → Agent wählen → läuft
- [x] **Zeitgesteuert pro Skill** — wann gesammelt, wann ausgewertet

> Gleiche kontrollierte UX (Briefings + Aufgaben, Human-in-the-Loop) — nur wandert das „Gehirn" auf **dein** Gerät.

---

## 🗺️ Roadmap

- [x] Cloud-Profil (Zero-Knowledge) — Zugangsdaten folgen dem Konto
- [x] Multi-Runner (Codex CLI + Claude Code CLI)
- [x] Auth-Flows (Bestätigung/Passwort-Reset) + Sicherheitshärtung
- [x] Modus-Umschalter (Datei-Modus | Coding-Modus)
- [x] Datei-Modus end-to-end verifiziert — professionelle PDFs via gebündeltem Typst
- [x] Fortsetzbare Sessions — interaktive Runner-Session mit deinen Connectoren (Human-in-the-Loop)
- [x] Live-Feed mit benannten Schritten &amp; Icons
- [x] Aufgaben konsolidiert — ein Task-Surface (freigeben · ausführen · entfernen, mit Bestätigung) statt getrennter Board/Queue
- [x] Briefings als Vollbild-Reader (Liste → Detail mit Zurück)
- [ ] Connector-Aktionen live (Gmail/Blender) end-to-end getestet
- [ ] Weitere Ausgabeformate (Word/ODT/PowerPoint)
- [ ] Google-Login / KatoOS-Föderation

---

<div align="center">
<sub>Ein Produkt von <b>KatoOS</b> · MK Heartbeat UG — kein Auto-Merge, keine automatischen Zahlungen/E-Mails, keine Löschlogik für die Mistral-Library.</sub>
</div>


---

## Continuation Watchdog (lokale Nachtlaeufe)

Der optionale Watchdog fuehrt nur vorab definierte Wellen weiter. Er trifft keine freien LLM-Entscheidungen: Wenn der Local-Control-Daemon idle ist, sein Heartbeat frisch ist und keine andere Inbox/Running-Arbeit existiert, stellt er exakt die naechste Welle aus control/continuation/plan.json ein. Bei stopOnFailure=true stoppt die Kette fail-closed am ersten Fehler.

Installieren: scripts/install-continuation-watchdog.sh. Eine Vorlage liegt unter scripts/continuation-plan.example.json. Status und Log liegen in control/continuation/state.json bzw. watchdog.log. Der bestehende Local-Control-Daemon validiert weiterhin jeden strukturierten Job.

## Local Control Bridge (kein LLM erforderlich)

KatoSync kann zusätzlich als lokaler Ausführungs-Bus für einen externen Orchestrator laufen.
Dieser Modus benötigt **keinen Mistral-Key, keinen OpenAI-API-Key und keinen Codex-/Claude-Runner**.

Der Daemon verwendet ausschließlich lokale Dateien:

- `~/Library/Application Support/KatoSync/control/inbox/` — atomar eingestellte Jobs
- `.../outbox/` — maschinenlesbare Ergebnisse
- `.../state.json` — `idle` / `busy` + Heartbeat
- `.../feed.log` — kompakter Live-Feed
- `.../logs/<job>.log` — stdout/stderr je Job

Start manuell:

```bash
/Applications/KatoSync.app/Contents/MacOS/katosync --local-control-daemon
```

Oder als Benutzer-LaunchAgent:

```bash
./scripts/install-local-control-agent.sh /Applications/KatoSync.app
```

Sicheren Testjob einstellen:

```bash
python3 scripts/katosync-control-submit.py \
  --cwd ~/Projects/MeinRepo \
  --wait \
  -- git status --short
```

Jobs sind strukturiert (`command` + `args`), nicht freie Shell-Skripte. Der Daemon blockiert
privilegierte/destruktive Shell-Einstiege und unterscheidet `read_only` von explizitem
`workspace_write`. `requireCleanGit` kann für schreibende Repo-Jobs fail-closed aktiviert werden.

Der Local-Control-Pfad ist unabhängig vom bestehenden Mistral-/Briefing-Workflow; beide Modi
können parallel installiert bleiben.
