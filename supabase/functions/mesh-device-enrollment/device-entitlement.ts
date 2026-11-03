// NMKato Solutions: server-only Mesh device entitlement.
// KatoSync Free has no cloud Mesh. Paid device allowance is granted only by
// a server-managed katosync.mesh_owner_policy row, never by a client tier claim.
const ORIGIN="https://xbnnlyyxiilklsygxcof.supabase.co";
const MAX_BODY=1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MeshDeviceAllowance=
  |{kind:"free";max:0}
  |{kind:"assigned";max:number}
  |{kind:"unavailable";max:0};

export function parseMeshDeviceAllowance(raw:unknown):MeshDeviceAllowance {
  if(!Array.isArray(raw)||raw.length>1)return {kind:"unavailable",max:0};
  // Absence of a server-granted allowance means Free: zero Mesh devices.
  if(raw.length===0)return {kind:"free",max:0};
  const entry=raw[0];
  if(!entry||typeof entry!=="object"||Array.isArray(entry)||
     Object.keys(entry).length!==1||!Object.hasOwn(entry,"allowed_devices"))
    return {kind:"unavailable",max:0};
  const max=(entry as {allowed_devices:unknown}).allowed_devices;
  if(!Number.isInteger(max)||!(typeof max==="number")||max<1||max>10)
    return {kind:"unavailable",max:0};
  return {kind:"assigned",max};
}

export async function readMeshDeviceAllowance(
 owner:string,headers:Record<string,string>,request:typeof fetch=fetch
):Promise<MeshDeviceAllowance>{
  if(!UUID.test(owner))return {kind:"unavailable",max:0};
  const url=new URL(ORIGIN+"/rest/v1/mesh_owner_policy");
  url.searchParams.set("select","allowed_devices");
  url.searchParams.set("owner_user_id","eq."+owner);
  url.searchParams.set("limit","2");
  try{
    const response=await request(url,{
      headers:{...headers,"Accept-Profile":"katosync"},
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)return {kind:"unavailable",max:0};
    if(Number(response.headers.get("content-length"))>MAX_BODY)
      return {kind:"unavailable",max:0};
    const body=await response.text();
    if(body.length>MAX_BODY)return {kind:"unavailable",max:0};
    return parseMeshDeviceAllowance(JSON.parse(body));
  }catch{return {kind:"unavailable",max:0};}
}
