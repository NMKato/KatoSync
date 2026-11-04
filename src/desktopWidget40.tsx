// NMKato Solutions · KatoSync 4.0 detachable desktop widget.
import React,{useCallback,useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {invoke} from "@tauri-apps/api/core";
import {Activity,ArrowUpRight,Bot,Grip,MessageSquare,Minimize2,PlayCircle,ShieldCheck,Workflow} from "lucide-react";
import type {DesktopWidgetSnapshot} from "./lib/desktopWidgetState40.ts";
import {widgetSnapshotFresh} from "./lib/desktopWidgetState40.ts";
import "./desktopWidget40.css";

function Widget(){
  const [snapshot,setSnapshot]=useState<DesktopWidgetSnapshot|null>(null);
  const [showDetails,setShowDetails]=useState(false);
  const [error,setError]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const refresh=useCallback(async()=>{
    try{
      setSnapshot(await invoke<DesktopWidgetSnapshot>("desktop_widget_snapshot"));
      setError(false);
    }catch{
      setError(true);
      setSnapshot(null);
    }
  },[]);
  useEffect(()=>{
    void refresh();
    const id=window.setInterval(()=>void refresh(),8_000);
    return ()=>window.clearInterval(id);
  },[refresh]);
  const fresh=widgetSnapshotFresh(snapshot,Date.now());
  const active=fresh?(snapshot?.activeJobs??0):0;
  const queued=fresh?(snapshot?.queuedJobs??0):0;
  const attention=fresh?(snapshot?.needsAttention??0):0;
  const modelRunning=fresh&&Boolean(snapshot?.localModelRunning);
  const label=!snapshot||error?"Status nicht verfügbar":
    !snapshot.signedIn?"Nicht angemeldet":
    !fresh?"Status veraltet — App öffnen":
    attention>0?"Aktion erforderlich":
    active>0?active===1?"1 Auftrag läuft":`${active} Aufträge laufen`:
    queued>0?`${queued} Aufträge warten`:"Keine aktiven Aufträge";
  const navigate=async(destination:"jobs"|"chat"|"dashboard"|"agent")=>{
    try{await invoke("desktop_widget_open_main",{destination});setError(false);}
    catch{setError(true);}
  };
  return <main className="ks-widget" aria-label="KatoSync Desktop-Widget">
    <header className="ks-widget-header" onMouseDown={e=>{
      if(e.button===0)void invoke("desktop_widget_drag")
        .then(()=>invoke("desktop_widget_save_position"))
        .catch(()=>setError(true));
    }}>
      <div className="ks-widget-mark"><Bot size={17}/></div>
      <div className="ks-widget-heading"><strong>KatoSync</strong><small>Agent Control</small></div>
      <span className="ks-widget-drag" title="Widget verschieben"><Grip size={16}/></span>
      <button type="button" className="ks-widget-close"
        aria-label="Widget ausblenden" title="Widget ausblenden"
        onMouseDown={e=>e.stopPropagation()}
        onClick={()=>void invoke("desktop_widget_hide").catch(()=>setError(true))}>
        <Minimize2 size={16}/>
      </button>
    </header>
    <section className="ks-widget-body" aria-live="polite">
      <div className={"ks-widget-indicator "+(fresh?"current":"stale")}>
        <Activity size={15}/><span>{label}</span>
      </div>
      {fresh?<div className="ks-widget-metrics">
        <span><strong>{active}</strong>aktiv</span>
        <span><strong>{queued}</strong>wartend</span>
        <span className={modelRunning?"model-ready":"model-rest"}><ShieldCheck size={13}/>
          {modelRunning?"Gemma bereit":"Gemma ruht"}
        </span>
      </div>:<p className="ks-widget-note">Zum Aktualisieren KatoSync öffnen.</p>}
      {fresh&&active>0&&snapshot?.taskTitle?<div className="ks-widget-task">
        {showDetails?<span title={snapshot.taskTitle}>{snapshot.taskTitle}</span>:
          <span>Jobdetails ausgeblendet</span>}
        <button type="button" onClick={()=>setShowDetails(v=>!v)}>
          {showDetails?"Verbergen":"Details"}
        </button>
      </div>:null}
    </section>
    {expanded?<nav className="ks-widget-quick" aria-label="Schnellauswahl">
      <button type="button" onClick={()=>void navigate("jobs")}><Workflow size={14}/>Jobs</button>
      <button type="button" onClick={()=>void navigate("chat")}><MessageSquare size={14}/>Chat</button>
      <button type="button" onClick={()=>void navigate("agent")}><Bot size={14}/>Agenten</button>
    </nav>:null}
    <footer className="ks-widget-footer">
      <button type="button" className="ks-widget-secondary" onClick={()=>setExpanded(v=>!v)}>
        <PlayCircle size={15}/>{expanded?"Schließen":"Schnellauswahl"}
      </button>
      <button type="button" className="ks-widget-primary" onClick={()=>void navigate("dashboard")}>
        Mehr <ArrowUpRight size={15}/>
      </button>
    </footer>
  </main>;
}
const root=document.getElementById("root");
if(root)createRoot(root).render(<React.StrictMode><Widget/></React.StrictMode>);
