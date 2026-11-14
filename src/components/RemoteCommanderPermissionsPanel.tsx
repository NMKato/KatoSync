import { useEffect, useState } from "react";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { Panel } from "./Primitives";
import { useT, type Lang } from "../i18n";
import {
  parseRc66ConsentSnapshot, makeRc66ConsentIntent,
  type Rc66ConsentAction, type Rc66ConsentIntent
} from "../lib/remoteConsent";

const labels:Record<Lang,{
  title:string; unavailable:string; hint:string; client:string; devices:string; empty:string;
  pending:string; approved:string; revoked:string; approve:string; revoke:string;
  review:string; warning:string; confirm:string; send:string; cancel:string;
  submitted:string; failure:string; noExecution:string; expires:string;
}>={
  de:{
    title:"Remote Commander – Gerätefreigaben",unavailable:"Keine verifizierten Remote-Gerätefreigaben",
    hint:"ChatGPT-Anmeldung und Geräteberechtigungen sind getrennt. Diese Ansicht benötigt erst eine geprüfte Freigabe-API. Lokale Mesh-Geräte erhalten niemals automatisch Zugriff.",
    client:"KI-Client",devices:"Gerätefreigaben",empty:"Keine freigegebenen Geräte",
    pending:"Ausstehend",approved:"Nur Lesen genehmigt",revoked:"Widerrufen",
    approve:"Genehmigung prüfen",revoke:"Widerruf prüfen",review:"Entscheidung bestätigen",
    warning:"Ausschließlich Liste und Status. Keine Dateien, Terminalbefehle oder Fernsteuerung. Der Server muss Identität, Berechtigung und gesonderte Sicherheitsbestätigung prüfen.",
    confirm:"Ich habe Ziel und Umfang dieser Entscheidung geprüft.",
    send:"Zur Serverprüfung senden",cancel:"Abbrechen",
    submitted:"Anfrage übermittelt. Eine Freigabe wird erst nach unabhängiger Serverbestätigung angezeigt.",
    failure:"Anfrage nicht bestätigt. Rechte unverändert.",
    noExecution:"Keine Remote-Ausführung",expires:"Gültig bis"
  },
  en:{
    title:"Remote Commander – Device permissions",unavailable:"No verified remote device permissions",
    hint:"ChatGPT login and device permissions are separate. A verified consent API is required. Local Mesh devices are never authorized automatically.",
    client:"AI client",devices:"Device permissions",empty:"No authorized devices",
    pending:"Pending",approved:"Read-only approved",revoked:"Revoked",
    approve:"Review approval",revoke:"Review revocation",review:"Confirm decision",
    warning:"List and status only. No files, terminal or remote control. Server-side identity, authorization and separate step-up confirmation are required.",
    confirm:"I have checked the target and scope.",
    send:"Send for server verification",cancel:"Cancel",
    submitted:"Request submitted. Permission appears only after independent server confirmation.",
    failure:"Request not confirmed. Rights unchanged.",
    noExecution:"No remote execution",expires:"Valid until"
  },
  es:{
    title:"Remote Commander – Permisos de dispositivos",unavailable:"No hay permisos remotos verificados",
    hint:"El acceso a ChatGPT no autoriza dispositivos. Se requiere una API verificada. El Mesh local no da permisos automáticamente.",
    client:"Cliente de IA",devices:"Permisos por dispositivo",empty:"Sin dispositivos autorizados",
    pending:"Pendiente",approved:"Solo lectura autorizado",revoked:"Revocado",
    approve:"Revisar autorización",revoke:"Revisar revocación",review:"Confirmar decisión",
    warning:"Solo lista y estado. Sin archivos, terminal ni control remoto. El servidor debe verificar la identidad, los permisos y la confirmación adicional.",
    confirm:"He revisado el destino y el alcance.",
    send:"Enviar para verificación",cancel:"Cancelar",
    submitted:"Solicitud enviada. Los permisos solo aparecerán tras la confirmación del servidor.",
    failure:"Solicitud no confirmada. Los permisos no cambian.",
    noExecution:"Sin ejecución remota",expires:"Válido hasta"
  },
  ru:{
    title:"Remote Commander — Разрешения устройств",unavailable:"Нет проверенных удалённых разрешений",
    hint:"Вход ChatGPT и доступ к устройствам разделены. Нужен проверенный сервер разрешений. Mesh не дает права автоматически.",
    client:"Клиент ИИ",devices:"Разрешения устройств",empty:"Нет разрешенных устройств",
    pending:"Ожидает",approved:"Разрешено только чтение",revoked:"Отозвано",
    approve:"Проверить разрешение",revoke:"Проверить отзыв",review:"Подтвердить решение",
    warning:"Только список и состояние, без файлов, терминала или управления. Сервер отдельно проверяет личность, разрешения и подтверждение безопасности.",
    confirm:"Я проверил цель и объем разрешения.",
    send:"Отправить на проверку",cancel:"Отмена",
    submitted:"Запрос отправлен. Права появятся только после подтверждения сервера.",
    failure:"Запрос не подтвержден. Права не изменились.",
    noExecution:"Без удаленного выполнения",expires:"Действует до"
  }
};

