// Created by NMKato Solutions
// 4.0 UX: status-derived onboarding and compact factual summaries. No privileged actions.
import { ArrowRight, CheckCircle2, Circle, FolderGit2, Laptop, Rocket, ShieldCheck, Wifi } from "lucide-react";
import { useT } from "../i18n";
import { useAccountMesh } from "../contexts/AccountMeshContext";
import { devicePresentationState } from "../lib/accountMeshContract";
import { providerDisplayState } from "../lib/providerPolicy";
import type { StepId, useKatoSyncViewModel } from "../viewmodels/useKatoSyncViewModel";

type VM = ReturnType<typeof useKatoSyncViewModel>;
type Navigate = (step: StepId) => void;
const COPY = {
  de: {start:"Erste Schritte", explain:"Agent Sync sicher und schrittweise einrichten.", login:"Konto anmelden", provider:"KI-Provider prüfen", device:"Mesh-Gerät verbinden", project:"Projekt registrieren",
    live:"Aktuelle Systemübersicht", devices:"Geräte", devicesText:"Registriert und tatsächlich verbunden", approvals:"Client-Freigaben", approvalText:"ChatGPT MCP getrennt vom Geräte-Mesh genehmigen",
    projects:"Projekte", projectsText:"Aus der lokalen Projektregistrierung", open:"Öffnen", manage:"Verwalten", connected:"Verbunden", registered:"Registriert",
    unknown:"Nicht bestätigt", pending:"Noch nicht abgeschlossen", none:"Noch kein Projekt", verify:"Status prüfen", source:"Nur nachgewiesene Zustände, keine simulierten Daten"},
  en: {start:"Getting started", explain:"Set up Agent Sync safely, step by step.", login:"Sign in", provider:"Check AI provider", device:"Connect Mesh device", project:"Register project",
    live:"System overview", devices:"Devices", devicesText:"Registered and actually connected", approvals:"Client permissions", approvalText:"Approve ChatGPT MCP separately from device Mesh",
    projects:"Projects", projectsText:"From the local project registry", open:"Open", manage:"Manage", connected:"Connected", registered:"Registered",
    unknown:"Not verified", pending:"Not yet complete", none:"No project registered", verify:"Check status", source:"Only verified states, no simulated data"},
  es: {start:"Primeros pasos", explain:"Configura Agent Sync con seguridad.", login:"Iniciar sesión", provider:"Comprobar proveedor", device:"Conectar equipo Mesh", project:"Registrar proyecto",
    live:"Vista del sistema", devices:"Dispositivos", devicesText:"Registrados y conectados", approvals:"Permisos del cliente", approvalText:"Autorizar ChatGPT MCP por separado",
    projects:"Proyectos", projectsText:"Registro local", open:"Abrir", manage:"Administrar", connected:"Conectado", registered:"Registrado",
    unknown:"Sin verificar", pending:"Pendiente", none:"Sin proyectos", verify:"Comprobar", source:"Solo datos reales"},
  ru: {start:"Первые шаги", explain:"Безопасная настройка Agent Sync.", login:"Войти", provider:"Проверить ИИ", device:"Подключить Mesh", project:"Добавить проект",
    live:"Обзор системы", devices:"Устройства", devicesText:"Зарегистрированные и подключённые", approvals:"Доступ клиентов", approvalText:"Отдельное разрешение ChatGPT MCP",
    projects:"Проекты", projectsText:"Локальный реестр", open:"Открыть", manage:"Управление", connected:"Подключено", registered:"Зарегистрировано",
    unknown:"Не проверено", pending:"Не завершено", none:"Проектов нет", verify:"Проверить", source:"Только реальные данные"}
} as const;

