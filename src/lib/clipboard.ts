// Created by NMKato on 2026-06-29

/**
 * Kopiert reinen Text in die Zwischenablage. Gibt true bei Erfolg zurueck,
 * false wenn die Webview-Clipboard-API nicht verfuegbar ist oder die Berechtigung
 * fehlt. Die UI kann dann einen Hinweis zeigen.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
