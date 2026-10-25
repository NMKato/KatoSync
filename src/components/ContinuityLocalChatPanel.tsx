// Created by NMKato Solutions
// Project-scoped, durable, local-only Q&A. Model-generated text never becomes canonical truth.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { BrainCircuit, RefreshCcw, Send, ShieldCheck, ImagePlus, XCircle, Eye, EyeOff, Mic, Square, Settings2, CheckCircle2, Loader2, Sparkles, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { presentChatAnswer } from "../lib/chatAnswerPresentation";
import { parseHumanView } from "../lib/chatAdaptiveViews";
import { useT } from "../i18n";

type ChatDiagnostics = {code:string;canRepair:boolean};
type ChatRepairReceipt = {projectId:string;backupCreated:boolean;indexedSources:number};
type Citation = { index: number; sourceRef: string; truthLevel: string; freshness: string };
type ChatTurn = {
  projectId: string;
  sequence: number;
  question: string;
  answer: string;
  gitHead: string;
  citationsJson: string;
  createdAt: string;
};
const MAX_QUESTION = 1200;
type ImageDraft={mimeType:string;dataBase64:string;preview:string;thumbnail:string};
type BrainCapabilities={visionReady:boolean;running:boolean};
type SttStage="idle"|"permission"|"recording"|"processing"|"success"|"error";
type SttEvent={id:string;kind:string;code:string;text:string};
type SttReadiness={code:string};
const STT_EVENT="katosync-stt-event";

const HTML_PREVIEW_POLICY = "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'\">";

/** Offline conversion: no upload, no network. 1600px max; 4 MB encoded payload. */
async function readImageLocally(file:File):Promise<ImageDraft>{
  if(!["image/png","image/jpeg"].includes(file.type)||file.size>8*1024*1024){
    throw new Error("invalid_file");
  }
  const original=await new Promise<string>((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error("read_failed"));
    reader.onload=()=>resolve(String(reader.result||""));
    reader.readAsDataURL(file);
  });
  const image=new Image();
  await new Promise<void>((resolve,reject)=>{
    image.onload=()=>resolve();image.onerror=()=>reject(new Error("not_image"));
    image.src=original;
  });
  if(!image.naturalWidth||!image.naturalHeight)throw new Error("empty_image");
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext("2d");
  if(!context)throw new Error("canvas_unavailable");
  context.drawImage(image,0,0,canvas.width,canvas.height);
  let preview=canvas.toDataURL(file.type,0.85);
  if(preview.length>5_500_000)preview=canvas.toDataURL("image/jpeg",0.72);
  if(preview.length>5_500_000)throw new Error("image_too_large");
  const [prefix,dataBase64]=preview.split(",",2);
  const mimeType=prefix.includes("image/png")?"image/png":"image/jpeg";
  // A small in-memory thumbnail is the only image retained in chat presentation.
  // Neither full image nor thumbnail is stored in SQLite/project-memory files.
  const thumb=document.createElement("canvas");
  const thumbScale=Math.min(1,360/Math.max(canvas.width,canvas.height));
  thumb.width=Math.max(1,Math.round(canvas.width*thumbScale));
  thumb.height=Math.max(1,Math.round(canvas.height*thumbScale));
  const thumbContext=thumb.getContext("2d");
  if(!thumbContext)throw new Error("thumbnail_unavailable");
  thumbContext.drawImage(canvas,0,0,thumb.width,thumb.height);
  const thumbnail=thumb.toDataURL("image/jpeg",0.68);
  return {preview,dataBase64,mimeType,thumbnail};
}

