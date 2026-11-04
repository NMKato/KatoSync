// MARK: KatoSync 4.0 — Kato AI glass desktop widget (QA preview only).
// Uses the product-owned KAI emblem. Never displays fictitious task progress.
import React,{useCallback,useEffect,useState} from "react";
import {createRoot} from "react-dom/client";
import {invoke} from "@tauri-apps/api/core";
import {
  Activity,AlertCircle,ArrowUpRight,CheckCircle2,ChevronDown,
  ChevronUp,Clock3,Cpu,Grip,Layers3,
  Minimize2,RefreshCw,ShieldCheck,Workflow
} from "lucide-react";
import type {DesktopWidgetSnapshot} from "./lib/desktopWidgetState40.ts";
import {widgetSnapshotFresh} from "./lib/desktopWidgetState40.ts";
import "./desktopWidget40.css";

const KAI_ICON="/kai-ai-icon.png";

function KaiEmblem({small=false}:{small?:boolean}){
  return <img className={small?"kai-emblem kai-emblem-small":"kai-emblem"}
    src={KAI_ICON} alt="Kato AI – KAI-Symbol" draggable={false}/>;
}

function Widget(){
  const [snapshot,setSnapshot]=useState<DesktopWidgetSnapshot|null>(null);
  const [expanded,setExpanded]=useState(false);
  const [showDetails,setShowDetails]=useState(false);
  const [error,setError]=useState(false);
  const [resizing,setResizing]=useState(false);

  const refresh=useCallback(async()=>{
    try {
      setSnapshot(await invoke<DesktopWidgetSnapshot>("desktop_widget_snapshot"));
      setError(false);
    } catch {
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
  const signedIn=Boolean(snapshot?.signedIn);
  const privateTask=fresh&&active>0?snapshot?.taskTitle:null;
  const jobHeadline=error||!snapshot?"Keine aktuellen Statusdaten":
    !signedIn?"KATOOS-Anmeldung erforderlich":
    !fresh?"Status veraltet – KatoSync öffnen":
    attention>0?"Ein Auftrag benötigt Aufmerksamkeit":
    active>0?active===1?"Ein Auftrag wird bearbeitet":`${active} Aufträge werden bearbeitet`:
    queued>0?"Aufträge warten auf Bearbeitung":"Alle Aufgaben im Blick";

  const navigate=async(destination:"jobs"|"chat"|"dashboard"|"agent")=>{
    try {await invoke("desktop_widget_open_main",{destination});setError(false);}
    catch {setError(true);}
  };
  const toggleDetails=()=>setShowDetails(v=>!v);
  const toggleExpanded=async()=>{
    if(resizing)return;
    setResizing(true);
    try{
      const next=!expanded;
      await invoke("desktop_widget_set_expanded",{expanded:next});
      setExpanded(next);
      setError(false);
    }catch{
      setError(true);
    }finally{
      setResizing(false);
    }
  };
  const startDragging=(button:number)=>{
    if(button!==0)return;
    void invoke("desktop_widget_drag")
      .then(()=>invoke("desktop_widget_save_position"))
      .catch(()=>setError(true));
  };

  return <main className={expanded?"kai-widget kai-widget-expanded":"kai-widget"}
      aria-label="Kato AI Desktop-Widget">
    <header className="kai-header" onMouseDown={e=>startDragging(e.button)}>
      <KaiEmblem/>
      <div className="kai-title">
        <strong>Kato <span>AI</span> <i>/</i> <em>KatoSync</em></strong>
        <small>LOCAL AI <span>·</span> TASKS <span>·</span> SYNC</small>
      </div>
      <div className={fresh?"kai-connection connected":"kai-connection idle"}
        aria-label={fresh?"KatoSync-Status aktuell":"Status nicht bestätigt"}>
        <span className="kai-status-dot"/>{fresh?"Aktuell":"Warten"}
      </div>
      <span className="kai-drag-hint" aria-hidden="true"><Grip size={15}/></span>
      <button type="button" className="kai-window-button" title="Widget ausblenden"
        aria-label="Widget ausblenden" onMouseDown={e=>e.stopPropagation()}
        onClick={()=>void invoke("desktop_widget_hide").catch(()=>setError(true))}>
        <Minimize2 size={15}/>
      </button>
    </header>

    <section className="kai-job-panel" aria-label="Aktueller Auftrag">
      <div className="kai-section-caption">
        <Workflow size={13}/><span>AKTUELLER JOB</span>
        {fresh&&active>0?<span className="kai-live-tag"><span/>AKTIV</span>:null}
      </div>
      <div className="kai-job-row">
        <div className="kai-job-symbol"><Layers3 size={23}/></div>
        <div className="kai-job-content">
          <strong>{jobHeadline}</strong>
          <small>{fresh?
            active>0?"Live-Status aus KatoSync":queued>0?`${queued} in Warteschlange`:
            "Bereit für neue Aufträge":"Zum Aktualisieren Haupt-App öffnen"}</small>
        </div>
        <button type="button" className="kai-details-action"
          onClick={()=>void navigate("jobs")} aria-label="Aufträge in KatoSync öffnen">
          <ArrowUpRight size={17}/>
        </button>
      </div>
      {privateTask?<div className="kai-job-detail">
        <span title={showDetails?privateTask:undefined}>
          {showDetails?privateTask:"Auftragsdetails geschützt"}
        </span>
        <button type="button" onClick={toggleDetails}>
          {showDetails?"Verbergen":"Anzeigen"}
        </button>
      </div>:null}
    </section>

    <div className="kai-information-row">
      <button type="button" className="kai-information-card" onClick={()=>void navigate("agent")}>
        <span className="kai-information-icon"><Cpu size={17}/></span>
        <span className="kai-information-copy">
          <small>LOKALES MODELL</small>
          <strong>{modelRunning?"Local Brain aktiv":"Modell nicht aktiv"}</strong>
        </span>
        {modelRunning?<CheckCircle2 size={15} className="kai-ok"/>:
          <span className="kai-muted-indicator" aria-label="Nicht aktiv"/>}
      </button>
      <button type="button" className="kai-information-card" onClick={()=>void navigate("jobs")}>
        <span className="kai-information-icon queued"><Clock3 size={16}/></span>
        <span className="kai-information-copy">
          <small>WARTESCHLANGE</small>
          <strong>{fresh?`${queued} wartend`:"Nicht geprüft"}</strong>
        </span>
        {fresh&&attention>0?<span className="kai-alert"><AlertCircle size={14}/>{attention}</span>:null}
      </button>
    </div>

    {expanded?<section className="kai-expanded-details" aria-label="Schnellaktionen">
      <div className="kai-section-caption"><Activity size={13}/>SCHNELLAKTIONEN</div>
      <div className="kai-actions-grid">
        <button type="button" className="kai-action-card kai-action-brand"
          onClick={()=>void navigate("chat")}>
          <KaiEmblem small/><span>Ask Anything</span>
        </button>
        <button type="button" className="kai-action-card" onClick={()=>void navigate("dashboard")}>
          <RefreshCw size={20}/><span>Sync-Status</span>
        </button>
        <button type="button" className="kai-action-card" onClick={()=>void navigate("jobs")}>
          <Workflow size={20}/><span>Jobs</span>
        </button>
        <button type="button" className="kai-action-card" onClick={()=>void navigate("agent")}>
          <Cpu size={20}/><span>Local Model</span>
        </button>
      </div>
      <p className="kai-expanded-notice">
        <ShieldCheck size={14}/>
        {fresh?"Status aus der aktiven KatoSync-Sitzung":
          "Für aktuelle Informationen KatoSync öffnen"}
      </p>
    </section>:null}

    <div className="kai-widget-bottom">
      <button type="button" className="kai-ask-anything"
        onClick={()=>void navigate("chat")} title="Kato AI Chat in KatoSync öffnen">
        <KaiEmblem small/>
        <span>Ask Anything…</span>
        <span className="kai-ask-send"><ArrowUpRight size={18}/></span>
      </button>
      <footer className="kai-footer">
        <button type="button" className="kai-footer-action"
          onClick={()=>void toggleExpanded()} disabled={resizing}
          aria-expanded={expanded}>
          {expanded?<ChevronUp size={14}/>:<ChevronDown size={14}/>}
          {expanded?"Weniger":"Schnellauswahl"}
        </button>
        <div className="kai-footer-status">
          {error?<AlertCircle size={12}/>:fresh?<CheckCircle2 size={12}/>:<Clock3 size={12}/>}
          <span>{error?"Verbindung prüfen":fresh?"KatoSync verbunden":"Status ausstehend"}</span>
        </div>
        <button type="button" className="kai-footer-more" onClick={()=>void navigate("dashboard")}>
          Mehr <ArrowUpRight size={13}/>
        </button>
      </footer>
    </div>
  </main>;
}
const root=document.getElementById("root");
if(root)createRoot(root).render(<React.StrictMode><Widget/></React.StrictMode>);