export function RemoteCommanderPermissionsPanel({
  snapshot=null,onRequest
}:{
  snapshot?:unknown;
  onRequest?:(intent:Rc66ConsentIntent)=>Promise<{accepted:boolean}>;
}){
  const {lang}=useT();
  const l=labels[lang];
  const verified=parseRc66ConsentSnapshot(snapshot);
  const revision=verified?.revision??null;
  const [review,setReview]=useState<Rc66ConsentIntent|null>(null);
  const [ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState("");
  useEffect(()=>{
    setReview(null);setAck(false);setNotice("");
  },[revision]);
  const choose=(action:Rc66ConsentAction,deviceId:string|null=null)=>{
    if(!verified||!onRequest)return;
    const intent=makeRc66ConsentIntent(verified,action,deviceId);
    if(!intent)return;
    setReview(intent);setAck(false);setNotice("");
  };
  const send=async()=>{
    if(!review||!ack||!verified||!onRequest||busy)return;
    const checked=makeRc66ConsentIntent(verified,review.action,review.deviceId);
    if(!checked||checked.expectedRevision!==review.expectedRevision)return;
    setBusy(true);
    try{
      const result=await onRequest(checked);
      setNotice(result?.accepted===true?l.submitted:l.failure);
    }catch{setNotice(l.failure);}
    finally{setBusy(false);setAck(false);setReview(null);}
  };
  const status=(state:"pending"|"approved"|"revoked")=>
    state==="approved"?l.approved:state==="pending"?l.pending:l.revoked;
  const action=(state:"pending"|"approved"|"revoked",deviceId:string|null)=>{
    if(!onRequest||state==="revoked")return null;
    const operation:Rc66ConsentAction=deviceId===null?
      state==="pending"?"approve_client":"revoke_client":
      state==="pending"?"approve_device":"revoke_device";
    return <button className="rc66-action" type="button"
      onClick={()=>choose(operation,deviceId)}>
      {state==="pending"?l.approve:l.revoke}
    </button>;
  };
  return <Panel className="rc66-permissions-panel" title={l.title}
    id="section-remote-permissions" icon={<LockKeyhole size={18}/>}>
    {!verified?<div className="rc66-unavailable" role="status">
      <ShieldAlert size={20} aria-hidden="true"/>
      <div><strong>{l.unavailable}</strong><p>{l.hint}</p></div>
    </div>:<>
      <p className="rc66-note">{l.noExecution}</p>
      {verified.client ? <>
        <h4>{l.client}</h4>
        <div className="rc66-permission-row">
          <div><strong>{verified.client.displayName}</strong>
            <small>{status(verified.client.status)} · {l.expires}: {verified.client.expiresAt.slice(0,10)}</small>
          </div>
          {action(verified.client.status,null)}
        </div>
        <h4>{l.devices}</h4>
        {verified.devices.length===0?<p className="rc66-note">{l.empty}</p>:
          verified.devices.map(device=><div className="rc66-permission-row" key={device.deviceId}>
            <div><strong>{device.displayName}</strong>
              <small>{status(device.status)}
                {device.expiresAt?" · "+l.expires+": "+device.expiresAt.slice(0,10):""}
              </small>
            </div>
            {verified.client?.status==="approved"?action(device.status,device.deviceId):null}
          </div>)}
      </>:<p className="rc66-note">{l.empty}</p>}
    </>}
    {review&&<div className="rc66-review" role="group" aria-label={l.review}>
      <strong>{l.review}</strong>
      <p>{l.warning}</p>
      <label><input type="checkbox" checked={ack}
        onChange={e=>setAck(e.target.checked)}/>{l.confirm}</label>
      <div className="rc66-review-actions">
        <button type="button" disabled={!ack||busy} onClick={send}>{l.send}</button>
        <button type="button" disabled={busy} onClick={()=>setReview(null)}>{l.cancel}</button>
      </div>
    </div>}
    {notice&&<p role="status" className="rc66-note">{notice}</p>}
  </Panel>;
}
