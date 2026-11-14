// RC66: typed *server-verified* Remote MCP consent snapshot for owner review.
// Presentation-only: consent is granted/revoked only by a separate trusted server.
export type Rc66GrantState = "pending" | "approved" | "revoked";
export type Rc66ReadTool = "devices.list" | "device.status";
export type Rc66ConsentAction =
  "approve_client" | "revoke_client" | "approve_device" | "revoke_device";

export interface Rc66ConsentSnapshot {
  version: 1;
  live: true;
  source: "katosync-remote-mcp-consent";
  ownerVerified: true;
  revision: string;
  observedAt: string;
  client: {
    oauthClientId: string;
    displayName: string;
    status: Rc66GrantState;
    allowedTools: Rc66ReadTool[];
    expiresAt: string;
  } | null;
  devices: Array<{
    deviceId: string;
    displayName: string;
    status: Rc66GrantState;
    expiresAt: string | null;
  }>;
}
export interface Rc66ConsentIntent {
  version: 1;
  action: Rc66ConsentAction;
  expectedRevision: string;
  oauthClientId: string;
  deviceId: string | null;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const REVISION = /^[A-Za-z0-9_-]{12,96}$/;
const DISPLAY = /^[^\x00-\x1f\x7f]{1,80}$/;
const STATES: Set<unknown> = new Set(["pending","approved","revoked"]);
const READ_TOOLS: Set<unknown> = new Set(["devices.list","device.status"]);
const ACTIONS: Set<unknown> = new Set(["approve_client","revoke_client","approve_device","revoke_device"]);
const exactKeys = (value: Record<string,unknown>, keys: string[]): boolean =>
  Object.keys(value).length===keys.length && keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
const object = (v: unknown): v is Record<string,unknown> =>
  !!v && typeof v==="object" && !Array.isArray(v);
const instant = (v: unknown): number =>
  typeof v==="string" && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v)
    ? Date.parse(v) : Number.NaN;
const validTools = (v: unknown): boolean =>
  Array.isArray(v) && v.length>0 && v.length<=2 &&
  new Set(v).size===v.length && v.every(x=>READ_TOOLS.has(x));
const expiry = (v: unknown, nowMs: number, status: unknown): boolean =>
  Number.isFinite(instant(v)) &&
  (status!=="approved" || instant(v)>nowMs);

export function parseRc66ConsentSnapshot(
  value: unknown, nowMs = Date.now()
): Rc66ConsentSnapshot | null {
  if (!object(value) || value.version!==1 || value.live!==true ||
    value.source!=="katosync-remote-mcp-consent" ||
    value.ownerVerified!==true || !Number.isFinite(nowMs) ||
    typeof value.revision!=="string" || !REVISION.test(value.revision) ||
    !Number.isFinite(instant(value.observedAt)) ||
    instant(value.observedAt)>nowMs+5000 ||
    nowMs-instant(value.observedAt)>60000 ||
    !Array.isArray(value.devices) || value.devices.length>50 ||
    !exactKeys(value,["version","live","source","ownerVerified","revision","observedAt","client","devices"])) return null;

  const client=value.client;
  if (client!==null && (
    !object(client) ||
    !exactKeys(client,["oauthClientId","displayName","status","allowedTools","expiresAt"]) ||
    typeof client.oauthClientId!=="string" ||
    !CLIENT_ID.test(client.oauthClientId) ||
    typeof client.displayName!=="string" || !DISPLAY.test(client.displayName) ||
    !STATES.has(client.status) || !validTools(client.allowedTools) ||
    !expiry(client.expiresAt,nowMs,client.status))) return null;
  if (client===null && value.devices.length!==0) return null;

  const seen=new Set<string>();
  for(const device of value.devices){
    if (!object(device) ||
      !exactKeys(device,["deviceId","displayName","status","expiresAt"]) ||
      typeof device.deviceId!=="string" ||
      !UUID.test(device.deviceId) || seen.has(device.deviceId) ||
      typeof device.displayName!=="string" || !DISPLAY.test(device.displayName) ||
      !STATES.has(device.status) ||
      (device.status==="approved" &&
        (client===null || client.status!=="approved")) ||
      (device.expiresAt===null && device.status==="approved") ||
      (device.expiresAt!==null &&
        !expiry(device.expiresAt,nowMs,device.status))) return null;
    seen.add(device.deviceId);
  }
  return value as unknown as Rc66ConsentSnapshot;
}

// This is ONLY an owner-visible review intent. No privileges or tokens are
// minted here. Server rechecks session, step-up, tenant, owner, scope, revision,
// expiry, device proof, signed receipt and idempotency before any persistence.
export function makeRc66ConsentIntent(
  snapshot: Rc66ConsentSnapshot,
  action: Rc66ConsentAction,
  deviceId: string|null = null,
  nowMs = Date.now()
): Rc66ConsentIntent | null {
  if (!ACTIONS.has(action) ||
      !parseRc66ConsentSnapshot(snapshot,nowMs) || !snapshot.client) return null;
  const c=snapshot.client;
  const isDevice=action==="approve_device" || action==="revoke_device";
  const d=isDevice ? snapshot.devices.find(x=>x.deviceId===deviceId) : null;
  if ((isDevice && !d) || (!isDevice && deviceId!==null)) return null;
  if (action==="approve_client" && c.status!=="pending") return null;
  if (action==="revoke_client" && c.status!=="approved") return null;
  if (action==="approve_device" &&
    (c.status!=="approved" || d?.status!=="pending")) return null;
  if (action==="revoke_device" && d?.status!=="approved") return null;
  return Object.freeze({
    version:1,action,expectedRevision:snapshot.revision,
    oauthClientId:c.oauthClientId,deviceId:isDevice?deviceId:null
  });
}
