<!-- Created by NMKato on 2026-07-01 -->

# KatoSync — Präsentation (Info & Kernbotschaften)

> Grundlage für die Präsentation (gemischtes Publikum / Kunden-Pitch). Coding-fokussiert, auf den
> Punkt. Vier Säulen: **Problem · Lösung · Nutzen · Sicherheit**.

---

## Kernfunktion (Elevator, 2–3 Sätze)

**KatoSync verwandelt dein Projekt-Wissen in ausgeführte Arbeit.** Die KI (Mistral) versteht deine
Projekte und plant konkrete Aufgaben — **du gibst frei** — und ein **lokaler Runner (Codex oder
Claude)** setzt sie in deinem echten Repo um: eigener Branch, Commit, Pull Request.

Kein Chat, der nur redet. Kein Auto-Agent, der unkontrolliert loslegt. Sondern KI-Ergebnisse, die
**du kontrollierst — lokal und sicher.**

---

## Problem

- **KI redet, liefert aber nicht.** Chat-Assistenten produzieren Vorschläge, aber keine fertige,
  eingecheckte Arbeit im echten Repo → Copy-Paste-Chaos.
- **Projekt-Wissen ist verstreut.** Status, Notizen, Roadmaps, Code liegen überall — die KI hat nie
  den vollen Kontext.
- **Auto-Agenten sind ein Blindflug.** Unkontrolliertes Ausführen und Mergen ohne menschliche
  Freigabe = Risiko für Code, Secrets und Kosten.

## Lösung

KatoSync ist der **kontrollierte Brückenkopf** zwischen KI-Verständnis und lokaler Ausführung:

1. **Sammeln** — bündelt dein Projekt-Wissen als saubere Wissensbasis für die KI (Secrets ausgeschlossen).
2. **Verstehen + Planen** — Mistral erzeugt konkrete, projektbezogene Aufgaben (Action-Pläne) mit
   Risiko-Einstufung und Ziel-Runner.
3. **Freigeben (Human-in-the-Loop)** — du prüfst und gibst frei. Nichts läuft automatisch.
4. **Ausführen** — ein lokaler Runner (Codex CLI oder Claude Code CLI) setzt die Aufgabe in deinem
   Repo um: eigener Branch, Auto-Commit, Pull Request. **Kein Auto-Merge in main.**

## Nutzen

- **Von der Idee zum Pull Request** — ohne Copy-Paste.
- **Volle Kontrolle** — jede Ausführung ist freigegeben, nachvollziehbar (Branch/PR/Audit-Trail),
  reversibel.
- **Kein Vendor-Lock** — Runner-agnostisch: Codex ODER Claude, ein Klick.
- **Keine API-Kosten** — läuft über dein Abo-Login (ChatGPT/Claude), kein API-Key im Runner.
- **Lokal + privat** — Code und Daten bleiben auf deinem Gerät.

## Sicherheit (Vertrauen)

- **Human-in-the-Loop-Gate** — keine automatischen Merges, keine kritischen Aktionen ohne Freigabe;
  als kritisch markierte Aufgaben laufen gar nicht automatisch.
- **Nichts läuft blind in main** — eigener Branch + Pull Request, du merged selbst.
- **Secrets bleiben lokal** — API-Key und Connector-Token in der macOS-Keychain, nie in Git oder
  Klartext. Kein Service-Role-Key in der App.
- **Cloud-Profil Zero-Knowledge** — Zugangsdaten folgen deinem Konto, Ende-zu-Ende verschlüsselt
  (Argon2id + AES-256-GCM, Schlüssel nur im RAM). Der Server kann sie nicht lesen.
- **Gehärtet gegen Missbrauch** — Prompt-Injection-Leitplanken (KI-Aufgaben werden als „untrusted"
  behandelt), Token nur an bekannte KatoOS-Hosts (Allowlist), strikte CSP, Runner darf nur im
  freigegebenen Repo arbeiten (Out-of-Scope-Schutz).
- **Referenzdaten bleiben lokal** — interne Docs / private Dateien landen nie in Git oder der Cloud.

---

## Coding-Workflow (der Kern, end-to-end)

1. **Scannen** — KatoSync liest deine Projektordner und stellt der KI eine saubere Wissensbasis bereit.
2. **Planen** — Mistral-Agenten erzeugen projektbezogene Aufgaben + Briefings → **Projekt-Board /
   Action Queue**.
3. **Freigeben** — du triagierst und gibst frei (Human-in-the-Loop).
4. **Ausführen** — ein lokaler Runner (**Codex CLI** oder **Claude Code CLI**, per Picker) arbeitet
   auf einem **eigenen Branch von main**.
5. **Liefern** — Auto-Commit → Push → **Pull Request** (beides opt-in). **Kein Auto-Merge.**
6. **Abschließen** — der Task ist „ausgeführt" (PR liegt vor); du prüfst und merged → „erledigt".
   Ein Live-Feed zeigt den Lauf in Echtzeit.

## Datei-Modus (kurz — auch für den Alltag)

Derselbe Ablauf **ohne GitHub**: das Ergebnis landet lokal in einem Ordner (`KatoResults`) statt als
Pull Request — ideal für **Dokumente, Bewerbungen, Präsentationen**. Beleg: KatoSync ist nicht nur
für Code, sondern für **jede wissensbasierte Aufgabe im Alltag**.

## Architektur (1–2 Sätze)

Ein schlanker **MCP-Server** (Cloudflare Worker + Supabase) ist der Rückkanal: Mistral pusht
Aufgaben/Briefings via MCP, die Desktop-App liest sie über eine kontrollierte REST-Brücke und führt
**lokal** aus. Der Server führt selbst nichts aus.

---

## Folien-Outline (~10 Folien — Titel + eine Kernaussage)

1. **Titel** — „KatoSync: KI, die liefert statt nur redet." *(Sub: Dein Projekt-Wissen → ausgeführte
   Arbeit. Lokal & sicher.)*
2. **Problem** — KI redet nur, Wissen ist verstreut, Auto-Agenten sind ein Blindflug.
3. **Die Idee** — KI versteht + plant → du gibst frei → lokal ausgeführt. *(Der Kreislauf als Bild.)*
4. **Coding-Workflow** *(Kern)* — Aufgabe → Freigabe → Runner → Branch → Pull Request.
5. **Human-in-the-Loop** — du behältst die Kontrolle. Kein Auto-Merge, kein Blindflug.
6. **Kein Vendor-Lock** — Codex ODER Claude. Keine API-Kosten (Abo-Login).
7. **Auch für den Alltag** *(Datei-Modus)* — Dokumente, Bewerbungen, Präsentationen. Dasselbe Prinzip.
8. **Sicherheit** — Secrets lokal, Zero-Knowledge-Cloud-Profil, gehärtet gegen Missbrauch.
9. **Nutzen auf einen Blick** — von der Idee zum PR: kontrolliert, nachvollziehbar, privat.
10. **Abschluss** — macOS-App (Beta). KatoOS · MK Heartbeat UG. *(Optional: Screenshot / Logo.)*

---

## Ein-Satz-Pitch (fürs Deckblatt / die Vorstellung)

> **KatoSync ist der lokale, sichere Aktionsknoten, der KI-Verständnis in freigegebene, ausgeführte
> Arbeit verwandelt — vom Pull Request bis zum fertigen Dokument.**
