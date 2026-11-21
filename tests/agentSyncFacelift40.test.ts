// Created by NMKato Solutions
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = source("../src/App.tsx");
const guide = source("../src/components/AgentSyncOverview40.tsx");
const styles = source("../src/uxFacelift4.css");
const provider = source("../src/components/ProviderManager.tsx");

test("4.0 Agent Sync preserves the separate Mistral and Agent Sync modes", () => {
  assert.match(app, /<ModeSwitch mode=\{workspaceMode\} onChange=\{enterMode\}/);
  assert.match(app, /isAgentSync \? navSteps : navSteps\.slice\(0, 3\)/);
  assert.match(app, /agentSettings/);
  assert.match(app, /KatoSync 4\.0 · UX Beta/);
});
test("Light defaults on a fresh preference; dark and auto remain explicit", () => {
  assert.match(app, /stored === "dark" \|\| stored === "auto" \? stored : "light"/);
  assert.match(app, /window\.matchMedia\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(app, /media\.addEventListener\("change", update\)/);
  assert.match(app, /media\.removeEventListener\("change", update\)/);
  assert.match(app, /localStorage\.setItem\("katosync\.theme", themeMode\)/);
  assert.match(app, /ux\.themeLight : mode === "dark" \? ux\.themeDark : ux\.themeAuto/);
});
test("Guide only confirms independently observed account, provider, Mesh and local projects", () => {
  assert.match(guide, /sessionStatus\.loggedIn/);
  assert.match(guide, /providerDisplayState/);
  assert.match(guide, /devicePresentationState/);
  assert.match(guide, /projects\.loaded/);
  assert.match(guide, /copy\.unknown/);
  assert.doesNotMatch(guide, /invoke\(|fetch\(|WebSocket\(|localStorage\.setItem/);
});
test("Client permissions and discovered devices are not claimed to be approved", () => {
  assert.match(guide, /ChatGPT MCP/);
  assert.match(guide, /copy\.verify/);
  assert.doesNotMatch(guide, /Client-Freigabe.*true|approval.*true|consent.*true/i);
  assert.match(provider, /<AgentSyncOverview40 vm=\{vm\} onNavigate=\{onNavigate\}/);
  assert.match(provider, /hidden=\{visibleDetail !== "mcp"\}/);
});
test("Responsive compact cards obey reduced-motion, preserve accessibility and theme contrast", () => {
  assert.match(styles, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.ks4-onboard-steps/);
  assert.match(styles, /\.ks4-summary-grid/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /:root\[data-theme="light"\]/);
});
