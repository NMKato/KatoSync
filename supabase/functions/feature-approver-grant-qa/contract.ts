// NMKato Solutions — KatoSync project feature approver authority protocol.
// One canonical JSON array, byte-identical to Rust owner_authority::grant_signing_bytes.
// No Supabase credentials / network access / user role claims inside this module.
export const protocol = "katosync-project-feature-approver-grant/v1";
export const issuerDomain = "KatoSync owner-approval-grant v1\n";
export const canonicalSupabase = "https://xbnnlyyxiilklsygxcof.supabase.co";
export const leaseMs = 60_000;
export const allowedProject = /^[A-Za-z0-9_.:-]{1,80}$/;
export const allowedUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type Grant = {
 protocol:string;subjectUid:string;projectId:string;role:string;permission:string;
 keyId:string;signingPublicKey:string;grantRevision:number;state:string;
 issuedAtMs:number;expiresAtMs:number;revokedAtMs:number|null;
 issuerSignature:string;
};
export function signingBytes(g:Grant):Uint8Array{
 return new TextEncoder().encode(issuerDomain+JSON.stringify([
  g.protocol,g.subjectUid,g.projectId,g.role,g.permission,g.keyId,
  g.signingPublicKey,g.grantRevision,g.state,g.issuedAtMs,g.expiresAtMs,g.revokedAtMs
 ]));
}
export function bytesToUrlBase64(data:Uint8Array):string{
 let raw="";for(const byte of data)raw+=String.fromCharCode(byte);
 return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
export function urlBase64ToBytes(text:string):Uint8Array{
 if(!/^[A-Za-z0-9_-]{43}$/.test(text))throw new Error("APPROVER_KEY_INVALID");
 const s=text.replace(/-/g,"+").replace(/_/g,"/");
 const binary=atob(s+"=");
 const data=Uint8Array.from(binary,c=>c.charCodeAt(0));
 if(data.length!==32||bytesToUrlBase64(data)!==text)throw new Error("APPROVER_KEY_INVALID");
 return data;
}
// Explicit ArrayBuffer copy: newer TypeScript DOM BufferSource types reject
// Uint8Array<ArrayBufferLike> (e.g. a possible SharedArrayBuffer).
export function exactArrayBuffer(bytes:Uint8Array):ArrayBuffer {
 const buffer=new ArrayBuffer(bytes.byteLength);
 new Uint8Array(buffer).set(bytes);
 return buffer;
}
export async function boundKeyId(raw:string):Promise<string>{
 const bytes=urlBase64ToBytes(raw);
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",exactArrayBuffer(bytes)));
 return "ed25519-sha256:"+Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
}
export function sqlUtc(iso:string|null,nowMs:number):boolean{
 if(!iso)return false;
 const t=Date.parse(iso);
 return Number.isFinite(t)&&t<=nowMs+5000;
}
