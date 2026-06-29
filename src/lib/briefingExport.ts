// Created by NMKato on 2026-06-29

import type { Briefing } from "../types";

/**
 * Wandelt ein Briefing in sauberen Markdown-Text fuer die Zwischenablage um,
 * damit es sich in NotebookLM, ChatGPT, Obsidian o.ae. ohne Strukturverlust
 * weiterverarbeiten laesst. Der rohe Briefing-Body (inkl. der katosync-
 * Diagrammbloecke) bleibt als strukturierte Daten erhalten — fuer LLMs besser
 * lesbar als ein gerendertes Bild. `suggestedActionLabel` wird lokalisiert
 * uebergeben (z. B. t("briefings.reader.suggestedAction")).
 */
export function briefingToMarkdown(briefing: Briefing, suggestedActionLabel: string): string {
  const lines: string[] = [
    `# ${briefing.title}`,
    "",
    `_${briefing.agentName} · ${briefing.createdAt} · ${briefing.source}_`,
    ""
  ];
  if (briefing.summary) {
    lines.push(briefing.summary, "");
  }
  if (briefing.body) {
    lines.push(briefing.body, "");
  }
  if (briefing.suggestedAction) {
    lines.push(`**${suggestedActionLabel}:** ${briefing.suggestedAction}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
