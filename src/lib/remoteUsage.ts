// Remote Commander Usage API contract. This is distinct from Mistral API
// rate-limits and from KatoSync Mesh telemetry. Only trusted live server data.
export interface RemoteUsageOverview {
  version: 1;
  live: true;
  timezone: "UTC";
  month: string;
  plan: "free" | "pro";
  toolCalls: number;
  dailyAverage: number;
  monthlyLimit: number | null;
  remaining: number | null;
  usagePercent: number | null;
  quotaDenied: number;
  byDay: Array<{ day: string; calls: number }>;
  byClient: Array<{ clientId: string; calls: number }>;
  byDevice: Array<{ deviceId: string; calls: number }>;
  byTool: Array<{ tool: string; calls: number }>;
}
export interface RemoteUsageHistory {
  version: 1;
  live: true;
  timezone: "UTC";
  months: Array<{ month: string; toolCalls: number; quotaDenied: number }>;
}
const month = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(s);
const number = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const entries = (input: unknown, field: string, limit: number): boolean =>
  Array.isArray(input) && input.length <= limit && input.every(row =>
    row && typeof row === "object" && typeof row[field] === "string" &&
    row[field].length > 0 && row[field].length <= 256 && number(row.calls)
  );
export function parseUsageOverview(input: unknown): RemoteUsageOverview | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Partial<RemoteUsageOverview>;
  if (v.version !== 1 || v.live !== true || v.timezone !== "UTC" ||
      !month(v.month) || (v.plan !== "free" && v.plan !== "pro") ||
      !number(v.toolCalls) || !number(v.dailyAverage) || !number(v.quotaDenied) ||
      !entries(v.byDay, "day", 31) || !entries(v.byClient, "clientId", 10) ||
      !entries(v.byDevice, "deviceId", 10) || !entries(v.byTool, "tool", 20)) {
    return null;
  }
  if (v.plan === "free") {
    if (v.monthlyLimit !== 10000 || !number(v.remaining) ||
        !number(v.usagePercent) || v.usagePercent > 100 ||
        v.remaining !== Math.max(0, v.monthlyLimit - v.toolCalls)) {
      return null;
    }
  } else if (v.monthlyLimit !== null || v.remaining !== null ||
             v.usagePercent !== null) {
    return null;
  }
  return v as RemoteUsageOverview;
}
export function parseUsageHistory(input: unknown): RemoteUsageHistory | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Partial<RemoteUsageHistory>;
  if (v.version !== 1 || v.live !== true || v.timezone !== "UTC" ||
      !Array.isArray(v.months) || v.months.length !== 6 ||
      !v.months.every(row => row && month(row.month) &&
        number(row.toolCalls) && number(row.quotaDenied)) ||
      new Set(v.months.map(x=>x.month)).size !== v.months.length ||
      !v.months.every((r,i,rows)=> i===0 || r.month > rows[i-1].month)) return null;
  return v as RemoteUsageHistory;
}
