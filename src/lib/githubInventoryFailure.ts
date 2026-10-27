// Created by NMKato Solutions
// Controlled categories; never display raw provider errors or tokens.
export type InventoryFailure = "auth"|"permission"|"missing"|"rate"|"network"|"session"|"unreadable"|"unknown";
export function classifyGithubInventoryFailure(error:unknown):InventoryFailure {
 const raw=typeof error==="string"?error:error instanceof Error?error.message:"";
 const match=/^GH_INV_(installations|repositories|issues)_HTTP_(401|403|404|429)$/.exec(raw);
 if(match) {
  switch(match[2]){
   case "401":return "auth";
   case "403":return "permission";
   case "404":return "missing";
   case "429":return "rate";
  }
 }
 if(/GitHub API derzeit nicht erreichbar|Netzwerk|zeitüberschreitung|timeout/i.test(raw))return "network";
 if(/Sitzung|anmelden|KatoSync.Konto|Konto während/i.test(raw))return "session";
 if(/Schlüsselbund|Keychain/i.test(raw))return "unreadable";
 return "unknown";
}
