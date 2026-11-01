// NMKato Solutions — Stage 3L: synthetic, signed JWT over real 127.0.0.1 HTTP.
// This is NOT Supabase GoTrue or Supabase Edge Gateway. No Cloud requests.
import {createServer} from "node:http";
import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
import type {AddressInfo} from "node:net";
import type {IncomingMessage,ServerResponse} from "node:http";

const ISSUER="katosync-synthetic-loopback-only";
const ROLE="synthetic-local-role-never-cloud";
const MAX_BYTES=16_384;
const base=(obj:unknown)=>Buffer.from(JSON.stringify(obj)).toString("base64url");
type Claims={iss:string;aud:string;sub:string;role:string;session_id:string;iat:number;exp:number};
type ResponseData={status:number;body:unknown};
function fromBearer(req:IncomingMessage):string|null{
 const match=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
  String(req.headers.authorization??""));
 return match?.[1]??null;
}
function send(res:ServerResponse,status:number,value:unknown){
 res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});
 res.end(JSON.stringify(value));
}
async function readBody(req:IncomingMessage):Promise<string>{
 let data="";
 for await(const part of req){
  data+=String(part);
  if(data.length>MAX_BYTES)throw Error("LOCAL_QA_REQUEST_TOO_LARGE");
 }
 return data;
}
export async function startStage3LLoopbackGateway(
 backend:typeof fetch,origin:string,owner:string
){
 // The private key is ephemeral, only in this one local QA process.
 const signingKey=randomBytes(32),counts={http:0,authDenied:0,dbCalls:0};
 const signed=(body:string)=>createHmac("sha256",signingKey).update(body).digest();
 function tokenFor(sub:string,ttlSeconds=90):string{
  const iat=Math.floor(Date.now()/1000);
  const claims:Claims={iss:ISSUER,aud:"authenticated",role:"authenticated",
   sub,session_id:"stage3l-loopback-session",iat,exp:iat+ttlSeconds};
  const body=base({alg:"HS256",typ:"JWT"})+"."+base(claims);
  return body+"."+signed(body).toString("base64url");
 }
 function verify(jwt:string):string|null{
  try{
   const [header,payload,signature,...tail]=jwt.split(".");
   if(tail.length||!header||!payload||!signature)return null;
   const hBytes=Buffer.from(header,"base64url");
   const pBytes=Buffer.from(payload,"base64url");
   const actual=Buffer.from(signature,"base64url");
   // Reject alternate textual encodings of the same bytes. JWT signatures
   // have unused trailing Base64URL bits that must be canonicalized.
   if(hBytes.toString("base64url")!==header||
      pBytes.toString("base64url")!==payload||
      actual.toString("base64url")!==signature)return null;
   const h=JSON.parse(hBytes.toString("utf8"));
   if(h.alg!=="HS256"||h.typ!=="JWT")return null;
   const expected=signed(header+"."+payload);
   if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return null;
   const claims=JSON.parse(pBytes.toString("utf8")) as Claims;
   const now=Math.floor(Date.now()/1000);
   if(claims.iss!==ISSUER||claims.aud!=="authenticated"||claims.role!=="authenticated"||
    !/^[0-9a-f-]{36}$/.test(claims.sub)||claims.session_id!=="stage3l-loopback-session"||
    !Number.isInteger(claims.iat)||!Number.isInteger(claims.exp)||
    claims.iat>now+5||claims.exp<=now||claims.exp>now+120)return null;
   return claims.sub;
  }catch{return null;}
 }
 const server=createServer(async(req,res)=>{
  counts.http++;
  try{
   const requested=new URL(req.url??"/","http://127.0.0.1");
   if(req.socket.remoteAddress!=="127.0.0.1"&&
      req.socket.remoteAddress!=="::ffff:127.0.0.1"){
    send(res,403,{error:"QA_LOOPBACK_ONLY"});return;
   }
   if(requested.pathname==="/auth/v1/user"){
    const jwt=fromBearer(req);
    const subject=jwt?verify(jwt):null;
    if(!subject){counts.authDenied++;send(res,401,{error:"SYNTHETIC_JWT_DENIED"});return;}
    send(res,200,{id:subject,is_anonymous:false});return;
   }
   if(!requested.pathname.startsWith("/rest/v1/")||
     !["GET","POST"].includes(req.method??"")){
    send(res,404,{error:"QA_ROUTE_DENIED"});return;
   }
   if(req.headers.apikey!==ROLE||req.headers.authorization!=="Bearer "+ROLE){
    send(res,403,{error:"QA_PRIVILEGED_REST_DENIED"});return;
   }
   const body=(req.method==="POST")?await readBody(req):undefined;
   const headers:Record<string,string>={
    "Accept-Profile":String(req.headers["accept-profile"]??""),
    "Content-Profile":String(req.headers["content-profile"]??""),
    "Content-Type":String(req.headers["content-type"]??""),
    "apikey":ROLE,"Authorization":"Bearer "+ROLE,
   };
   counts.dbCalls++;
   const response=await backend(origin+requested.pathname+requested.search,
    {method:req.method,headers,body});
   const out=await response.text();
   if(out.length>32_768)throw Error("QA_RESPONSE_EXCESSIVE");
   res.writeHead(response.status,{"content-type":"application/json","cache-control":"no-store"});
   res.end(out);
  }catch{
   send(res,503,{error:"QA_LOCAL_GATEWAY_FAILED"});
  }
 });
 server.listen(0,"127.0.0.1");
 await new Promise<void>((resolve,reject)=>{
  server.once("listening",resolve);server.once("error",reject);
 });
 const address=server.address() as AddressInfo;
 if(!address||address.address!=="127.0.0.1")throw Error("QA_NOT_BOUND_TO_LOOPBACK");
 const listener="http://127.0.0.1:"+address.port;
 const request:typeof fetch=async(resource,init)=>{
  const url=new URL(String(resource));
  if(url.origin!==origin)throw Error("STAGE3L_NO_EXTERNAL_NETWORK");
  return fetch(listener+url.pathname+url.search,init);
 };
 const close=()=>new Promise<void>((resolve,reject)=>{
  server.close(err=>err?reject(err):resolve());
 });
 return {request,tokenFor,counts,close,listener};
}
