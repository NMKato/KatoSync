// Created by NMKato Solutions.
// Only bundled with VITE_GITHUB_LOGIN_QA=1 and native github-login-qa feature.
// Deliberately has NO project sync, provider workers, agent commands or
// access to the production KatoSync keychain/app-support directory.
import {useEffect,useState,type FormEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {GithubAppConnectionPanel} from "./GithubAppConnectionPanel";

type Session={loggedIn:boolean;email:string|null};

export function GithubLoginQaApp(){
 const [session,setSession]=useState<Session|null>(null);
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 useEffect(()=>{
   document.title="KatoSync GitHub Login QA – ISOLIERT";
   let active=true;
   void invoke<Session>("supabase_session_status")
     .then(result=>{if(active)setSession(result);})
     .catch(()=>{if(active){setError("Test-Sitzung konnte nicht geladen werden.");setSession({loggedIn:false,email:null});}});
   return ()=>{active=false;};
 },[]);
 async function login(event:FormEvent){
   event.preventDefault();
   setBusy(true);setError("");
   try{
     const result=await invoke<Session>("login_supabase",{email:email.trim(),password});
     setSession(result);
     setPassword("");
   }catch{
     setError("KatoSync-Testanmeldung nicht erfolgreich. Bitte Zugangsdaten prüfen.");
     setPassword("");
   }finally{setBusy(false);}
 }
 async function logout(){
   setBusy(true);setError("");
   try{
     const result=await invoke<Session>("logout_supabase");
     setSession(result);
     setPassword("");setEmail("");
   }catch{
     setError("Testabmeldung nicht erfolgreich. Bitte erneut versuchen.");
   }finally{setBusy(false);}
 }
 return <main className="github-login-qa" style={{
   maxWidth:690, margin:"0 auto", padding:"32px 24px",display:"grid",gap:20
 }}>
  <header style={{border:"1px solid #c88a2c",borderRadius:12,padding:18}}>
   <div style={{fontSize:12,fontWeight:750,color:"#ddad6c",letterSpacing:".06em"}}>
    ISOLIERTER QA-BUILD · NICHT PRODUKTIV
   </div>
   <h1 style={{fontSize:24,margin:"9px 0"}}>KatoSync – GitHub-Kontotest</h1>
   <p style={{fontSize:13,lineHeight:1.6,margin:0}}>
    Dieser Test verwendet eigene lokale Daten und eigene Betriebssystem-Schlüsselbund-Einträge.
    Er testet nur die optionale Anmeldung. Repositories, Issues und Kanban-Boards werden nicht verändert.
   </p>
  </header>
  <section style={{border:"1px solid var(--line)",borderRadius:12,padding:18,display:"grid",gap:10}}>
    <h2 style={{fontSize:17,margin:0}}>1. KatoSync-Testkonto</h2>
    {session===null?<p>Anmeldestatus wird geladen …</p>:
     session.loggedIn?<>
      <p style={{fontSize:13}}>Angemeldet als <strong>{session.email??"KatoSync-Benutzer"}</strong></p>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void logout()}>
       KatoSync-Testkonto abmelden
      </button>
     </>:<form onSubmit={e=>void login(e)} style={{display:"grid",gap:10}}>
      <label htmlFor="qa-email" style={{fontSize:12}}>E-Mail des eigenen KatoSync-Kontos</label>
      <input id="qa-email" type="email" autoComplete="username" required
        value={email} onChange={e=>setEmail(e.target.value)} />
      <label htmlFor="qa-password" style={{fontSize:12}}>Passwort</label>
      <input id="qa-password" type="password" autoComplete="current-password" required
        value={password} onChange={e=>setPassword(e.target.value)} />
      <button type="submit" disabled={busy}>{busy?"Anmeldung wird geprüft …":"Bei KatoSync anmelden"}</button>
      <small>Das Passwort wird nur an die bestehende KatoSync-Anmeldung übermittelt und nicht als UI-Protokoll gespeichert.</small>
     </form>}
  </section>
  <section style={{border:"1px solid var(--line)",borderRadius:12,padding:18,display:"grid",gap:11}}>
    <h2 style={{fontSize:17,margin:0}}>2. Eigenes GitHub-Konto verbinden</h2>
    {session?.loggedIn?<>
      <p style={{fontSize:12}}>GitHub ist freiwillig. Bitte die Verbindung in diesem Test ausdrücklich selbst bestätigen.</p>
      <GithubAppConnectionPanel />
    </>:<p style={{fontSize:12}}>Bitte zuerst im getrennten KatoSync-Testkonto anmelden.</p>}
  </section>
  <section style={{border:"1px solid var(--line)",borderRadius:12,padding:18,display:"grid",gap:8}}>
    <h2 style={{fontSize:17,margin:0}}>3. Nach dem Login prüfen</h2>
    <p style={{fontSize:12,margin:0}}>
      Verbundenen GitHub-Namen kontrollieren, Verbindung trennen,
      anschließend KatoSync abmelden. Später folgt der getrennte
      Zwei-Benutzer- und Windows-Test.
    </p>
  </section>
  {error?<p role="alert" style={{color:"#ee966e"}}>{error}</p>:null}
 </main>;
}
