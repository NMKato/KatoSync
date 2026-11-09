// QA-only alternate endpoint. Original SHA-pinned/deployed entrypoint stays byte-identical.
// NOT DEPLOYED: separate human security review & explicit flags required.
// NMKato Solutions — QA relay, disabled unless BOTH original relay gate and
// independently configured entitlement boundary are present. No remote jobs.
import {handleMeshPairingRelay} from "../mesh-pairing-relay/relay.ts";
import {resolveMeshRelayOrigin} from "../mesh-pairing-relay/origin-gate.ts";
import {withFreshMeshEntitlement} from "../mesh-entitlement-boundary-qa/guard.ts";
Deno.serve(req=>{
 const env={
  SUPABASE_URL:Deno.env.get("SUPABASE_URL")??"",
  SUPABASE_ANON_KEY:Deno.env.get("SUPABASE_ANON_KEY")??"",
  SUPABASE_SERVICE_ROLE_KEY:Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",
  KATOSYNC_MESH_PAIRING_RELAY_STAGE:Deno.env.get("KATOSYNC_MESH_PAIRING_RELAY_STAGE")??"",
  KATOSYNC_MESH_RELAY_QA_MODE:Deno.env.get("KATOSYNC_MESH_RELAY_QA_MODE")??"",
  KATOSYNC_MESH_RELAY_QA_PROJECT_REF:Deno.env.get("KATOSYNC_MESH_RELAY_QA_PROJECT_REF")??"",
  DENO_DEPLOYMENT_ID:Deno.env.get("DENO_DEPLOYMENT_ID")??""
 };
 return withFreshMeshEntitlement(req,{
  origin:resolveMeshRelayOrigin(env)??"",
  anonKey:env.SUPABASE_ANON_KEY,serviceKey:env.SUPABASE_SERVICE_ROLE_KEY,
  stage:Deno.env.get("KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE")??""
 },fetch,guarded=>handleMeshPairingRelay(req,env,guarded));
});