export function AgentSyncOverview40({ vm, onNavigate, onSelectConnection, section = "all" }: { vm: VM; onNavigate: Navigate; onSelectConnection?: (target: "devices" | "mcp") => void; section?: "all" | "guide" | "summary" }) {
  const { lang } = useT();
  const copy = COPY[lang];
  const mesh = useAccountMesh();
  const projects = vm.projects.loaded ? vm.projects.registry.projects : [];
  const remoteDevices = mesh.network?.devices.filter(d => d.deviceId !== mesh.network?.localDeviceId && d.membershipState !== "revoked") ?? [];
  const connected = mesh.network ? remoteDevices.filter(device =>
    devicePresentationState(mesh.network!, mesh.runtime, device.deviceId, mesh.approved, mesh.now) === "connected") : [];
  const cloudReady = vm.providerStatuses.some(s => (s.provider === "codex" || s.provider === "claude") &&
    providerDisplayState(s, s.provider) === "connected");
  const steps = [
    { label: copy.login, done: vm.sessionStatus.loggedIn, target: "agentProviders" as const },
    { label: copy.provider, done: cloudReady, target: "agentProviders" as const },
    { label: copy.device, done: connected.length > 0, target: "agentProviders" as const },
    { label: copy.project, done: projects.length > 0, target: "agentProjects" as const }
  ];
  const done = steps.filter(step => step.done).length;
  const progress = Math.round(done / steps.length * 100);
  return <div className="ks4-hub">
    {section !== "summary" ? <section className="ks4-onboarding" aria-label={copy.start}>
      <div className="ks4-onboard-head">
        <div className="ks4-heading">
          <span className="ks4-heading-icon"><Rocket size={21}/></span>
          <div><h2>{copy.start}</h2><p>{copy.explain}</p></div>
        </div>
        <div className="ks4-progress"><strong>{done} / {steps.length}</strong>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label={copy.start}>
            <span style={{width:progress+"%"}}/>
          </div>
        </div>
      </div>
      <div className="ks4-onboard-steps">
        {steps.map(step => <button type="button" onClick={() => { if (step.label === copy.device && onSelectConnection) onSelectConnection("devices"); else onNavigate(step.target); }} className={step.done ? "is-done" : ""} key={step.label}>
          {step.done ? <CheckCircle2 size={18} aria-hidden="true"/> : <Circle size={18} aria-hidden="true"/>}
          <span>{step.label}</span><ArrowRight size={14} aria-hidden="true"/>
        </button>)}
      </div>
    </section> : null}
    {section !== "guide" ? <>
    <div className="ks4-section-heading"><h2>{copy.live}</h2><small>{copy.source}</small></div>
    <div className="ks4-summary-grid">
      <article className="ks4-summary-card">
        <div className="ks4-card-heading"><span><Laptop size={19}/></span><div><h3>{copy.devices}</h3><p>{copy.devicesText}</p></div><b>{remoteDevices.length}</b></div>
        <div className="ks4-device-mini">
          {remoteDevices.length ? remoteDevices.slice(0,2).map(device => {
            const live = connected.some(item => item.deviceId === device.deviceId);
            return <div key={device.deviceId}><Wifi size={15}/><span>{device.displayName || copy.devices}</span>
              <small className={live ? "ks4-live" : ""}>{live ? copy.connected : copy.registered}</small></div>;
          }) : <p>{copy.unknown}</p>}
        </div>
        <button type="button" className="ks4-card-action" onClick={() => onSelectConnection ? onSelectConnection("devices") : onNavigate("agentProviders")}>{copy.manage}<ArrowRight size={15}/></button>
      </article>
      <article className="ks4-summary-card">
        <div className="ks4-card-heading"><span><ShieldCheck size={19}/></span><div><h3>{copy.approvals}</h3><p>{copy.approvalText}</p></div></div>
        <div className="ks4-mini-copy"><ShieldCheck size={18}/><span>ChatGPT MCP</span>
          <small>{copy.verify}</small></div>
        <p className="ks4-card-note">{copy.unknown} · {copy.verify}</p>
        <button type="button" className="ks4-card-action" onClick={() => onSelectConnection ? onSelectConnection("mcp") : onNavigate("agentProviders")}>{copy.manage}<ArrowRight size={15}/></button>
      </article>
      <article className="ks4-summary-card">
        <div className="ks4-card-heading"><span><FolderGit2 size={19}/></span><div><h3>{copy.projects}</h3><p>{copy.projectsText}</p></div><b>{projects.length}</b></div>
        <div className="ks4-mini-copy"><FolderGit2 size={18}/><span>{projects[0]?.name || copy.none}</span></div>
        <p className="ks4-card-note">{projects[0]?.scan?.branch || copy.unknown} {projects[0]?.scan?.headSha ? " · "+projects[0].scan.headSha.slice(0,8) : ""}</p>
        <button type="button" className="ks4-card-action" onClick={() => onNavigate("agentProjects")}>{copy.open}<ArrowRight size={15}/></button>
      </article>
    </div>
    </> : null}
  </div>;
}
