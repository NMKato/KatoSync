// Created by NMKato Solutions
// Read-only handoff preview. It does not dispatch code jobs or upload to a provider.
import { useState } from "react";
import { ClipboardCopy, Loader2, RefreshCcw, ShieldAlert } from "lucide-react";
import type { RegistryProject } from "../types";
import { loadFreshProjectResume } from "../repositories/projectRegistryRepository";
import {
  buildProjectWorkResume, formatProjectWorkResume, type ProjectWorkResumePacket
} from "../lib/projectWorkResume";

export function ProjectWorkResumePanel({ project }: { project: RegistryProject }) {
  const [packet, setPacket] = useState<ProjectWorkResumePacket | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setPacket(null);
    setError(null);
    setCopied(false);
    try {
      const result = await loadFreshProjectResume(project.id);
      if (result.projectId !== project.id) throw new Error("project identity mismatch");
      setPacket(buildProjectWorkResume(project, result.probe, result.registeredHead, new Date().toISOString()));
    } catch {
      // Never reflect exception paths or raw repo content back into UI.
      setError("Projektübergabe derzeit nicht möglich. Registry, lokalen Projektordner und Git-Zustand prüfen.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!packet) return;
    try {
      await navigator.clipboard.writeText(formatProjectWorkResume(packet));
      setCopied(true);
    } catch {
      setError("Zwischenablage nicht verfügbar. Das JSON kann unten manuell kopiert werden.");
    }
  }

  return (
    <section className="projects-resume" aria-label="Projektübergabe">
      <strong>Projekt weiterarbeiten – Übergabekontext</strong>
      <p className="agent-empty">
        Frischen Git- und Projektstatus als kompaktes JSON für ChatGPT, Claude oder lokale Modelle vorbereiten.
        Das Paket wird nicht automatisch an einen Anbieter gesendet.
      </p>
      <button className="secondary compact-button" type="button" disabled={busy} onClick={() => void refresh()}>
        {busy ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
        {busy ? "Projekt wird lokal geprüft…" : "Aktuellen Projektkontext erzeugen"}
      </button>
      {error ? <p className="tone-warn" role="alert"><ShieldAlert size={14} /> {error}</p> : null}
      {packet ? (
        <div className="projects-resume-result">
          <p className={packet.assessment === "verified_source_state" ? "tone-ok" : "tone-warn"}>
            {packet.assessment === "verified_source_state" ? "Projektquellen lokal geprüft." : "Prüfbedarf / abweichender Projektstatus."}
            {" "}Git: {packet.git.branch ?? "detached"} @ {packet.git.headSha?.slice(0, 8)}
            {" · "}Schreibfreigabe: nein.
          </p>
          {packet.readinessReasons.length ? (
            <ul>
              {packet.readinessReasons.map((reason) => <li key={reason}>{reason.replace(/_/g, " ")}</li>)}
            </ul>
          ) : null}
          <p className="agent-empty">
            Hinweise aus Memory/Status sind noch keine geprüften Handlungsanweisungen.
            Die unpersonalisierte KUAS-Basis ({packet.policy.version}) ist enthalten.
            Persönliche Projektprofile, Tests und Writer-Lease müssen vor Codeänderungen gesondert geprüft werden.
            Teile das Paket mit Cloud-Modellen nur, wenn das Projekt dies erlaubt.
          </p>
          <button className="ghost compact-button" type="button" onClick={() => void copy()}>
            <ClipboardCopy size={14} /> {copied ? "Übergabepaket kopiert" : "Übergabepaket kopieren"}
          </button>
          <textarea
            aria-label="Projektübergabe JSON"
            readOnly
            rows={7}
            value={formatProjectWorkResume(packet)}
          />
        </div>
      ) : null}
    </section>
  );
}
