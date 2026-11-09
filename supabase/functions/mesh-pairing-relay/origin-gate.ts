// NMKato Solutions — Stage 3M. Mesh Relay must never cross auth tenants.
// Cloud preview is not enabled by default; no online deployment in this stage.
export const MESH_LIVE_ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
type OriginEnv={
 SUPABASE_URL:string;
 KATOSYNC_MESH_RELAY_QA_MODE?:string;
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF?:string;
 DENO_DEPLOYMENT_ID?:string;
};
const REF=/^[a-z0-9]{20}$/;
const DEPLOY=/^([a-z0-9]{20})_([a-f0-9-]{36})_([1-9][0-9]*)$/;
export function resolveMeshRelayOrigin(e:OriginEnv):string|null{
 if(e.SUPABASE_URL===MESH_LIVE_ORIGIN){
  // QA override may not be set on production; never silently mix origins.
  return e.KATOSYNC_MESH_RELAY_QA_MODE||e.KATOSYNC_MESH_RELAY_QA_PROJECT_REF?null:MESH_LIVE_ORIGIN;
 }
 if(e.KATOSYNC_MESH_RELAY_QA_MODE!=="isolated-preview-only")return null;
 const ref=e.KATOSYNC_MESH_RELAY_QA_PROJECT_REF;
 if(!ref||!REF.test(ref)||ref==="xbnnlyyxiilklsygxcof")return null;
 const wanted="https://"+ref+".supabase.co";
 // No subdomains, custom endpoints, redirects, paths, fragments or ports.
 if(e.SUPABASE_URL!==wanted)return null;
 const deployment=e.DENO_DEPLOYMENT_ID??"";
 const match=DEPLOY.exec(deployment);
 if(!match||match[1]!==ref)return null;
 return wanted;
}
