// Native Deno 2.9.6 QA: the NEW index registers, remains default-off,
// never opens a port, and rejects bearer-only and production targeting.
// No --allow-net, no real keys, no production project access.
const ref="abcdefghijklmnopqrst";
const e={
 SUPABASE_URL:"https://"+ref+".supabase.co",
 SUPABASE_ANON_KEY:"fake-public-only-012345678901234",
 SUPABASE_SERVICE_ROLE_KEY:"fake-private-only-0123456789012",
 KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:"",
 KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:ref
};
for(const [k,v] of Object.entries(e))Deno.env.set(k,v);
type Handler=(r:Request)=>Promise<Response>;
const captured:Handler[]=[];
const original=Deno.serve;
(Deno as unknown as {serve:(handler:Handler)=>unknown}).serve=handler=>{
 captured.push(handler);return {finished:Promise.resolve(),shutdown:()=>{}};
};
try{
 await import("../../supabase/functions/mesh-inbox-terminal-owner-qa/index.ts");
}finally{(Deno as unknown as {serve:typeof Deno.serve}).serve=original;}
if(captured.length!==1)throw Error("NO_SINGLE_DENO_QA_HANDLER");
const actual=captured[0];
Deno.test("actual Deno owner-cancel index is default-off without network",async()=>{
 const response=await actual(new Request("https://qa.test/terminal",{
  method:"POST",headers:{"authorization":"Bearer "+"a".repeat(30)+"."+"b".repeat(30)+"."+"c".repeat(30),
    "content-type":"application/json"},
  body:JSON.stringify({action:"cancel",requestId:"33333333-3333-4333-8333-333333333333"})
 }));
 if(response.status!==503||(await response.json()).error!=="INBOX_TERMINAL_QA_DISABLED")
  throw Error("DENO_OWNER_TERMINAL_DEFAULT_DENY_FAILED");
});
Deno.test("native Deno handler rejects real KATOOS project even with QA stage",async()=>{
 const {handleInboxTerminalOwnerQA}=await import(
  "../../supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts");
 const response=await handleInboxTerminalOwnerQA(new Request("https://qa.test/terminal",{
  method:"POST",headers:{"authorization":"Bearer "+"a".repeat(30)+"."+"b".repeat(30)+"."+"c".repeat(30),
    "content-type":"application/json"},
  body:JSON.stringify({action:"cancel",requestId:"33333333-3333-4333-8333-333333333333"})
 }),{...e,SUPABASE_URL:"https://xbnnlyyxiilklsygxcof.supabase.co",
  KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:"qa-cancel-only",
  KATOSYNC_INBOX_TERMINAL_OWNER_PROJECT_REF:"xbnnlyyxiilklsygxcof"},{
  fetcher:async()=>{throw Error("NO NETWORK");}
 });
 if(response.status!==503)throw Error("DENO_OWNER_TERMINAL_LIVE_ACCEPTED");
});
Deno.test("native Deno owner cancellation cannot be a service-key bearer",async()=>{
 const {handleInboxTerminalOwnerQA}=await import(
  "../../supabase/functions/mesh-inbox-terminal-owner-qa/handler.ts");
 const response=await handleInboxTerminalOwnerQA(new Request("https://qa.test/terminal",{
  method:"POST",headers:{"authorization":"Bearer "+e.SUPABASE_SERVICE_ROLE_KEY,
    "content-type":"application/json"},
  body:JSON.stringify({action:"cancel",requestId:"33333333-3333-4333-8333-333333333333"})
 }),{...e,KATOSYNC_INBOX_TERMINAL_OWNER_STAGE:"qa-cancel-only"},{
  fetcher:async()=>{throw Error("NO NETWORK");}
 });
 if(response.status!==401)throw Error("DENO_OWNER_TERMINAL_SERVICE_BEARER_ACCEPTED");
});