function SafeChatAnswer({answer,sourceIndices=[]}:{answer:string;sourceIndices?:number[]}){
  const {t}=useT();
  const [open,setOpen]=useState(false);
  const fence=String.fromCharCode(96).repeat(3);
  const html=answer.split(fence+"html\n")[1]?.split(fence)[0];
  const presented=presentChatAnswer(answer,sourceIndices);
  const view=parseHumanView(answer,sourceIndices);
  const verifiedMax=view?.kind==="bars"?Math.max(...view.points.map(x=>x.value)):0;
  return <div className="continuity-rich-answer">
    {view?.kind==="table"?<section className="continuity-adaptive-view" aria-label={view.title||"Vergleichstabelle"}>
      {view.title?<h3>{view.title}</h3>:null}
      <div className="continuity-table-scroll"><table>
        <thead><tr>{view.columns.map((head,index)=><th key={index} scope="col">{head}</th>)}</tr></thead>
        <tbody>{view.rows.map((row,index)=><tr key={index}>
          {row.map((cell,j)=><td key={j}>{cell}</td>)}
        </tr>)}</tbody>
      </table></div>
    </section>:null}
    {view?.kind==="bars"?<section className="continuity-adaptive-view" aria-label={view.title||"Wertevergleich aus der KI-Antwort"}>
      <h3>{view.title||"Wertevergleich"}</h3>
      <div className="continuity-verified-bars">
        {view.points.map((point,index)=><div className="continuity-bar-row" key={index}>
          <span className="continuity-bar-label">{point.label}</span>
          <div className="continuity-bar-track" role="img" aria-label={point.label+": "+point.value+" "+view.unit}>
            <div className="continuity-bar-fill" style={{width:((point.value/verifiedMax)*100)+"%"}}/>
          </div>
          <span className="continuity-bar-value">{new Intl.NumberFormat("de-DE").format(point.value)} {view.unit}</span>
        </div>)}
      </div>
      <small>{t("continuity.chat.chartUnverified")} · {t("continuity.chat.sources")}: {view.sources.map(x=>"["+x+"]").join(", ")}</small>
    </section>:null}
    {(!view || presented.startsWith("###"))?<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      img:()=>null,
      a:({children})=><span>{children}</span>,
      table:({children})=><div className="continuity-table-scroll"><table>{children}</table></div>,
    }}>{presented}</ReactMarkdown>:null}
    {html&&html.length<20000?<div className="continuity-html-preview">
      <button type="button" className="ghost compact-button" onClick={()=>setOpen(v=>!v)}>
        {open?<EyeOff size={14}/>:<Eye size={14}/>}
        {open?"Vorschau schließen":"HTML-Vorschau (isoliert)"}
      </button>
      {open?<iframe title="Isolierte HTML-Vorschau" sandbox="" referrerPolicy="no-referrer"
        srcDoc={HTML_PREVIEW_POLICY+html} />:null}
    </div>:null}
  </div>;
}


function citationsFor(turn: ChatTurn): Citation[] {
  try {
    const items: unknown = JSON.parse(turn.citationsJson);
    if (!Array.isArray(items)) return [];
    return items.slice(0, 8).filter((item): item is Citation =>
      item !== null && typeof item === "object" &&
      typeof item.sourceRef === "string" && typeof item.index === "number" &&
      typeof item.truthLevel === "string" && typeof item.freshness === "string");
  } catch {
    return [];
  }
}

