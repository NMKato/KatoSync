// Created by NMKato Solutions
// A verified Supabase/KATOOS auth session is NOT a KatoSync membership.
// Server-only allowlist, no self-enrollment, no fallback on network failures.
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const SCHEMA="katosync";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemberGate="active"|"not_member"|"unavailable";

export function evaluateMembership(raw:unknown,uid:string,now=Date.now()):MemberGate {
 if(!UUID.test(uid)||!Array.isArray(raw)||raw.length>1)return "unavailable";
 if(raw.length!==1)return "not_member";
 const r=raw[0] as {user_id?:unknown;access_state?:unknown;authorized_at?:unknown;revoked_at?:unknown};
 if(!r||typeof r!=="object"||r.user_id!==uid)return "unavailable";
 if(!["pending","active","suspended","revoked"].includes(String(r.access_state)))return "unavailable";
 if(r.access_state!=="active")return "not_member";
 if(r.revoked_at!==null||typeof r.authorized_at!=="string")return "unavailable";
 const at=Date.parse(r.authorized_at);
 if(!Number.isFinite(at)||at>now+5000)return "unavailable";
 return "active";
}

export async function requireKatoSyncMembership(
 uid:string, headers:{apikey:string;Authorization:string}, request:typeof fetch=fetch
):Promise<MemberGate>{
 if(!UUID.test(uid))return "unavailable";
 const url=new URL(ORIGIN+"/rest/v1/account_memberships");
 url.searchParams.set("select","user_id,access_state,authorized_at,revoked_at");
 url.searchParams.set("user_id","eq."+uid);
 url.searchParams.set("limit","2");
 try{
  const response=await request(url,{
    headers:{...headers,"Accept-Profile":SCHEMA},
    signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)return "unavailable";
  const raw=await response.text();
  if(raw.length>2048)return "unavailable";
  return evaluateMembership(JSON.parse(raw),uid);
 }catch{return "unavailable";}
}
