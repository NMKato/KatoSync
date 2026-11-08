import { BarChart3, ShieldAlert } from "lucide-react";
import { Panel } from "./Primitives";
import { useT, type Lang } from "../i18n";
import type { RemoteUsageHistory, RemoteUsageOverview } from "../lib/remoteUsage";

// UI labels use the existing language setting, without creating another
// login, token store, or conflicting API-quota component.
const labels: Record<Lang, {
  title:string; unavailable:string; hint:string; calls:string;
  average:string; noLimit:string; remaining:string; blocked:string;
  history:string; byTool:string; byClient:string; byDevice:string;
  noBreakdown:string; utc:string; noHistory:string;
}> = {
  de:{
    title:"Remote Commander – Nutzung",
    unavailable:"Noch keine Live-Nutzungsdaten verfügbar",
    hint:"Remote-MCP-Anmeldung und geschützte Usage-API sind noch nicht freigeschaltet. Es werden keine Testwerte oder Daten anderer Anbieter angezeigt.",
    calls:"Toolaufrufe in diesem Monat",average:"Tagesdurchschnitt",
    noLimit:"Keine feste monatliche Aufrufgrenze",remaining:"Verbleibende Aufrufe",
    blocked:"Durch Kontingent abgewiesen",history:"Letzte sechs Monate",
    byTool:"Nach Werkzeug",byClient:"Nach KI-Client",byDevice:"Nach Gerät",
    noBreakdown:"Keine Aufrufe in diesem Zeitraum",utc:"Kalendermonat UTC",
    noHistory:"Noch kein Nutzungsverlauf erfasst"
  },
  en:{
    title:"Remote Commander – Usage",unavailable:"No live usage data available yet",
    hint:"Remote MCP sign-in and the protected usage API are not enabled. No sample figures or other providers' data are shown.",
    calls:"Tool calls this month",average:"Daily average",
    noLimit:"No fixed monthly tool-call limit",remaining:"Calls remaining",
    blocked:"Quota-denied calls",history:"Last six months",
    byTool:"By tool",byClient:"By AI client",byDevice:"By device",
    noBreakdown:"No calls in this period",utc:"UTC calendar month",
    noHistory:"No usage history recorded yet"
  },
  es:{
    title:"Remote Commander – Uso",unavailable:"Todavía no hay datos reales de uso",
    hint:"El inicio de sesión MCP y la API de uso protegida aún no están activos. No se muestran datos de prueba ni de terceros.",
    calls:"Llamadas a herramientas este mes",average:"Promedio diario",
    noLimit:"Sin límite mensual fijo de llamadas",remaining:"Llamadas restantes",
    blocked:"Llamadas rechazadas por cuota",history:"Últimos seis meses",
    byTool:"Por herramienta",byClient:"Por cliente de IA",byDevice:"Por dispositivo",
    noBreakdown:"Sin llamadas en este periodo",utc:"Mes calendario UTC",
    noHistory:"Sin historial de uso registrado"
  },
  ru:{
    title:"Remote Commander — Использование",
    unavailable:"Данные о реальном использовании пока недоступны",
    hint:"Вход Remote MCP и защищённый API статистики пока не включены. Тестовые и сторонние данные не показываются.",
    calls:"Вызовы инструментов за месяц",average:"Среднее за день",
    noLimit:"Без фиксированного месячного лимита",remaining:"Осталось вызовов",
    blocked:"Отклонено по лимиту",history:"Последние шесть месяцев",
    byTool:"По инструментам",byClient:"По ИИ-клиентам",byDevice:"По устройствам",
    noBreakdown:"Нет вызовов за период",utc:"Календарный месяц UTC",
    noHistory:"История использования отсутствует"
  }
};

