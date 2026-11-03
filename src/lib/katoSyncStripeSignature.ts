// NMKato Solutions — verified Stripe webhook ingress helper.
// The server must read Request.arrayBuffer() BEFORE parsing JSON.
// All Stripe API secrets and signing secrets remain inside the server's secret vault.
const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_HEADER_CHARS = 512;
const MAX_AGE_SECONDS = 300;
const utf8 = new TextEncoder();
function hexToBytes(hex: string): Uint8Array | null {
  if(!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const value = new Uint8Array(32);
  for(let i=0;i<32;i++) value[i]=parseInt(hex.slice(i*2,i*2+2),16);
  return value;
}
function safeEqual(a:Uint8Array,b:Uint8Array):boolean {
  if(a.length!==b.length)return false;
  let mismatch=0;
  for(let i=0;i<a.length;i++)mismatch|=(a[i]^b[i]);
  return mismatch===0;
}
/** Verifies Stripe's v1 HMAC over timestamp.raw_body; returns false on all malformed input. */
export async function verifyKatoSyncStripeWebhook(input:{
  rawBody:Uint8Array;
  signatureHeader:string|null;
  signingSecret:string;
  nowSeconds:number;
}):Promise<boolean>{
  const {rawBody,signatureHeader,signingSecret,nowSeconds}=input;
  if(!(rawBody instanceof Uint8Array)||rawBody.length===0||rawBody.length>MAX_EVENT_BYTES ||
     typeof signatureHeader!=="string"||signatureHeader.length>MAX_HEADER_CHARS ||
     typeof signingSecret!=="string"||!signingSecret.startsWith("whsec_")||
     !Number.isSafeInteger(nowSeconds))return false;
  const chunks=signatureHeader.split(",");
  const timeParts=chunks.filter(item=>item.trim().startsWith("t="));
  const hashParts=chunks.filter(item=>item.trim().startsWith("v1="));
  if(timeParts.length!==1||hashParts.length<1||hashParts.length>4) return false;
  const t=timeParts[0].trim().slice(2);
  if(!/^[0-9]{10,11}$/.test(t))return false;
  const ts=Number(t);
  if(Math.abs(nowSeconds-ts)>MAX_AGE_SECONDS)return false;
  const candidates=hashParts.map(x=>hexToBytes(x.trim().slice(3)));
  if(candidates.some(x=>x===null))return false;
  const prefix=utf8.encode(t+".");
  const signed=new Uint8Array(prefix.length+rawBody.length);
  signed.set(prefix);
  signed.set(rawBody,prefix.length);
  try{
    const key=await crypto.subtle.importKey("raw",utf8.encode(signingSecret),
      {name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,signed));
    return candidates.some(candidate=>safeEqual(digest,candidate!));
  }catch{return false;}
}
