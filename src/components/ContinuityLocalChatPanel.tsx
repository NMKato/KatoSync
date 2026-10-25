// Created by NMKato Solutions
// Project-scoped, durable, local-only Q&A. Model-generated text never becomes canonical truth.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrainCircuit, RefreshCcw, Send, ShieldCheck, ImagePlus, XCircle, Eye, EyeOff, Mic } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
type ImageDraft={mimeType:string;dataBase64:string;preview:string};
type BrainCapabilities={visionReady:boolean;running:boolean};
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
  return {preview,dataBase64,mimeType};
}

function SafeChatAnswer({answer}:{answer:string}){
  const [open,setOpen]=useState(false);
  const fence=String.fromCharCode(96).repeat(3);
  const html=answer.split(fence+"html\n")[1]?.split(fence)[0];
  return <div className="continuity-rich-answer">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
      img:()=>null,
      a:({children})=><span>{children}</span>,
      table:({children})=><div className="continuity-table-scroll"><table>{children}</table></div>,
    }}>{answer}</ReactMarkdown>
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
  const [dictating,setDictating]=useState(false);
  const [sttSupported,setSttSupported]=useState(false);
  useEffect(()=>{
    let active=true;
    if(window.__TAURI_INTERNALS__){
      invoke<boolean>("local_stt_available").then(ok=>{if(active)setSttSupported(ok);})
        .catch(()=>{if(active)setSttSupported(false);});
    }
    return()=>{active=false;};
  },[]);
  const [visionReady,setVisionReady]=useState(false);
  const [visionChecked,setVisionChecked]=useState(false);
  const uploadRef=useRef<HTMLInputElement>(null);
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
    if(dictating||!sttSupported||busy||!loaded)return;
    setDictating(true);
    setError("");
    try{
      const transcript=await invoke<string>("local_stt_dictate");
      if(projectRef.current===projectId){
        setQuestion(old=>[old.trim(),transcript].filter(Boolean).join(" ").slice(0,MAX_QUESTION));
      }
    }catch{setError(t("continuity.chat.sttError"));}
    finally{setDictating(false);}
  }

  async function pickImage(file:File|undefined){
    if(!file||busy)return;
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
    setBusy(true);
    setError("");
    try {
      const result = await invoke<ChatTurn>("continuity_chat_send", {
        projectId: current, question: text, expectedSequence: expected,
        image:imageDraft?{mimeType:imageDraft.mimeType,dataBase64:imageDraft.dataBase64}:null
      });
      if (requestRef.current !== request || projectRef.current !== current) return;
      if (result.projectId !== current || result.sequence !== expected + 1) {
        throw new Error("stale_or_foreign_result");
      }
      setSession((prev) => ({
        projectId: current,
        turns: [...(prev.projectId === current ? prev.turns : []), result].slice(-20)
      }));
      setQuestion("");
      setImageDraft(null);
    } catch {
      if (requestRef.current === request) {
        setError(t("continuity.chat.saveError"));
        setLoaded(false); // recheck native sequence rather than blindly retrying writes
      }
    } finally {
      if (requestRef.current === request) setBusy(false);
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
      <p className="agent-empty">{t("continuity.chat.persistentSubtitle")}</p>
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
      <div className="continuity-chat-transcript" role="log" aria-live="polite"
        aria-label={t("continuity.chat.history")}>
        {turns.length ? turns.map((turn) => (
          <div key={turn.sequence} className="continuity-chat-turn">
            <p><strong>{t("continuity.chat.question")}</strong> {turn.question}</p>
            <div className="continuity-chat-assistant">
              <strong>{t("continuity.chat.answer")}</strong>
              {turn.answer==="NOT_IN_MEMORY"
                ? <p>{t("continuity.chat.noEvidence")}</p>
                : <SafeChatAnswer answer={turn.answer}/>}
            </div>
            {citationsFor(turn).length ? (
              <ul aria-label={t("continuity.chat.sources")}>
                {citationsFor(turn).map((cite) => <li key={cite.index}>
                  [{cite.index}] {cite.sourceRef} · {cite.truthLevel} · {cite.freshness}
                </li>)}
              </ul>
            ) : null}
            <small>#{turn.sequence} · {turn.createdAt} · Git {turn.gitHead.slice(0,12)}</small>
          </div>
        )) : <p className="agent-empty">{t("continuity.chat.empty")}</p>}
      </div>
      <label className="continuity-paste">
        <span>{t("continuity.chat.ask")}</span>
        <textarea rows={3} maxLength={MAX_QUESTION} value={question}
          disabled={busy || dictating || !loaded || !window.__TAURI_INTERNALS__}
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
        <button type="button" className="ghost compact-button"
          disabled={!sttSupported||!loaded||busy||dictating}
          onClick={()=>void dictateLocally()}>
          <Mic size={15}/>{dictating?t("continuity.chat.sttListening"):t("continuity.chat.sttButton")}
        </button>
        {!sttSupported?<small>{t("continuity.chat.sttUnavailable")}</small>:null}
        <input type="file" ref={uploadRef} accept="image/png,image/jpeg"
          aria-label={t("continuity.chat.attachImage")} hidden
          onChange={event=>void pickImage(event.target.files?.[0])}/>
        <button type="button" className="ghost compact-button"
          disabled={busy||!loaded||!visionReady}
          onClick={()=>uploadRef.current?.click()}>
          <ImagePlus size={15}/>{t("continuity.chat.attachImage")}
        </button>
        <small role="status">{visionReady?t("continuity.chat.visionReady"):
          visionChecked?t("continuity.chat.visionUnavailable"):t("continuity.chat.visionChecking")}</small>
        {imageDraft?<div className="continuity-local-image">
          <img src={imageDraft.preview} alt={t("continuity.chat.imagePreview")} />
          <button type="button" className="ghost compact-button" onClick={()=>setImageDraft(null)}
            disabled={busy}><XCircle size={14}/>{t("continuity.chat.removeImage")}</button>
        </div>:null}
      </div>
      <div className="continuity-actions">
        <button type="button" className="secondary compact-button" onClick={() => void send()}
          disabled={!question.trim() || !loaded || busy || !window.__TAURI_INTERNALS__ || (imageDraft!==null&&!visionReady)}>
          <Send size={14}/> {busy ? t("continuity.chat.thinking") : t("continuity.chat.send")}
        </button>
        <small>{t("continuity.chat.durableLabel")}</small>
      </div>
      {error ? <p className="tone-warn" role="alert">{error}</p> : null}
      <p className="continuity-notice"><ShieldCheck size={14}/>
        <span>{t("continuity.chat.persistNotice")}</span>
      </p>
    </section>
  );
}
