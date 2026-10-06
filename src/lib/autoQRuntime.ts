// Created by NMKato Solutions
// Reine Taktentscheidung fuer AutoQ: Runtime-I/O bleibt im ViewModel, damit Tests weder Projekte
// anfassen noch Runner starten. Ein leerer Auto-Lane-Plan wird zeitnah, sonst periodisch erneuert.

export const AUTO_Q_EMPTY_REFRESH_MS = 30_000;
export const AUTO_Q_PERIODIC_REFRESH_MS = 5 * 60 * 1000;

export type AutoQRefreshReason = "queue_empty" | "periodic";

export interface AutoQRefreshInput {
  enabled: boolean;
  syncing: boolean;
  writerActive: boolean;
  laneCount: number;
  lastRefreshAt: number;
  now: number;
  emptyRefreshMs?: number;
  periodicRefreshMs?: number;
}

/** Entscheidet deterministisch, ob aktuelle Projektwahrheit erneut gelesen werden muss. */
export function autoQRefreshReason(input: AutoQRefreshInput): AutoQRefreshReason | null {
  if (!input.enabled || input.syncing || input.writerActive) return null;
  const elapsed = input.lastRefreshAt > 0 ? Math.max(0, input.now - input.lastRefreshAt) : Number.POSITIVE_INFINITY;
  const emptyRefreshMs = Math.max(0, input.emptyRefreshMs ?? AUTO_Q_EMPTY_REFRESH_MS);
  const periodicRefreshMs = Math.max(emptyRefreshMs, input.periodicRefreshMs ?? AUTO_Q_PERIODIC_REFRESH_MS);
  if (input.laneCount === 0 && elapsed >= emptyRefreshMs) return "queue_empty";
  if (elapsed >= periodicRefreshMs) return "periodic";
  return null;
}
