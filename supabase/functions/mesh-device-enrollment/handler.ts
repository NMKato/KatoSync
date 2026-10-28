// NMKato Solutions — Stage A: online owner-verified, server-only device challenges.
// No enrollment, peer trust, key exchange or remote control in this stage.
const ORIGIN = "https://xbnnlyyxiilklsygxcof.supabase.co";
const KEY = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = {"content-type":"application/json","cache-control":"no-store"};
type Env = {SUPABASE_URL:string;SUPABASE_ANON_KEY:string;SUPABASE_SERVICE_ROLE_KEY:string;KATOSYNC_MESH_ENROLLMENT_STAGE:string};
const fail=(code:string,status:number)=>new Response(JSON.stringify({error:code}),{status,headers:JSON_HEADERS});
const toBase64Url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
export async function handleMeshEnrollmentChallenge(req:Request,env:Env,request:typeof fetch=fetch):Promise<Response>{
  if(req.method!=="POST")return fail("METHOD_NOT_ALLOWED",405);
  // Explicit QA deployment gate; never accidentally turn on enrollment.
  if(!["challenge-only","challenge-and-discovery"].includes(env.KATOSYNC_MESH_ENROLLMENT_STAGE) || env.SUPABASE_URL!==ORIGIN)
    return fail("MESH_ENROLLMENT_NOT_CONFIGURED",503);
  if(!env.SUPABASE_ANON_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)
    return fail("MESH_ENROLLMENT_NOT_CONFIGURED",503);
  const bearer=req.headers.get("authorization")??"";
  if(!/^Bearer [A-Za-z0-9_.-]{30,8192}$/.test(bearer))return fail("LOGIN_REQUIRED",401);
  if(!req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return fail("BAD_REQUEST",400);
  let body:unknown;
  try{
    const raw=await req.text();
    if(raw.length>1024)return fail("BAD_REQUEST",400);
    body=JSON.parse(raw);
  }catch{return fail("BAD_REQUEST",400);}
  if(!body||typeof body!=="object"||Array.isArray(body)||
      Object.keys(body).length!==1||typeof (body as Record<string,unknown>).publicKey!=="string"||
      !KEY.test((body as {publicKey:string}).publicKey))return fail("BAD_PUBLIC_KEY",400);
  const publicKey=(body as {publicKey:string}).publicKey;
  try{
    // Online issuer proof, not a locally decoded JWT or caller-supplied user ID.
    const auth=await request(ORIGIN+"/auth/v1/user",{
      headers:{Authorization:bearer,apikey:env.SUPABASE_ANON_KEY},signal:AbortSignal.timeout(8000)
    });
    if(!auth.ok)return fail("LOGIN_REQUIRED",401);
    const account=await auth.json() as {id?:unknown;is_anonymous?:unknown};
    if(typeof account.id!=="string"||!UUID.test(account.id)||account.is_anonymous===true)
      return fail("LOGIN_REQUIRED",401);
    const owner=account.id;
    const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY};
    // Per-owner fixed-window upper bound, not only a per-key throttle.
    const since=new Date(Date.now()-60_000).toISOString();
    const url=new URL(ORIGIN+"/rest/v1/katosync_mesh_enrollment_challenges");
    url.searchParams.set("select","challenge_id");
    url.searchParams.set("owner_user_id","eq."+owner);
    url.searchParams.set("created_at","gte."+since);
    url.searchParams.set("limit","3");
    const recent=await request(url,{headers,signal:AbortSignal.timeout(8000)});
    if(!recent.ok)return fail("MESH_REGISTRY_UNAVAILABLE",503);
    const rows:unknown=await recent.json();
    if(!Array.isArray(rows)||rows.length>3)return fail("MESH_REGISTRY_UNAVAILABLE",503);
    if(rows.length>=3)return fail("RATE_LIMIT",429);
    const nonce=toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt=new Date(Date.now()+90_000).toISOString();
    const created=await request(ORIGIN+"/rest/v1/katosync_mesh_enrollment_challenges",{
      method:"POST",headers:{...headers,"content-type":"application/json",Prefer:"return=representation"},
      body:JSON.stringify({owner_user_id:owner,signing_public_key:publicKey,nonce,expires_at:expiresAt}),
      signal:AbortSignal.timeout(8000)
    });
    if(!created.ok)return fail("MESH_REGISTRY_UNAVAILABLE",503);
    const inserted:unknown=await created.json();
    if(!Array.isArray(inserted)||inserted.length!==1||typeof inserted[0]?.challenge_id!=="string"||
        !UUID.test(inserted[0].challenge_id))return fail("MESH_REGISTRY_UNAVAILABLE",503);
    return new Response(JSON.stringify({
      protocol:"katosync-mesh-enrollment-challenge-v1",
      challengeId:inserted[0].challenge_id,nonce,publicKey,expiresAt,
      discoveryOnly:true,paired:false,transportReady:false
    }),{status:200,headers:JSON_HEADERS});
  }catch{return fail("MESH_REGISTRY_UNAVAILABLE",503);}
}
