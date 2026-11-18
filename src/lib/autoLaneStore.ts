// Created by NMKato Solutions
// Lokale Persistenz fuer den Auto-Lane-Planer: Auto-Modus, Dispatch-Claims und die Board-Auswahl
// (Reihenfolge). Nur IDs/Zeitpunkte – keine Pfade, keine Prompts, keine Tokens.
import type { AutoLaneClaim } from "../types";

export const AUTO_LANE_MODE_KEY = "katosync.autoLane.mode.v1";
export const AUTO_LANE_CLAIMS_KEY = "katosync.autoLane.claims.v1";
export const BOARD_SELECTION_KEY = "katosync.board.selection.v1";

export interface AutoLaneMode {
  enabled: boolean;
  updatedAt: string | null;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage nicht verfuegbar -> Zustand bleibt nur fuer diese Sitzung
  }
}

export function readAutoLaneMode(): AutoLaneMode {
  const value = readJson<Partial<AutoLaneMode>>(AUTO_LANE_MODE_KEY, {});
  return { enabled: value.enabled === true, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null };
}

export function writeAutoLaneMode(mode: AutoLaneMode) {
  writeJson(AUTO_LANE_MODE_KEY, mode);
}

export function readAutoLaneClaims(): AutoLaneClaim[] {
  const value = readJson<unknown>(AUTO_LANE_CLAIMS_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is AutoLaneClaim =>
      Boolean(entry) && typeof entry.taskId === "string" && typeof entry.projectId === "string" && typeof entry.repoKey === "string"
  );
}

export function writeAutoLaneClaims(claims: AutoLaneClaim[]) {
  writeJson(AUTO_LANE_CLAIMS_KEY, claims);
}

export function readBoardSelection(): string[] {
  const value = readJson<unknown>(BOARD_SELECTION_KEY, []);
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function writeBoardSelection(order: string[]) {
  writeJson(BOARD_SELECTION_KEY, order);
}
