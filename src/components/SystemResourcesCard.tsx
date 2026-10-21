// Created by NMKato Solutions
// Compact honest device load / Kato AI admission advisory (no foreign process controls).
import { Activity, Cpu, HardDrive, Info, MemoryStick, RefreshCcw, TriangleAlert } from "lucide-react";
import type { ResourceSnapshot } from "../lib/systemResources";
import { formatGiB, percentUsed, resourceWarning } from "../lib/systemResources";

function Meter({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  const shown = value === null ? "—" : Math.round(value) + " %";
  const color = value === null ? "unknown" : value >= 85 ? "high" : value >= 70 ? "medium" : "low";
  return (
    <div className="resource-meter">
      <div className="resource-meter-label"><span>{label}</span><strong>{shown}</strong></div>
      <div className="resource-meter-track" role="progressbar" aria-label={label}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}
        aria-valuetext={value === null ? "Nicht verfügbar" : shown}>
        {value === null ? <span className="resource-meter-unknown" /> :
          <span className={color} style={{ width: `${Math.min(value, 100)}%` }}/>}
      </div>
      <small>{detail}</small>
    </div>
  );
}

export function ResourceWarningBanner({ snapshot, onDismiss, onOpen }: {
  snapshot: ResourceSnapshot | null;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const warning = snapshot ? resourceWarning(snapshot) : null;
  if (!warning) return null;
  return (
    <div className="resource-brief-warning" role="status">
      <TriangleAlert size={17} />
      <div><strong>Ressourcenhinweis zu Kato AI</strong><p>{warning}</p></div>
      <button className="ghost compact-button" type="button" onClick={onOpen}>Details</button>
      <button className="ghost compact-button" type="button" onClick={onDismiss} aria-label="Ressourcenhinweis schließen">Schließen</button>
    </div>
  );
}

export function SystemResourcesCard({ snapshot, loading, onRefresh, katoAiRunning, katoAiInstalled }: {
  snapshot: ResourceSnapshot | null;
  loading: boolean;
  onRefresh: () => void;
  katoAiRunning: boolean;
  katoAiInstalled: boolean;
}) {
  const usage = snapshot ? percentUsed(snapshot.usedRamBytes, snapshot.totalRamBytes) : null;
  const available = snapshot ? formatGiB(snapshot.availableRamBytes) : "—";
  const warning = snapshot && resourceWarning(snapshot);
  return (
    <section className="glass system-resource-card" aria-label="Systemressourcen">
      <div className="system-resource-title">
        <div><Activity size={18}/><strong>Systemressourcen</strong><span className="resource-live">{snapshot ? "Live · lokal" : "Desktop"}</span></div>
        <button type="button" className="ghost compact-button" onClick={onRefresh} disabled={loading}>
          <RefreshCcw size={14} className={loading ? "spin" : ""}/> Aktualisieren
        </button>
      </div>
      {snapshot ? <>
        <div className="system-resource-grid">
          <div className="resource-tile">
            <Cpu size={16} className="resource-tile-icon"/>
            <Meter label="CPU" value={snapshot.cpuPercent} detail="Gesamtauslastung"/>
          </div>
          <div className="resource-tile">
            <MemoryStick size={16} className="resource-tile-icon"/>
            <Meter label="Arbeitsspeicher" value={usage}
              detail={`${available} verfügbar · ${formatGiB(snapshot.totalRamBytes)} gesamt`}/>
          </div>
          <div className="resource-tile">
            <HardDrive size={16} className="resource-tile-icon"/>
            <Meter label="GPU" value={snapshot.gpu.utilizationPercent}
              detail={snapshot.gpu.name
                ? snapshot.gpu.name + (snapshot.gpu.memoryKind === "unified" ? " · gemeinsamer RAM" : "")
                : "GPU-Auslastung derzeit nicht messbar"}/>
          </div>
        </div>
        <div className={`resource-ai-status ${snapshot.warmupRecommendation}`}>
          {warning ? <TriangleAlert size={16} /> : <Info size={16}/>}
          <div>
            <span className="resource-ai-running">{katoAiRunning ? "Kato AI läuft" : katoAiInstalled ? "Kato AI installiert · nicht gestartet" : "Kato AI noch nicht installiert"}</span>
            <strong>{snapshot.warmupRecommendation === "headroom"
              ? "Kato AI: Speicherreserve vorhanden"
              : snapshot.warmupRecommendation === "caution"
                ? "Kato AI: knappe Speicherreserve"
                : "Kato AI: Speicher knapp"}</strong>
            <p>{warning ?? "Keine aktuelle Speicherwarnung. Der tatsächliche Modellstart kann trotzdem mehr Speicher benötigen."}
              {" "}Schätzung für Modell und Systemreserve: {formatGiB(snapshot.minimumFreeRamBytes)} frei.</p>
          </div>
        </div>
        {snapshot.externalModels.length ? (
          <p className="resource-other-models">
            <strong>Weitere lokale KI erkannt:</strong>{" "}
            {snapshot.externalModels.map(p => `${p.label} (${p.instances}×, ${formatGiB(p.ramBytes)} RAM)`).join(" · ")}.
            {" "}KatoSync beendet diese Prozesse nicht automatisch.
          </p>
        ) : (
          <p className="resource-other-models">Keine weiteren bekannten lokalen KI-Prozesse im Moment erkannt. Die Erkennung ist nicht vollständig.</p>
        )}
        {snapshot.gpu.totalVramBytes !== null ? (
          <p className="resource-other-models">
            <strong>Dedizierter Grafikspeicher:</strong> {formatGiB(snapshot.gpu.totalVramBytes)}.
            {" "}Die tatsächliche Kato-AI-GPU-Beschleunigung ist erst nach Laufzeittest bestätigt.
          </p>
        ) : null}
        {snapshot.gpu.backend === "nvidia_cuda_candidate" ? (
          <p className="resource-other-models">
            NVIDIA-GPU erkannt. Die installierte Kato-AI-Runtime muss CUDA separat unterstützen; eine Erkennung allein aktiviert CUDA nicht.
          </p>
        ) : null}
        <small className="resource-metrics-note">
          GPU-Auslastung und separater VRAM nur bei verlässlicher Betriebssystem-Messung.
          Apple Silicon nutzt gemeinsamen Speicher. Status zuletzt geprüft: {new Date(snapshot.measuredAt).toLocaleTimeString("de-DE")}.
        </small>
      </> : <div className="resource-empty">
        <Info size={16}/> {loading ? "Ressourcen werden lokal gemessen …" : "Ressourcenmessung nur in der Desktop-App verfügbar."}
      </div>}
    </section>
  );
}
