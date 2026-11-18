// QA-only alternate endpoint. Original SHA-pinned/deployed entrypoint stays byte-identical.
// NOT DEPLOYED: separate human security review & explicit flags required.
// NMKato Solutions — QA-only signed presence; fresh Pro/Trial admission
// before signed heartbeat status writes. No trusted-peer or remote-job grant.
import {handleSignedMeshHeartbeat} from "../mesh-device-presence-qa/heartbeat.ts";
import {withFreshMeshEntitlement,MESH_ENTITLEMENT_QA_ORIGIN} from "../mesh-entitlement-boundary-qa/guard.ts";
Deno.serve(req=>{
 const env={
  SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
  SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
  KATOSYNC_MESH_ENROLLMENT_STAGE:Deno.env.get("KATOSYNC_MESH_ENROLLMENT_STAGE")??""
 };
 return withFreshMeshEntitlement(req,{
  origin:env.SUPABASE_URL===MESH_ENTITLEMENT_QA_ORIGIN?env.SUPABASE_URL:"",
  anonKey:env.SUPABASE_ANON_KEY,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,
  stage:Deno.env.get("KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE")??""
 },fetch,guarded=>handleSignedMeshHeartbeat(req,env,guarded));
});
