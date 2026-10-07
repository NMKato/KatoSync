// Created by NMKato Solutions
// Lokales API-Usage-Ledger: keine Secrets, nur abrechnungsrelevante Metadaten.
// Preise werden pro Request gesnapshottet, damit spaetere Tarifwechsel historische Schaetzungen
// nicht rueckwirkend veraendern.
import { apiModelProfile } from "./apiModelCatalog";
import type {
  ApiProviderConfig,
  ApiUsageRecord,
  ApiUsageSummary,
  ApiWorkerResult
} from "../types";

const STORAGE_KEY = "katosync.apiUsage.v1";
const MAX_RECORDS = 5000;

function readRecords(): ApiUsageRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecords(records: ApiUsageRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
  } catch {
    // Usage telemetry must never break execution if storage is unavailable.
  }
}

function estimatedCost(connection: ApiProviderConfig, inputTokens: number, outputTokens: number) {
  const profile = apiModelProfile(connection.preset, connection.model);
  const pricing = profile.pricing;
  if (!pricing || pricing.inputPerMillion == null || pricing.outputPerMillion == null) {
    return { cost: null, effectiveAt: null };
  }
  return {
    cost:
      (inputTokens / 1_000_000) * pricing.inputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion,
    effectiveAt: pricing.effectiveAt
  };
}

export function recordApiUsage(
  connection: ApiProviderConfig,
  result: ApiWorkerResult,
  projectId: string | null
): ApiUsageRecord {
  const inputTokens = result.inputTokens ?? 0;
  const outputTokens = result.outputTokens ?? 0;
  const estimate = estimatedCost(connection, inputTokens, outputTokens);
  const record: ApiUsageRecord = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    connectionId: result.connectionId || connection.id,
    projectId,
    provider: connection.preset,
    model: result.model || connection.model,
    effort: result.effort,
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reportedCostUsd: result.reportedCostUsd,
    estimatedCostUsd: estimate.cost,
    pricingEffectiveAt: estimate.effectiveAt,
    createdAt: result.completedAt || new Date().toISOString()
  };
  const records = readRecords();
  records.push(record);
  writeRecords(records);
  return record;
}

function recordCost(record: ApiUsageRecord): number {
  return record.reportedCostUsd ?? record.estimatedCostUsd ?? 0;
}

export function apiUsageSummary(connectionId: string): ApiUsageSummary {
  const records = readRecords().filter((record) => record.connectionId === connectionId);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const actualRecords = records.filter((record) => record.reportedCostUsd != null);
  const todayRecords = records.filter((record) => record.createdAt.slice(0, 10) === today);
  const monthRecords = records.filter((record) => record.createdAt.slice(0, 7) === month);
  return {
    connectionId,
    inputTokens: records.reduce((sum, record) => sum + record.inputTokens, 0),
    cachedInputTokens: records.reduce((sum, record) => sum + record.cachedInputTokens, 0),
    outputTokens: records.reduce((sum, record) => sum + record.outputTokens, 0),
    requests: records.length,
    actualCostUsd: records.length && actualRecords.length === records.length
      ? actualRecords.reduce((sum, record) => sum + (record.reportedCostUsd ?? 0), 0)
      : null,
    estimatedCostUsd: records.reduce((sum, record) => sum + (record.estimatedCostUsd ?? 0), 0),
    todayCostUsd: todayRecords.reduce((sum, record) => sum + recordCost(record), 0),
    monthCostUsd: monthRecords.reduce((sum, record) => sum + recordCost(record), 0),
    // Getrennte Wahrheit: vom Provider gemeldete Kosten vs. lokale Schaetzung aus Preis-Snapshot.
    monthReportedCostUsd: monthRecords.reduce((sum, record) => sum + (record.reportedCostUsd ?? 0), 0),
    monthEstimatedCostUsd: monthRecords
      .filter((record) => record.reportedCostUsd == null)
      .reduce((sum, record) => sum + (record.estimatedCostUsd ?? 0), 0),
    monthUnpricedRequests: monthRecords.filter(
      (record) => record.reportedCostUsd == null && record.estimatedCostUsd == null
    ).length,
    todayCostIsEstimate: todayRecords.some((record) => record.reportedCostUsd == null),
    monthCostIsEstimate: monthRecords.some((record) => record.reportedCostUsd == null),
    updatedAt: records.length ? records[records.length - 1].createdAt : null
  };
}

/** Monatsausgaben je Slot (gemeldet, sonst geschaetzt) fuer Budget- und Routing-Entscheidungen. */
export function apiMonthSpendByConnection(now: Date = new Date()): Record<string, number> {
  const month = now.toISOString().slice(0, 7);
  const spend: Record<string, number> = {};
  for (const record of readRecords()) {
    if (record.createdAt.slice(0, 7) !== month) continue;
    spend[record.connectionId] = (spend[record.connectionId] ?? 0) + recordCost(record);
  }
  return spend;
}

export function apiUsageRecords(connectionId?: string): ApiUsageRecord[] {
  const records = readRecords();
  return connectionId ? records.filter((record) => record.connectionId === connectionId) : records;
}
