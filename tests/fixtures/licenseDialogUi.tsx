// Created by NMKato Solutions. Real component; synthetic callbacks only.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../../src/i18n";
import { LicenseDialog } from "../../src/components/LicenseDialog";

declare global { interface Window { __licenseCalls: string[]; } }
const params = new URL(location.href).searchParams;
localStorage.setItem("katosync.lang", params.get("lang") ?? "de");
document.documentElement.dataset.theme = params.get("theme") ?? "dark";
window.__licenseCalls = [];

function Fixture() {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const accepted = params.get("accepted") === "1";
  return <>
    <main id="qa-background">
      <button id="open-license" onClick={() => setOpen(true)}>Open terms</button>
      <button id="background-action">Background action</button>
      <div id="palette" style={{ background: "var(--bg)", padding: 32 }}>
        <button className="primary" id="palette-primary">Continue</button>
        <button className="danger solid" id="palette-danger">Delete</button>
        <span id="palette-hint" style={{ color: "var(--text-faint)" }}>Supporting text</span>
      </div>
    </main>
    <aside id="previously-inert"><button>Unavailable before modal</button></aside>
    {open ? <LicenseDialog
      accepted={accepted} checked={checked} onCheckedChange={setChecked}
      onAccept={() => { window.__licenseCalls.push("accept"); setOpen(false); }}
      onClose={() => { window.__licenseCalls.push("close"); setOpen(false); }}
      onQuit={() => { window.__licenseCalls.push("quit"); }}
    /> : null}
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
