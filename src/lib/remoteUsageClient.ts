// RC-12: Prepared read-only Remote Commander usage client.
// Not mounted in App.tsx or enabled in production. No token persistence.
// Session changes, logout and late responses MUST clear previous account data.
import { parseUsageOverview, parseUsageHistory } from "./remoteUsage";
import type { RemoteUsageOverview, RemoteUsageHistory } from "./remoteUsage";

export type RemoteUsageStatus =
  | "disconnected" | "loading" | "ready" | "unauthorized" | "unavailable";

export interface RemoteUsageSnapshot {
  readonly status: RemoteUsageStatus;
  readonly summary: RemoteUsageOverview | null;
  readonly history: RemoteUsageHistory | null;
}

export interface RemoteUsageSession {
  /** Opaque per-login key from the trusted KatoOS session manager, not a user ID. */
  sessionKey: string;
  /** Access token is requested anew on refresh; this module never stores it. */
  getAccessToken: () => Promise<string | null>;
}

export interface RemoteUsageClientConfig {
  /** Reviewed remote MCP resource URL, exactly https://host/mcp. */
  resourceUrl: string;
  /** Test-only transport override; production uses the platform fetch. */
  transport?: typeof fetch;
}

const TOKEN = /^[A-Za-z0-9._~-]{20,8192}$/;
const MAX_RESPONSE_CHARS = 128 * 1024;
const empty = (status: RemoteUsageStatus): RemoteUsageSnapshot =>
  Object.freeze({ status, summary: null, history: null });

function resourceOrigin(resourceUrl: string): string {
  let url: URL;
  try { url = new URL(resourceUrl); }
  catch { throw new TypeError("INVALID_REMOTE_MCP_RESOURCE"); }
  if (url.protocol !== "https:" || !url.hostname ||
      url.pathname !== "/mcp" || url.search || url.hash ||
      url.username || url.password) {
    throw new TypeError("INVALID_REMOTE_MCP_RESOURCE");
  }
  return url.origin;
}

export function createRemoteUsageSessionClient(config: RemoteUsageClientConfig) {
  const origin = resourceOrigin(config.resourceUrl);
  const transport = config.transport ?? fetch;
  if (typeof transport !== "function") throw new TypeError("INVALID_TRANSPORT");

  let session: RemoteUsageSession | null = null;
  let generation = 0;
  let pending: AbortController | null = null;
  let snapshot: RemoteUsageSnapshot = empty("disconnected");
  const listeners = new Set<(value: RemoteUsageSnapshot) => void>();

  function publish(next: RemoteUsageSnapshot) {
    snapshot = next;
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* UI observers cannot weaken auth. */ }
    }
  }

  function invalidate() {
    generation++;
    pending?.abort();
    pending = null;
    publish(empty("disconnected"));
  }

  function attach(next: RemoteUsageSession) {
    if (!next || typeof next.sessionKey !== "string" ||
        next.sessionKey.length < 8 || next.sessionKey.length > 256 ||
        typeof next.getAccessToken !== "function") {
      throw new TypeError("INVALID_REMOTE_USAGE_SESSION");
    }
    invalidate();
    // Store only the trusted ephemeral token provider, not a bearer token.
    session = { sessionKey: next.sessionKey, getAccessToken: next.getAccessToken };
    publish(empty("unavailable"));
  }

  function disconnect() {
    session = null;
    invalidate();
  }

  async function readJson(path: string, token: string, signal: AbortSignal): Promise<unknown> {
    const response = await transport(origin + path, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        "Cache-Control": "no-store"
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal
    });
    if (response.status === 401 || response.status === 403) throw new Error("AUTH_DENIED");
    if (!response.ok) throw new Error("USAGE_UNAVAILABLE");
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      throw new Error("INVALID_RESPONSE");
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) throw new Error("RESPONSE_TOO_LARGE");
    try { return JSON.parse(body) as unknown; }
    catch { throw new Error("INVALID_RESPONSE"); }
  }

  async function refresh(): Promise<RemoteUsageSnapshot> {
    if (!session) return snapshot;
    generation++;
    pending?.abort();
    const ownGeneration = generation;
    const ownSession = session;
    const controller = new AbortController();
    pending = controller;
    publish(empty("loading"));

    try {
      const token = await ownSession.getAccessToken();
      if (ownGeneration !== generation || ownSession !== session) return snapshot;
      if (typeof token !== "string" || !TOKEN.test(token)) {
        publish(empty("unauthorized"));
        return snapshot;
      }
      const [rawSummary, rawHistory] = await Promise.all([
        readJson("/api/usage/summary", token, controller.signal),
        readJson("/api/usage/history?months=6", token, controller.signal)
      ]);
      if (ownGeneration !== generation || ownSession !== session) return snapshot;

      const summary = parseUsageOverview(rawSummary);
      const history = parseUsageHistory(rawHistory);
      if (!summary || !history || history.months[history.months.length - 1]?.month !== summary.month) {
        publish(empty("unavailable"));
        return snapshot;
      }
      publish(Object.freeze({ status: "ready", summary, history }));
      return snapshot;
    } catch (error) {
      if (ownGeneration !== generation || ownSession !== session) return snapshot;
      const denied = error instanceof Error && error.message === "AUTH_DENIED";
      publish(empty(denied ? "unauthorized" : "unavailable"));
      return snapshot;
    } finally {
      if (ownGeneration === generation) {
        controller.abort();
        pending = null;
      }
    }
  }

  function subscribe(listener: (value: RemoteUsageSnapshot) => void): () => void {
    if (typeof listener !== "function") throw new TypeError("INVALID_LISTENER");
    listeners.add(listener);
    listener(snapshot);
    return () => { listeners.delete(listener); };
  }

  return Object.freeze({
    attach, disconnect, refresh, subscribe,
    snapshot: (): RemoteUsageSnapshot => snapshot
  });
}