export function ContinuityLocalChatPanel({ projectId, projectName, initialDraft = "", draftRevision = 0 }: { projectId: string; projectName: string; initialDraft?: string; draftRevision?: number }) {
  const { t } = useT();
  const [question, setQuestion] = useState(initialDraft.slice(0, MAX_QUESTION));
  const lastDraftRevision = useRef(draftRevision);
  // Issue handoff is only a composer prefill. Clearing the handoff clears its text
  // instead of silently leaving stale GitHub instructions in a later chat turn.
  useEffect(() => {
    if (lastDraftRevision.current === draftRevision) return;
    lastDraftRevision.current = draftRevision;
    setQuestion(draftRevision > 0 ? initialDraft.slice(0, MAX_QUESTION) : "");
  }, [draftRevision, initialDraft]);
  const [session, setSession] = useState<{ projectId: string; turns: ChatTurn[] }>({ projectId: "", turns: [] });
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [imageDraft,setImageDraft]=useState<ImageDraft|null>(null);
  const [transientThumbnails,setTransientThumbnails]=useState<Record<string,string>>({});
  useEffect(()=>{
    setTransientThumbnails({}); // must never carry screenshot previews to a foreign project
  },[projectId]);
  const [pendingImage,setPendingImage]=useState(false);
  const [sttStage,setSttStage]=useState<SttStage>("idle");
  const [sttErrorCode,setSttErrorCode]=useState("");
  const [sttPermissionStatus,setSttPermissionStatus]=useState("");
  const [sttSupported,setSttSupported]=useState(false);
  const [sttElapsed,setSttElapsed]=useState(0);
  const [sttPartial,setSttPartial]=useState("");
  const startedAt=useRef(0);
  const sttSessionRef=useRef<string|null>(null);
  const sttProjectRef=useRef("");
  useEffect(()=>{
    let active=true;
    if(window.__TAURI_INTERNALS__){
      invoke<boolean>("local_stt_available").then(ok=>{
        if(active)setSttSupported(ok);
      }).catch(()=>{if(active)setSttSupported(false);});
    }
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!window.__TAURI_INTERNALS__)return;
    let disposed=false;
    let unsubscribe:(()=>void)|undefined;
    void listen<SttEvent>(STT_EVENT,event=>{
      if(disposed || !sttSessionRef.current || event.payload.id!==sttSessionRef.current)return;
      const payload=event.payload;
      if(payload.kind==="permission"){setSttStage("permission");}
      else if(payload.kind==="recording"){
        startedAt.current=Date.now();
        setSttElapsed(0);
        setSttPartial("");
        setSttStage("recording");
      } else if(payload.kind==="partial"){
        setSttPartial(payload.text.slice(-280));
      } else if(payload.kind==="processing"){setSttStage("processing");}
      else if(payload.kind==="complete"){
        sttSessionRef.current=null;
        setSttErrorCode("");
        setSttStage("success");
        if(sttProjectRef.current===projectRef.current && payload.text.trim()){
          setQuestion(old=>[old.trim(),payload.text.trim()].filter(Boolean).join(" ").slice(0,MAX_QUESTION));
        }
      }else if(payload.kind==="error"){
        sttSessionRef.current=null;
        setSttErrorCode(payload.code||"helper_failed");
        setSttStage("error");
      }
    }).then(fn=>{if(disposed)fn();else unsubscribe=fn;}).catch(()=>{
      setSttErrorCode("helper_failed");setSttStage("error");
    });
    return()=>{
      disposed=true;
      unsubscribe?.();
      if(sttSessionRef.current){
        void invoke("local_stt_stop",{id:sttSessionRef.current}).catch(()=>{});
      }
    };
  },[]);
  useEffect(()=>{
    if(sttStage!=="recording")return;
    const interval=window.setInterval(()=>{
      setSttElapsed(Math.min(12,Math.floor((Date.now()-startedAt.current)/1000)));
    },250);
    return()=>window.clearInterval(interval);
  },[sttStage]);
  const dictating=sttStage==="recording"||sttStage==="processing"||sttStage==="permission";
  const recording=sttStage==="recording";
  const sttNeedsSettings=["mic_denied","speech_denied"].includes(sttErrorCode);
  const sttMessage=(()=>{
    switch(sttErrorCode) {
      case "mic_denied":return t("continuity.chat.sttFailure.mic_denied");
      case "speech_denied":return t("continuity.chat.sttFailure.speech_denied");
      case "permission_timeout":return t("continuity.chat.sttFailure.permission_timeout");
      case "audio_engine":return t("continuity.chat.sttFailure.audio_engine");
      case "ondevice_unavailable":return t("continuity.chat.sttFailure.ondevice_unavailable");
      case "no_speech":return t("continuity.chat.sttFailure.no_speech");
      case "recognizer_error":return t("continuity.chat.sttFailure.recognizer_error");
      case "helper_failed":return t("continuity.chat.sttFailure.helper_failed");
      case "timeout":return t("continuity.chat.sttFailure.timeout");
      case "platform_unavailable":return t("continuity.chat.sttFailure.platform_unavailable");
      case "helper_missing":return t("continuity.chat.sttFailure.helper_missing");
      default:return t("continuity.chat.sttError");
    }
  })();
  const [visionReady,setVisionReady]=useState(false);
  const [visionChecked,setVisionChecked]=useState(false);
  const uploadRef=useRef<HTMLInputElement>(null);
  const transcriptRef=useRef<HTMLDivElement>(null);
  const previousTurnCount=useRef(0);
  useEffect(()=>{
    let valid=true;
    if(window.__TAURI_INTERNALS__){
      invoke<BrainCapabilities>("local_brain_status").then(status=>{
        if(valid){setVisionReady(status.running&&status.visionReady);setVisionChecked(true);}
      }).catch(()=>{if(valid){setVisionReady(false);setVisionChecked(true);}});
    }
    return()=>{valid=false;};
  },[projectId]);
  const [diagnostics, setDiagnostics] = useState<ChatDiagnostics|null>(null);
  const [acceptBackup, setAcceptBackup] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairReceipt, setRepairReceipt] = useState<ChatRepairReceipt|null>(null);
  const requestRef = useRef(0);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const turns = session.projectId === projectId ? session.turns : [];
  const latestSequence = turns.length ? turns[turns.length - 1].sequence : 0;
  useEffect(()=>{
    if(turns.length>previousTurnCount.current){
      transcriptRef.current?.scrollTo({top:transcriptRef.current.scrollHeight,behavior:"smooth"});
    }
    previousTurnCount.current=turns.length;
  },[turns.length]);

  async function refresh() {
    const current = projectId;
    const request = ++requestRef.current;
    setError("");
    setDiagnostics(null);
    setLoaded(false);
    if (!current || !window.__TAURI_INTERNALS__) return;
    setBusy(true);
    try {
      const result = await invoke<ChatTurn[]>("continuity_chat_history", { projectId: current });
      if (requestRef.current !== request || projectRef.current !== current) return;
      if (!Array.isArray(result) || result.some((turn) => turn.projectId !== current)) {
        throw new Error("foreign_project");
      }
      setSession({ projectId: current, turns: result });
      setDiagnostics(null);
      setLoaded(true);
    } catch {
      if (requestRef.current === request && projectRef.current === current) {
        setError(t("continuity.chat.historyUnavailable"));
        try {
          const state = await invoke<ChatDiagnostics>("continuity_chat_diagnostics", {projectId: current});
          if (requestRef.current === request && projectRef.current === current) setDiagnostics(state);
        } catch { /* Keep fail-closed error; no native diagnostic details leaked. */ }
      }
    } finally {
      if (requestRef.current === request) setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { requestRef.current += 1; };
    // Refresh only on selected project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function repairIndex() {
    if (!diagnostics?.canRepair || !acceptBackup || repairing || busy) return;
    const current=projectId;
    const request=++requestRef.current;
    setRepairing(true);setError("");
    try {
      const receipt=await invoke<ChatRepairReceipt>("continuity_chat_repair_project", {
        projectId:current,acceptedBackup:true
      });
      if (projectRef.current!==current || requestRef.current!==request) return;
      if (receipt.projectId!==current) throw new Error("invalid_repair_result");
      setRepairReceipt(receipt);
      setAcceptBackup(false);
      await refresh();
    } catch {
      if (projectRef.current===current && requestRef.current===request)
        setError(t("continuity.chat.repairFailed"));
    } finally {if (projectRef.current===current) setRepairing(false);}
  }

  async function dictateLocally(){
    if(dictating||!sttSupported||!loaded||sttSessionRef.current)return;
    const id=crypto.randomUUID();
    sttSessionRef.current=id;
    sttProjectRef.current=projectId;
    setSttStage("permission");
    setSttElapsed(0);
    setSttPartial("");
    setSttErrorCode("");
    setError("");
    try{await invoke("local_stt_start",{id});}
    catch(error){
      sttSessionRef.current=null;
      const code=String(error);
      setSttErrorCode(["already_recording","helper_missing","helper_failed"].includes(code)?code:"helper_failed");
      setSttStage("error");
    }
  }
  async function stopDictation(){
    if(!sttSessionRef.current || !["recording","permission"].includes(sttStage))return;
    setSttStage("processing");
    try{await invoke("local_stt_stop",{id:sttSessionRef.current});}
    catch{
      setSttErrorCode("helper_failed");setSttStage("error");
    }
  }
  async function checkMicrophone(){
    try{
      const result=await invoke<SttReadiness>("local_stt_preflight");
      setSttPermissionStatus(result.code);
      if(["speech_denied","mic_denied"].includes(result.code)){
        setSttErrorCode(result.code);setSttStage("error");
      }
    }catch{setSttPermissionStatus("helper_failed");}
  }
  async function openMicrophoneSettings(){
    try{await invoke("local_stt_open_settings");}
    catch{setSttPermissionStatus("settings_unavailable");}
  }

  async function pickImage(file:File|undefined){
    if(!file)return;
    setError("");
    try{setImageDraft(await readImageLocally(file));}
    catch{setError(t("continuity.chat.badImage"));}
    if(uploadRef.current)uploadRef.current.value="";
  }

  async function send() {
    const current = projectId;
    const text = question.trim();
    if (!window.__TAURI_INTERNALS__ || !loaded || !current || busy ||
        !text || Array.from(text).length > MAX_QUESTION || (imageDraft!==null&&!visionReady)) return;
    const request = ++requestRef.current;
    const expected = latestSequence;
    const outgoingImage=imageDraft;
    setBusy(true);
    setError("");
    setQuestion("");
    setImageDraft(null);
    setPendingImage(Boolean(outgoingImage));
    try {
      const result = await invoke<ChatTurn>("continuity_chat_send", {
        projectId: current, question: text, expectedSequence: expected,
        image:outgoingImage?{mimeType:outgoingImage.mimeType,dataBase64:outgoingImage.dataBase64}:null
      });
      if (requestRef.current !== request || projectRef.current !== current) return;
      if (result.projectId !== current || result.sequence !== expected + 1) {
        throw new Error("stale_or_foreign_result");
      }
      setSession((prev) => ({
        projectId: current,
        turns: [...(prev.projectId === current ? prev.turns : []), result].slice(-20)
      }));
      if(outgoingImage){
        setTransientThumbnails(previous=>{
          const entries=Object.entries(previous).slice(-5);
          return Object.fromEntries([...entries,[current+":"+result.sequence,outgoingImage.thumbnail]]);
        });
      }
    } catch {
      if (requestRef.current === request) {
        // Restore only if the next draft is still empty. No invisible lost input.
        setQuestion(existing=>existing||text);
        setImageDraft(existing=>existing||outgoingImage);
        setError(t("continuity.chat.saveError"));
        setLoaded(false); // recheck native sequence rather than blindly retrying writes
      }
    } finally {
      if (requestRef.current === request) {
        setBusy(false);
        setPendingImage(false);
      }
    }
  }

  if (!projectId) return null;
  return (
    <section className="continuity-local-chat" aria-label={t("continuity.chat.title")}>
      <div className="continuity-result-head">
        <div className="agent-card-title">
          <BrainCircuit size={16}/>
          <h4>{t("continuity.chat.title")}</h4>
        </div>
        <button type="button" className="ghost compact-button" onClick={() => void refresh()}
          disabled={busy || !window.__TAURI_INTERNALS__}>
          <RefreshCcw size={13}/> {t("continuity.chat.reload")}
        </button>
      </div>
      <p className="agent-empty continuity-chat-description">{t("continuity.chat.persistentSubtitle")}</p>
      <div className="continuity-project-tag"><span>{t("continuity.chat.projectTag")}:</span> <strong>{projectName} · {projectId}</strong></div>
      {!window.__TAURI_INTERNALS__ ? <p className="tone-warn">{t("continuity.chat.desktopOnly")}</p> : null}
      {!loaded && diagnostics ? <div className="continuity-chat-recovery" role="region"
        aria-label={t("continuity.chat.recoveryTitle")}>
        <strong>{t("continuity.chat.recoveryTitle")}</strong>
        <p>{diagnostics.code==="needs_refresh"?t("continuity.chat.needsRefresh"):
          diagnostics.code==="missing_index"?t("continuity.chat.needsIndex"):
          t("continuity.chat.recoveryBlocked")}</p>
        {diagnostics.canRepair ? <>
          <label className="continuity-repair-consent">
            <input type="checkbox" checked={acceptBackup}
              disabled={repairing} onChange={e=>setAcceptBackup(e.target.checked)}/>
            <span>{t("continuity.chat.backupConsent")}</span>
          </label>
          <button type="button" className="secondary compact-button"
            disabled={!acceptBackup||repairing||busy} onClick={()=>void repairIndex()}>
            <ShieldCheck size={14}/>{repairing?t("continuity.chat.repairing"):
              t("continuity.chat.repairButton")}
          </button>
        </>:null}
      </div>:null}
      {repairReceipt && loaded ? <p className="continuity-notice">
        <ShieldCheck size={14}/>{t("continuity.chat.repairComplete")}
      </p>:null}
      <div ref={transcriptRef} className="continuity-chat-transcript" role="log" aria-live="polite"
        aria-label={t("continuity.chat.history")}>
        {turns.length ? turns.map((turn) => (
          <div key={turn.sequence} className="continuity-chat-turn">
            <div className="continuity-chat-user">
              <span className="continuity-message-label">{t("continuity.chat.question")}</span>
              <p>{turn.question.replace(" [Bild lokal analysiert; Datei nicht gespeichert]","")}</p>
              {turn.question.includes("[Bild lokal analysiert; Datei nicht gespeichert]")?<>
                {transientThumbnails[projectId+":"+turn.sequence]?
                  <figure className="continuity-history-thumbnail">
                    <img src={transientThumbnails[projectId+":"+turn.sequence]}
                      alt={t("continuity.chat.imagePreview")} loading="lazy" />
                    <figcaption>{t("continuity.chat.imageTransient")}</figcaption>
                  </figure>:null}
                <span className="continuity-visual-receipt"><CheckCircle2 size={13}/>{t("continuity.chat.imageAnalyzed")}</span>
              </>:null}
            </div>
            <div className="continuity-chat-assistant">
              <span className="continuity-message-label"><Sparkles size={14}/>{t("continuity.chat.answer")}</span>
              {turn.question.includes("[Bild lokal analysiert; Datei nicht gespeichert]")?
                <p className="continuity-vision-disclaimer">{t("continuity.chat.visualNotVerified")}</p>:null}
              {turn.answer==="NOT_IN_MEMORY"
                ? <p>{t("continuity.chat.noEvidence")}</p>
                : <SafeChatAnswer answer={turn.answer} sourceIndices={citationsFor(turn).map(c=>c.index)}/>}
            </div>
            {citationsFor(turn).length ? (
              <details className="continuity-sources">
                <summary>{t("continuity.chat.sources")} · {citationsFor(turn).length}</summary>
                <ul>
                  {citationsFor(turn).map(cite=><li key={cite.index}>
                    [{cite.index}] {cite.sourceRef} · {cite.truthLevel} · {cite.freshness}
                  </li>)}
                </ul>
              </details>
            ) : null}
            <details className="continuity-turn-meta">
              <summary>{t("continuity.chat.technicalDetails")}</summary>
              <small>#{turn.sequence} · {turn.createdAt} · Git {turn.gitHead.slice(0,12)}</small>
            </details>
          </div>
        )) : <p className="agent-empty">{t("continuity.chat.empty")}</p>}
      </div>
      <div className="continuity-composer-shell">
      <label className="continuity-paste">
        <span>{t("continuity.chat.ask")}</span>
        <textarea rows={3} maxLength={MAX_QUESTION} value={question}
          disabled={dictating || !loaded || !window.__TAURI_INTERNALS__}
          placeholder={t("continuity.chat.placeholder")}
          onChange={(event) => { setQuestion(event.target.value); setError(""); }}
          onPaste={(event)=>{
            const image=Array.from(event.clipboardData.files).find(file=>
              file.type==="image/png"||file.type==="image/jpeg");
            if(image){event.preventDefault();void pickImage(image);}
          }}
          onDragOver={event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}}
          onDrop={event=>{
            const image=Array.from(event.dataTransfer.files).find(file=>
              file.type==="image/png"||file.type==="image/jpeg");
            if(image){event.preventDefault();void pickImage(image);}
          }}
        />
      </label>
      <div className="continuity-attachment">
        <div className="continuity-voice-tools">
          <button type="button"
            className={"compact-button continuity-voice-button"+(recording?" is-recording":"")}
            disabled={!sttSupported||!loaded||sttStage==="processing"}
            onClick={()=>void (recording||sttStage==="permission"?stopDictation():dictateLocally())}
            aria-label={recording?t("continuity.chat.sttStop"):t("continuity.chat.sttButton")}>
            {recording?<Square size={15} fill="currentColor"/>:
              sttStage==="processing"?<Loader2 size={16} className="continuity-spin"/>:<Mic size={15}/>}
            {recording?t("continuity.chat.sttStop"):
              sttStage==="processing"?t("continuity.chat.sttProcessing"):
              sttStage==="permission"?t("continuity.chat.sttPermission"):
              t("continuity.chat.sttShort")}
          </button>
          {recording&&sttPartial?<span className="continuity-partial" role="status" aria-live="off">
            <span className="continuity-partial-label">{t("continuity.chat.sttRecognizing")}</span>
            {sttPartial}
          </span>:null}
          {recording?<span className="continuity-recording-status" role="status">
            <span className="continuity-record-dot"/>
            {t("continuity.chat.sttListening")} · 00:{String(sttElapsed).padStart(2,"0")} / 00:12
          </span>:null}
          {sttStage==="permission"?<span className="continuity-stt-status" role="status">
            {t("continuity.chat.sttPermission")}
          </span>:null}
          {sttStage==="processing"?<span className="continuity-stt-status" role="status">
            <Loader2 size={14} className="continuity-spin"/> {t("continuity.chat.sttProcessing")}
          </span>:null}
          {sttStage==="success"?<span className="continuity-stt-success" role="status">
            <CheckCircle2 size={15}/> {t("continuity.chat.sttSuccess")}
          </span>:null}

        </div>
        {!sttSupported?<small>{t("continuity.chat.sttUnavailable")}</small>:null}
        {sttPermissionStatus==="needs_permission"?<small role="status">
          {t("continuity.chat.sttNeedsPermission")}
        </small>:null}
        {sttPermissionStatus==="ready"?<small role="status">{t("continuity.chat.sttReady")}</small>:null}
        {sttStage==="error"?<div className="continuity-stt-error" role="alert">
          <span>{sttMessage}</span>
          {sttNeedsSettings?<button type="button" className="ghost compact-button"
            onClick={()=>void openMicrophoneSettings()}>
            <Settings2 size={14}/>{t("continuity.chat.sttOpenSettings")}
          </button>:null}
        </div>:null}
        <input type="file" ref={uploadRef} accept="image/png,image/jpeg"
          aria-label={t("continuity.chat.attachImage")} hidden
          onChange={event=>void pickImage(event.target.files?.[0])}/>
        <button type="button" className="ghost compact-button"
          disabled={!loaded||!visionReady}
          onClick={()=>uploadRef.current?.click()}>
          <ImagePlus size={16}/>{t("continuity.chat.imageShort")}
        </button>
        {!visionReady?<small role="status">{visionChecked?
          t("continuity.chat.visionUnavailable"):t("continuity.chat.visionChecking")}</small>:null}
        {imageDraft?<div className="continuity-local-image">
          <img src={imageDraft.preview} alt={t("continuity.chat.imagePreview")} />
          <button type="button" className="ghost compact-button" onClick={()=>setImageDraft(null)}
            disabled={busy}><XCircle size={14}/>{t("continuity.chat.removeImage")}</button>
        </div>:null}
      </div>
      {pendingImage?<div className="continuity-image-pending" role="status">
        <Loader2 size={14} className="continuity-spin"/>
        {t("continuity.chat.imagePending")}
      </div>:null}
      <div className="continuity-actions">
        <div className="continuity-runtime-chips">
          <span className="continuity-runtime-chip"><span className="continuity-chip-dot"/>{t("continuity.chat.offlineShort")}</span>
          <span className="continuity-runtime-chip"><CheckCircle2 size={12}/>{visionReady?t("continuity.chat.visionShort"):t("continuity.chat.textShort")}</span>
          <details className="continuity-tools-details">
            <summary><Settings2 size={14}/>{t("continuity.chat.sttTools")}<ChevronDown size={12}/></summary>
            <div className="continuity-tools-popup">
              <button type="button" className="ghost compact-button continuity-stt-check"
                onClick={()=>void checkMicrophone()} disabled={dictating||!sttSupported}>
                <Settings2 size={14}/>{t("continuity.chat.sttCheck")}
              </button>
              <small>{t("continuity.chat.durableLabel")}</small>
            </div>
          </details>
        </div>
        <button type="button" className="continuity-send-button" onClick={() => void send()}
          disabled={!question.trim() || !loaded || busy || dictating || !window.__TAURI_INTERNALS__ || (imageDraft!==null&&!visionReady)}>
          {busy?<Loader2 size={17} className="continuity-spin"/>:<Send size={16}/>}
          <span>{busy?t("continuity.chat.thinking"):t("continuity.chat.sendShort")}</span>
        </button>
      </div>
      </div>
      {error ? <p className="tone-warn" role="alert">{error}</p> : null}
      <details className="continuity-privacy-details">
        <summary><ShieldCheck size={14}/>{t("continuity.chat.privacyShort")}</summary>
        <p>{t("continuity.chat.persistNotice")}</p>
      </details>
    </section>
  );
}
