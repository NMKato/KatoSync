// KatoSync #76 — backend-only verification against Supabase Auth and live
// auth.sessions. This is not an HTTP endpoint or a deployed connection.
// A server-held, parameterized DB reader is mandatory; never trust JWT
// payloads without the authoritative GET /auth/v1/user check.
import type { Session } from "./trustedApprovalBroker.ts";

export interface SqlSessionReader {
  // Trusted backend SQL connection only. Never run with public/anon client API.
  query<T extends Record<string, unknown>>(sql: string, parameters: readonly string[]): Promise<readonly T[]>;
}
export interface SessionVerifierConfig {
  projectOrigin: string; // Trusted server config: https://<project>.supabase.co
  publishableKey: string; // public/publishable project key, NOT service_role
  sql: SqlSessionReader;
  fetchImpl?: typeof fetch; // test seam; production defaults to fetch
  now?: () => number;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_READER_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM auth.sessions s
  WHERE s.id = $1::uuid AND s.user_id = $2::uuid
) AS active
`;
// No user/agent-controlled SQL fragments or 'auth.sessions' Data API access.
function trustedOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/" || url.search || url.hash ||
      !/^[a-z0-9-]+[.]supabase[.]co$/.test(url.hostname)) {
    throw new Error("Untrusted Supabase Auth origin");
  }
  return url.origin;
}
function verifiedClaimsOnlyAfterRemoteCheck(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts[1].length > 8192 || !/^[a-zA-Z0-9_-]+$/.test(parts[1])) return null;
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
export function makeLiveSupabaseSessionVerifier(config: SessionVerifierConfig): {
  verifyUserAccessToken(token: string): Promise<Session | null>;
} {
  // Validate once at startup to avoid accidentally forwarding bearer tokens
  // to an attacker-controlled URL supplied by a task or model.
  const origin = trustedOrigin(config.projectOrigin);
  // Only modern publishable keys are allowed in this candidate. A legacy
  // anon JWT or service-role secret must not silently become an Auth API key.
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(config.publishableKey)) {
    throw new Error("Expected a Supabase publishable project key");
  }
  const fetcher = config.fetchImpl ?? fetch;
  const now = config.now ?? Date.now;
  return {
    async verifyUserAccessToken(token: string): Promise<Session | null> {
      if (typeof token !== "string" || token.length < 16 || token.length > 8192 ||
          token.includes("\n") || token.includes("\r")) return null;
      try {
        // Auth server MUST verify the JWT signature/expiry; parsing its
        // payload below is never authentication.
        const response = await fetcher(origin + "/auth/v1/user", {
          method: "GET",
          headers: {
            "apikey": config.publishableKey,
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(3500),
        });
        if (!response.ok || response.redirected) return null;
        const user: unknown = await response.json();
        if (user === null || typeof user !== "object" || Array.isArray(user)) return null;
        const profile = user as Record<string, unknown>;
        if (typeof profile.id !== "string" || !UUID.test(profile.id) ||
            profile.is_anonymous === true) return null;
        const claims = verifiedClaimsOnlyAfterRemoteCheck(token);
        if (!claims || claims.sub !== profile.id ||
            claims.iss !== origin + "/auth/v1" ||
            claims.role !== "authenticated" ||
            (claims.aud !== "authenticated" &&
              !(Array.isArray(claims.aud) && claims.aud.includes("authenticated"))) ||
            typeof claims.session_id !== "string" || !UUID.test(claims.session_id) ||
            typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) ||
            claims.exp * 1000 <= now()) return null;

        // Re-check real server-owned session database: Supabase access tokens
        // may remain cryptographically valid after sign-out/revocation.
        const rows = await config.sql.query<{active: boolean}>(ACCESS_READER_SQL, [
          claims.session_id, profile.id,
        ]);
        if (rows.length !== 1 || rows[0]?.active !== true) return null;
        return {
          userId: profile.id,
          sessionId: claims.session_id,
          expiresAtMs: claims.exp * 1000,
          anonymous: false,
        };
      } catch {
        // Never log raw user profile, token, SQL credentials or JWT payload.
        return null;
      }
    },
  };
}
