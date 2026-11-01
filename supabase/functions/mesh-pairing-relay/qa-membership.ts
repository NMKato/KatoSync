// NMKato Solutions — Stage 3M: isolated Relay-only membership adapter.
// Keep the SHA-pinned Inbox/Enrollment membership-gate source untouched.
import {requireKatoSyncMembership,evaluateMembership,type MemberGate} from
 "../mesh-device-enrollment/membership-gate.ts";
import {MESH_LIVE_ORIGIN} from "./origin-gate.ts";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QA_ORIGIN=/^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
export async function requireMeshRelayMembership(
 uid:string,headers:{apikey:string;Authorization:string},request:typeof fetch,origin:string
):Promise<MemberGate>{
 if(origin===MESH_LIVE_ORIGIN)return requireKatoSyncMembership(uid,headers,request);
 if(!UUID.test(uid)||!QA_ORIGIN.test(origin))return "unavailable";
 const url=new URL(origin+"/rest/v1/account_memberships");
 url.searchParams.set("select","user_id,access_state,authorized_at,revoked_at");
 url.searchParams.set("user_id","eq."+uid);
 url.searchParams.set("limit","2");
 try{
  const response=await request(url,{method:"GET",headers:{...headers,"Accept-Profile":"katosync"},
   redirect:"error",signal:AbortSignal.timeout(8000)});
  if(!response.ok)return "unavailable";
  const raw=await response.text();
  if(raw.length>2048)return "unavailable";
  return evaluateMembership(JSON.parse(raw),uid);
 }catch{return "unavailable";}
}
