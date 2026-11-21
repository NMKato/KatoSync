// Created by NMKato Solutions. Regression for minimum-width native UX4 sidebar.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const app=read("src/App.tsx");
const css=read("src/uxFacelift4.css");
const copy=read("src/lib/uxCopy40.ts");

test("collapsed sidebar does not render unreadable three-button footer",()=>{
  assert.match(css, /@media \(max-width: 1120px\)\s*\{\s*\.app-shell\.mode-agentSync \.sidebar-footer \.ks4-theme-footer \{ display: none; \}/);
  assert.match(app, /className="ks4-theme-choices ks4-theme-footer"/);
  assert.match(app, /className="ks40-settings-panel"/);
  assert.match(app, /className="ks4-theme-choices" role="group" aria-label="Design"/);
});

test("collapsed sidebar exposes an appearance and language control, not a duplicate Agent settings label",()=>{
  assert.match(app, /aria-label=\{isAgentSync \? .*ux\.appearance.*ux\.language/);
  assert.match(app, /className=\{"ghost ks40-settings-button"/);
  assert.match(app, /ux\.appearance} · \$\{ux\.language/);
});

test("all three themes remain keyboard-accessible and explicitly named in both locations",()=>{
  assert.equal((app.match(/<span className="ks4-theme-label">/g)||[]).length,2);
  assert.equal((app.match(/aria-pressed=\{themeMode === mode\}/g)||[]).length,2);
  assert.equal((app.match(/aria-label=\{mode === "light"/g)||[]).length,2);
  for (const part of ['themeLight: "Hell"','themeDark: "Dunkel"','themeLight: "Light"','themeDark: "Dark"','themeLight: "Claro"','themeDark: "Oscuro"','themeLight: "Светлая"','themeDark: "Тёмная"']) assert.ok(copy.includes(part),part);
});

test("login success is temporary in Agent Sync; warnings and newer notices stay",()=>{
  assert.match(app, /message\?\.kind !== "ok"/);
  assert.match(app, /message\.text\.startsWith\("Angemeldet als "\)/);
  assert.match(app, /vm\.setNotice\(\(current\) => current === message \? null : current\)/);
  assert.match(app, /window\.clearTimeout\(timeout\)/);
});
