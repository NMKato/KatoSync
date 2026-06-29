// Created by NMKato on 2026-06-29

/**
 * Laesst nur http(s)-URLs durch und gibt sonst undefined zurueck. Schuetzt
 * davor, dass server-/Codex-gelieferte Werte (z. B. pr_url) als `javascript:`-
 * oder `data:`-href in der Webview Code ausfuehren koennen.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return url;
  } catch {
    // ungueltige URL -> nicht rendern
  }
  return undefined;
}
