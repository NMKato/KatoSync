// NMKato Solutions — synthetic-only two-Mac QA recipient identity pin.
// Does not create trust, read Keychain, grant work, or accept unverified peers.
import {createPrivateKey,createPublicKey,timingSafeEqual} from "node:crypto";
import {readFileSync,lstatSync,realpathSync} from "node:fs";
import {dirname} from "node:path";

const PREFIX="302a300506032b6570032100";
const PATH=/^\/(?:private\/)?tmp\/ksmesh2uclient\.[a-zA-Z0-9]{6}\/key\.pem$/;

export function canonicalRecipientKey(value){
 if(typeof value!=="string"||!/^[a-zA-Z0-9_-]{43}$/.test(value))return null;
 const b=Buffer.from(value,"base64url");
 return b.length===32&&b.toString("base64url")===value?b:null;
}
export function sameApprovedRecipientKey(actual,expected){
 const a=canonicalRecipientKey(actual),b=canonicalRecipientKey(expected);
 return Boolean(a&&b&&timingSafeEqual(a,b));
}
export function readPrivateRecipientFixture(path){
 // Only a disposable single-use PEM created on the test client's own Mac.
 // Never accept user home / production key paths, even for synthetic QA.
 try{
  if(typeof path!=="string"||!PATH.test(path))throw Error("PATH");
  const target=realpathSync(path);
  if(!PATH.test(target))throw Error("REALPATH");
  const meta=lstatSync(target),parent=lstatSync(dirname(target));
  if(!meta.isFile()||meta.isSymbolicLink()||
     meta.size<100||meta.size>4096||(meta.mode&0o077)!==0||
     !parent.isDirectory()||(parent.mode&0o077)!==0)throw Error("MODE");
  const privateKey=createPrivateKey(readFileSync(target));
  if(privateKey.asymmetricKeyType!=="ed25519")throw Error("KEY_TYPE");
  const publicKey=createPublicKey(privateKey);
  const der=publicKey.export({format:"der",type:"spki"});
  if(der.length!==44||der.subarray(0,12).toString("hex")!==PREFIX)
   throw Error("PUBLIC_DER");
  const publicRaw=der.subarray(-32).toString("base64url");
  if(!canonicalRecipientKey(publicRaw))throw Error("PUBLIC_INVALID");
  return {privateKey,publicRaw};
 }catch{
  throw Error("MESH_TWO_HOST_QA_DISPOSABLE_RECIPIENT_KEY_REQUIRED");
 }
}
