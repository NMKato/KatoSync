// KatoSync Stage4E — ACTUAL Deno runtime executes five isolated QA indexes.
// Strict no-network permission; Deno.serve is intercepted before imports.
// Never starts an HTTP listener or loads KATOOS secrets.
const keys={
 SUPABASE_URL:"https://xbnnlyyxiilklsygxcof.supabase.co", // origin pin only; Deno --deny-net
 SUPABASE_ANON_KEY:"only-synthetic-anon-1234567890123456789",
 SUPABASE_SERVICE_ROLE_KEY:"only-synthetic-service-123456789012345",
 KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE:"",
 KATOSYNC_MESH_INBOX_STAGE:"send-only",
 KATOSYNC_MESH_INBOX_RECEIVE_STAGE:"qa-inbox",
 KATOSYNC_MESH_PAIRING_RELAY_STAGE:"qa-relay",
 KATOSYNC_MESH_ENROLLMENT_STAGE:"challenge-and-discovery",
 KATOSYNC_MESH_RELAY_QA_MODE:"",
 KATOSYNC_MESH_RELAY_QA_PROJECT_REF:"",
 DENO_DEPLOYMENT_ID:""
};
for(const [key,value] of Object.entries(keys))Deno.env.set(key,value);
type RequestHandler=(req:Request)=>Promise<Response>;
const registered:RequestHandler[]=[];
const realServe=Deno.serve;
// Deno.serve has a configurable setter in Deno 2.9.6. The mock is installed
// before ANY QA index module import, so no port/listener ever opens.
(Deno as unknown as {serve:(handler:RequestHandler)=>unknown}).serve=(handler)=>{
 registered.push(handler);
 return {finished:Promise.resolve(),shutdown:()=>{}};
};
try{
 await import("../../supabase/functions/mesh-device-enrollment-entitled-qa/index.ts");
 await import("../../supabase/functions/mesh-device-presence-qa-entitled-qa/index.ts");
 await import("../../supabase/functions/mesh-inbox-send-entitled-qa/index.ts");
 await import("../../supabase/functions/mesh-inbox-receive-entitled-qa/index.ts");
 await import("../../supabase/functions/mesh-pairing-relay-entitled-qa/index.ts");
}finally{
 (Deno as unknown as {serve:typeof Deno.serve}).serve=realServe;
}
if(registered.length!==5)
 throw Error("KATOSYNC_DENO_QA_EXPECTED_FIVE_CAPTURED_HANDLERS");
function requireResult(ok:boolean,label:string){
 if(!ok)throw Error("KATOSYNC_DENO_QA_FAILURE_"+label);
}
for(let i=0;i<registered.length;i++){
 Deno.test("native Deno actual QA index "+String(i+1)+" is off by default",async()=>{
  const r=await registered[i](new Request("https://qa.test/signed-mesh",{method:"POST",
   headers:{authorization:"Bearer "+"n".repeat(60),"content-type":"application/json"},
   body:"{}"}));
  requireResult(r.status===503,"OFF_"+i);
  requireResult((await r.json()).error==="MESH_BOUNDARY_DISABLED","ERROR_"+i);
 });
}
Deno.test("native Deno actual QA indexes deny missing bearer after explicit QA flag",async()=>{
 Deno.env.set("KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE","qa-entitlement-boundary");
 for(const [i,handler] of registered.entries()){
  const r=await handler(new Request("https://qa.test/signed-mesh",{method:"POST",
   headers:{"content-type":"application/json"},body:"{}"}));
  requireResult(r.status===401,"NO_AUTH_"+i);
  requireResult((await r.json()).error==="LOGIN_REQUIRED","NO_AUTH_ERROR_"+i);
 }
 Deno.env.set("KATOSYNC_MESH_ENTITLEMENT_BOUNDARY_STAGE","");
});