export function RemoteCommanderUsagePanel({
  summary=null,history=null,liveConnected=false
}:{
  summary?:RemoteUsageOverview|null;
  history?:RemoteUsageHistory|null;
  liveConnected?:boolean;
}){
  const {lang}=useT();
  const l=labels[lang];
  // A missing real response is NOT zero usage and is NOT Pro entitlement.
  const ready=liveConnected && summary?.live===true && summary.version===1;
  const fmt=(n:number)=>n.toLocaleString(
    lang==="de"?"de-DE":lang==="ru"?"ru-RU":lang==="es"?"es-ES":"en-US"
  );
  const months=history?.live===true?history.months:null;
  const max=Math.max(1,...(months??[]).map(x=>x.toolCalls));
  const displayMonth=(s:string)=>{
    const [y,m]=s.split("-").map(Number);
    return new Date(Date.UTC(y,m-1,1)).toLocaleDateString(
      lang==="de"?"de-DE":lang==="ru"?"ru-RU":lang==="es"?"es-ES":"en-US",
      {month:"short",year:"2-digit",timeZone:"UTC"});
  };
  return (
    <Panel className="remote-usage-panel" id="section-remote-usage"
      title={l.title} icon={<BarChart3 size={18}/>}>
      {!ready||!summary ? (
        <div className="remote-usage-offline" role="status">
          <ShieldAlert size={20} aria-hidden="true"/>
          <div><strong>{l.unavailable}</strong><p>{l.hint}</p></div>
        </div>
      ):(
        <>
          <div className="remote-usage-meta">
            <span>{summary.month} · {l.utc}</span>
            <strong>{summary.plan.toUpperCase()}</strong>
          </div>
          <div className="remote-usage-stats">
            <div><small>{l.calls}</small><strong>{fmt(summary.toolCalls)}</strong></div>
            <div><small>{l.average}</small><strong>{fmt(summary.dailyAverage)}</strong></div>
            <div>
              <small>{summary.plan==="free"?l.remaining:l.noLimit}</small>
              <strong>{summary.plan==="free"?fmt(summary.remaining??0):"∞"}</strong>
            </div>
          </div>
          {summary.plan==="free"&&summary.usagePercent!==null?(
            <div className="remote-usage-quota">
              <div className="remote-usage-bar" role="progressbar"
                aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={summary.usagePercent} aria-label={l.calls}>
                <span style={{width:String(summary.usagePercent)+"%"}}/>
              </div>
              <small>{fmt(summary.usagePercent)} % · {fmt(summary.toolCalls)} / {fmt(summary.monthlyLimit??0)}</small>
            </div>
          ):null}
          <p className="remote-usage-muted">{l.blocked}: {fmt(summary.quotaDenied)}</p>
          <h4>{l.history}</h4>
          {months?.length?(
            <div className="remote-usage-chart" role="list" aria-label={l.history}>
              {months.map(x=>(
                <div className="remote-usage-month" role="listitem" key={x.month}
                  aria-label={displayMonth(x.month)+": "+fmt(x.toolCalls)}>
                  <strong>{fmt(x.toolCalls)}</strong>
                  <div className="remote-usage-track">
                    <span style={{height:String(Math.max(0,Math.min(100,x.toolCalls/max*100)))+"%"}}/>
                  </div>
                  <small>{displayMonth(x.month)}</small>
                </div>
              ))}
            </div>
          ):<p className="remote-usage-muted">{l.noHistory}</p>}
          <div className="remote-usage-breakdown">
            {([
              [l.byTool,summary.byTool.map(x=>[x.tool,x.calls] as const)],
              [l.byClient,summary.byClient.map((x,i)=>[l.byClient+" "+(i+1),x.calls] as const)],
              [l.byDevice,summary.byDevice.map((x,i)=>[l.byDevice+" "+(i+1),x.calls] as const)]
            ] as const).map(([title,items])=>(
              <div key={title}><h5>{title}</h5>
                {items.length?items.slice(0,5).map(([name,count])=>(
                  <p key={name}><span>{name}</span><strong>{fmt(count)}</strong></p>
                )):<small>{l.noBreakdown}</small>}
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
