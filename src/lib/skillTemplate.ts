// Created by NMKato on 2026-06-29
// Skill-Generator: haengt an eine Agenten-Persona die kanonischen KatoSync-Integrations-Anweisungen an
// (Diagramm-Format-Contract + Action-Plan-Pflichtfelder), damit Briefings/Action-Plaene ueber MCP korrekt ankommen.
// Reines String-Templating, kein Backend. Token werden bewusst NICHT in den Prompt geschrieben.
import type { AppConfig } from "../types";
import { NO_PROJECT_ID } from "../repositories/katoSyncRepository";

export const SKILL_CONTRACT_VERSION = "1";

// Bekannte Projekt-IDs des Nutzers (aus gemerkten Repos), damit der Agent gueltige projectExternalId nutzt.
export function knownProjectIds(config: AppConfig | null, extra: string[] = []): string[] {
  const fromRepos = Object.keys(config?.projectRepos ?? {});
  return Array.from(new Set([...fromRepos, ...extra])).filter((id) => Boolean(id) && id !== NO_PROJECT_ID);
}

export function mcpEndpoint(baseUrl: string): string {
  return `${(baseUrl || "https://mcp.katoos.de").replace(/\/+$/, "")}/mcp`;
}

export function buildSkillPrompt(persona: string, opts: { mcpUrl: string; projects: string[] }): string {
  const mcp = mcpEndpoint(opts.mcpUrl);
  const projectList = opts.projects.length
    ? opts.projects.join(", ")
    : "(noch keine bekannt — vergib eine sprechende projectExternalId, z. B. \"mein-projekt\")";
  const fence = "```";

  const lines = [
    persona.trim(),
    "",
    `=== KatoSync-Integration (auto-generiert · Contract v${SKILL_CONTRACT_VERSION}) ===`,
    `Du bist ueber einen MCP-Connector mit KatoSync verbunden (${mcp}).`,
    "Halte dich an die folgenden Ausgabe-Regeln, damit Ergebnisse in KatoSync korrekt und mit Diagrammen ankommen.",
    "",
    "## 1) Briefings (Leseraum)",
    "Wenn du ein Ergebnis als Briefing uebermittelst, rufe das MCP-Tool create_briefing mit: title, summary, body (Markdown), priority (low|medium|high|critical), suggestedAction.",
    "Im body darfst du strukturierte Daten als Markdown-Codebloecke einbetten — KatoSync rendert sie als animierte Diagramme. Erlaubte Bloecke (gueltiges JSON im Codeblock, sonst Rohtext):",
    `- ${fence}katosync:kpi${fence}      -> { "title?": "…", "items": [{ "label": "…", "value": "…", "delta?": "…", "tone?": "TONE" }] }`,
    `- ${fence}katosync:donut${fence}    -> { "title?": "…", "segments": [{ "label": "…", "value": 0, "tone?": "TONE" }] }`,
    `- ${fence}katosync:bar${fence}      -> { "title?": "…", "max?": 100, "bars": [{ "label": "…", "value": 0, "tone?": "TONE" }] }`,
    `- ${fence}katosync:status${fence}   -> { "title?": "…", "items": [{ "label": "…", "state": "STATE", "note?": "…" }] }`,
    `- ${fence}katosync:timeline${fence} -> { "title?": "…", "items": [{ "time?": "…", "label": "…", "state?": "STATE" }] }`,
    `- ${fence}katosync:callout${fence}  -> { "tone?": "TONE", "title?": "…", "text": "…" }`,
    "TONE = brand | ok | warn | danger | info.  STATE = ok | warn | danger | info.",
    `WICHTIG zum Format: Jeder Block ist ein EIGENSTAENDIGER Codeblock — eine Zeile ${fence}katosync:<typ>, dann NUR reines JSON in eigenen Zeilen, dann ${fence} allein in einer Zeile. KEINE runden Klammern um den Block, NICHT inline im Fliesstext, kein Text auf der Backtick-Zeile. Falsch: (katosync:status { ... }). Richtig: der Codeblock unten.`,
    "",
    "## 2) Action-Plaene (Projekt-Board) — NUR wenn du konkrete, umsetzbare Aufgaben vorschlaegst",
    "WENN (und nur wenn) du lokal ausfuehrbare Aufgaben erzeugst, rufe create_pending_action_plan mit tasks[]. Jede Task MUSS enthalten:",
    `- projectExternalId: das Projekt der Aufgabe. Bekannte Projekte: ${projectList}.`,
    "- riskLevel: low | medium | high | critical.  (critical wird NICHT automatisch ausgefuehrt, nur nach manueller Pruefung.)",
    "- targetRunner: welcher Runner die Aufgabe ausfuehrt. Erlaubt: codex_cli | codex_desktop | kai_desktop | local_llm | mistral_api | openai_api | anthropic_api | manual_review. (Nur codex_cli ist lokal automatisch ausfuehrbar; die anderen sind Platzhalter/manuell.)",
    "- title (kurz und klar) und priority (Reihenfolge, 1 = zuerst).",
    "Es wird NICHTS automatisch ausgefuehrt — der Mensch gibt jeden Plan im Board frei.",
    "",
    "## 3) Beispiele (Briefing-Body mit Diagrammen — jeder Block eigenstaendig)",
    `${fence}katosync:kpi`,
    '{ "items": [ { "label": "Offen", "value": 7, "tone": "info" }, { "label": "Erledigt", "value": 12, "tone": "ok" }, { "label": "Blocker", "value": 2, "tone": "danger" } ] }',
    fence,
    `${fence}katosync:status`,
    '{ "title": "Matching", "items": [ { "label": "Kotlin", "state": "ok", "note": "Kernkompetenz" }, { "label": "Berufserfahrung", "state": "warn", "note": "1 Jahr" } ] }',
    fence,
    `${fence}katosync:callout`,
    '{ "tone": "brand", "title": "Empfehlung", "text": "Passt zu 80% — jetzt bewerben." }',
    fence,
    "",
    "## Sicherheit",
    "Der KatoSync-Connector-Token wird NICHT in diesem Prompt gespeichert — er gehoert als Bearer in die Connector-Konfiguration in Mistral. Gib niemals Tokens oder Secrets in Briefings oder Action-Plaenen aus.",
    "=== Ende KatoSync-Integration ==="
  ];
  return lines.join("\n");
}
