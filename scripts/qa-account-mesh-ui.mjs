// Created by NMKato Solutions
// Komponentenprüfung mit synthetischen Daten; keine nativen Befehle, Modelle oder Freigaben.
// App-Navigation, echte Konten und die Tauri/WebKit-Darstellung bleiben separate Prüfschritte.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] || join(tmpdir(), "katosync-account-ui-" + Date.now()));
const railOnly = process.argv.slice(3).includes("--rail-only");
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ["tests/fixtures/accountMeshUi.tsx"], bundle: true,
  outfile: join(output, "bundle.js"), platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "warning"
});
// Diese Hülle ermöglicht Scrollen für isolierte Komponenten. 390 px behauptet keine mobile App-Unterstützung.
await writeFile(join(output, "index.html"), `<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KatoSync · synthetische UI-Prüfung</title><link rel="stylesheet" href="bundle.css">
<style>
body{min-width:0;height:auto;min-height:100vh;overflow:auto}
.qa-synthetic-banner{padding:10px 18px;color:var(--text-muted);background:var(--surface-2);border-bottom:1px solid var(--line);font-size:10px;letter-spacing:.08em;text-align:center}
.qa-component-workspace{max-width:976px;margin:28px auto;padding:0 18px 28px}
</style></head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);
const files = new Map(await Promise.all([
  ["/", join(output, "index.html"), "text/html; charset=utf-8"],
  ["/bundle.js", join(output, "bundle.js"), "text/javascript; charset=utf-8"],
  ["/bundle.css", join(output, "bundle.css"), "text/css; charset=utf-8"],
  ["/katosync_logo_centered.png", join(root, "public/katosync_logo_centered.png"), "image/png"]
].map(async ([url, file, type]) => [url, { body: await readFile(file), type }])));
// Nur eine feste Asset-Liste auf Loopback; weder Verzeichniszugriff noch externe Inhalte.
const server = createServer((request, response) => {
  const path = new URL(request.url || "/", "http://127.0.0.1").pathname;
  if (path === "/favicon.ico") { response.writeHead(204); response.end(); return; }
  const file = files.get(path);
  if (!file) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": file.type, "Cache-Control": "no-store" }); response.end(file.body);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = "http://127.0.0.1:" + server.address().port;
const configuredChrome = process.env.KATOSYNC_QA_CHROME;
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = configuredChrome || (existsSync(macChrome) ? macChrome : undefined);
const records = [], errors = [], externalRequests = [], screenshots = [], contrastReports = [];
const themeBackgrounds = new Map();
let browser, page, browserVersion;
const log = (name, details = {}) => {
  records.push({ name, ...details }); console.log(JSON.stringify({ event: "UI_CHECK_PASS", name, ...details }));
};
const actions = () => page.evaluate(() => window.__meshActions);
const count = async name => (await actions()).filter(action => action.name === name).length;

async function open({ scene = "ready", width = 1240, height = 820, lang = "de",
  theme = "dark", names = "normal", view = "devices", brain = "installed" } = {}) {
  await page.setViewportSize({ width, height });
  const url = new URL(origin);
  for (const [key, value] of Object.entries({ scene, lang, theme, names, view, brain })) url.searchParams.set(key, value);
  await page.goto(url.href, { waitUntil: "load", timeout: 90_000 });
  await page.locator(view === "gateway" ? ".mode-gateway" : view === "brain" ? ".local-brain-card" : view === "rail" ? ".qa-sidebar-rail" : ".account-devices-card").waitFor();
  const state = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
    synthetic: window.__qaSynthetic, nativeBridge: typeof window.__TAURI_INTERNALS__ !== "undefined"
  }));
  assert.equal(state.theme, theme); assert.equal(state.synthetic, true); assert.equal(state.nativeBridge, false);
  assert.ok(state.background, "Die echten Theme-Tokens müssen geladen sein");
  themeBackgrounds.set(theme, state.background);
  assert.deepEqual(await actions(), [], "Das Öffnen einer Ansicht löst keine Aktion aus");
}

async function noOverflow(name) {
  const size = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight, content: document.documentElement.scrollWidth,
    dialog: document.querySelector("dialog[open]")?.getBoundingClientRect().toJSON(),
    clippedControls: [...document.querySelectorAll("button")].filter(button => {
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).map(button => button.textContent?.trim())
  }));
  assert.ok(size.content <= size.width + 1, name + ": horizontaler Überlauf " + JSON.stringify(size));
  assert.deepEqual(size.clippedControls, [], name + ": Bedienelement außerhalb des sichtbaren Bereichs");
  if (size.dialog) {
    assert.ok(size.dialog.left >= -1 && size.dialog.right <= size.width + 1, name + ": Dialog horizontal abgeschnitten");
    assert.ok(size.dialog.top >= -1 && size.dialog.bottom <= size.height + 1, name + ": Dialog vertikal abgeschnitten");
  }
}

// Messung nur bei nachvollziehbaren, einfarbigen Hintergrundschichten bis zur ersten opaken Fläche.
// Gradienten, Filter oder Gruppen-Opacity werden ausdrücklich nicht als Kontrastnachweis ausgegeben.
async function contrast(name, selector) {
  const targets = await page.locator(selector).evaluateAll(elements => {
    const parse = value => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const parts = match[1].replaceAll("/", " ").split(/[,\s]+/).filter(Boolean);
      const channel = part => part.endsWith("%") ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part);
      const alpha = part => part?.endsWith("%") ? Number.parseFloat(part) / 100 : Number.parseFloat(part ?? "1");
      const result = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha(parts[3])];
      return result.every(Number.isFinite) ? result : null;
    };
    const over = (front, back) => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      return [0, 1, 2].map(index => (front[index] * front[3] +
        back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha);
    };
    const luminance = color => {
      const linear = color.slice(0, 3).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    return elements.filter(element => element.getBoundingClientRect().width > 0).map(element => {
      const style = getComputedStyle(element), layers = [], unsupported = [];
      let opaque = false;
      for (let node = element; node; node = node.parentElement) {
        const computed = getComputedStyle(node);
        if (Number(computed.opacity) !== 1) unsupported.push("group-opacity");
        if (computed.filter !== "none") unsupported.push("filter");
        if (!opaque) {
          if (computed.backgroundImage !== "none") unsupported.push("background-image");
          const color = parse(computed.backgroundColor);
          layers.push({ element: node.tagName.toLowerCase() + (node.className ? "." + String(node.className).trim().replaceAll(" ", ".") : ""),
            backgroundColor: computed.backgroundColor, backgroundImage: computed.backgroundImage, rgba: color });
          if (!color) unsupported.push("unparsed-background");
          if (color?.[3] === 1) opaque = true;
        }
      }
      const foreground = parse(style.color);
      if (!foreground) unsupported.push("unparsed-foreground");
      if (!opaque) unsupported.push("no-opaque-background");
      const evidence = { text: element.textContent?.trim(), color: style.color, fontSize: style.fontSize,
        fontWeight: style.fontWeight, layers, unsupported: [...new Set(unsupported)] };
      if (unsupported.length) return { ...evidence, measured: false, ratio: null };
      let background = layers.at(-1).rgba;
      for (const layer of layers.slice(0, -1).reverse()) background = over(layer.rgba, background);
      const renderedText = over(foreground, background);
      const a = luminance(renderedText), b = luminance(background);
      return { ...evidence, measured: true, background: background.slice(0, 3),
        renderedText: renderedText.slice(0, 3), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
    });
  });
  contrastReports.push({ name, selector, targets });
  assert.ok(targets.length > 0, name + ": keine Status- oder Freigabetexte gefunden");
  for (const target of targets) {
    assert.equal(target.measured, true, name + ": keine belastbare Messung für " + target.text + ": " + target.unsupported.join(", "));
    assert.ok(target.ratio >= 4.5, name + ": Textkontrast unter 4,5:1: " + target.text + " (" + target.ratio.toFixed(2) + ")");
  }
  log("scoped-status-text-contrast", { state: name, samples: targets.length,
    minimumRatio: Number(Math.min(...targets.map(target => target.ratio)).toFixed(3)) });
}

async function snapshot(name) {
  await page.screenshot({ path: join(output, name + ".png"), fullPage: true, timeout: 90_000 });
  screenshots.push({ name, file: name + ".png", viewport: page.viewportSize() });
}

async function tabTo(locator) {
  for (let step = 0; step < 30; step += 1) {
    if (await locator.evaluate(element => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  assert.fail("Das Ziel war mit Tab nicht erreichbar");
}

async function visibleKeyboardFocus(locator) {
  const state = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(":focus-visible"), outline: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth), shadow: style.boxShadow };
  });
  assert.equal(state.visible, true, "Tastaturfokus muss als focus-visible erkennbar sein");
  assert.ok((state.outline !== "none" && state.width > 0) || state.shadow !== "none",
    "Ein sichtbarer Fokusring muss vorhanden sein");
}

// Die Regression war innerhalb der App sichtbar, obwohl die Seite selbst nicht horizontal scrollte.
async function sidebarRailChecks() {
  for (const theme of ["dark", "light"]) {
    await open({ view: "rail", theme, width: 1040, height: 720 });
    await snapshot("sidebar-rail-" + theme + "-1040x720");
    const geometry = await page.locator(".sidebar").evaluate(sidebar => {
      const rect = element => element.getBoundingClientRect().toJSON();
      const badge = sidebar.querySelector(".sidebar-katoos-family-badge");
      return {
        rail: rect(sidebar), modeButtons: [...sidebar.querySelectorAll(".mode-switch button")].map(rect),
        footerButtons: [...sidebar.querySelectorAll(".sidebar-footer button")].map(rect),
        badge: rect(badge), badgeContent: badge.scrollWidth, badgeWidth: badge.clientWidth
      };
    });
    assert.equal(geometry.rail.width, 80, "1040 px müssen die echte kompakte Sidebar auslösen");
    for (const button of geometry.modeButtons) {
      assert.ok(button.left >= geometry.rail.left && button.right <= geometry.rail.right,
        "Der Moduswechsel muss innerhalb der Sidebar bleiben: " + JSON.stringify(geometry));
      assert.ok(button.width >= 44 && button.height >= 44, "Die Modusbuttons brauchen 44 px große Trefferflächen");
    }
    assert.ok(geometry.modeButtons[1].top >= geometry.modeButtons[0].bottom,
      "Die beiden kompakten Modusbuttons dürfen sich nicht überlagern");
    for (const button of geometry.footerButtons) {
      assert.ok(button.width >= 44 && button.height >= 44, "Footerbuttons brauchen mindestens 44 px große Trefferflächen");
      assert.ok(button.left >= geometry.rail.left && button.right <= geometry.rail.right,
        "Ein Footerbutton ragt in den Arbeitsbereich");
    }
    assert.ok(geometry.badge.left >= geometry.rail.left && geometry.badge.right <= geometry.rail.right,
      "Der Kontobadge muss innerhalb der Sidebar bleiben");
    assert.ok(geometry.badgeContent <= geometry.badgeWidth, "Der Badge-Text darf nicht abgeschnitten sein");
    assert.equal(await page.locator(".app-version-label").isVisible(), false,
      "Die Versionszeile gehört nicht in die kompakte Icon-Leiste");
    await noOverflow("sidebar-rail-" + theme);
    const modes = page.getByRole("group", { name: "Workspace wechseln", exact: true });
    const mistral = modes.getByRole("button", { name: "Zum Mistral Mode wechseln", exact: true });
    const agent = modes.getByRole("button", { name: "Zu Agent Sync wechseln", exact: true });
    await tabTo(mistral); await visibleKeyboardFocus(mistral); await page.keyboard.press("Enter");
    assert.equal(await mistral.getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Tab"); await visibleKeyboardFocus(agent); await page.keyboard.press("Space");
    assert.equal(await agent.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await actions(), [
      { name: "choose", args: { mode: "mistral" } }, { name: "choose", args: { mode: "agentSync" } }
    ], "Der Moduswechsel darf keine Geräte- oder Modellaktion auslösen");
    await snapshot("sidebar-rail-focused-" + theme + "-1040x720");
    log("sidebar-rail-contained-named-keyboard-controls", { theme, width: 1040, height: 720, geometry });
  }
  await open({ view: "rail", width: 1240, height: 820 });
  assert.equal(await page.locator(".sidebar").evaluate(element => element.getBoundingClientRect().width), 232);
  assert.equal(await page.locator(".app-version-label").isVisible(), true);
  for (const label of await page.locator(".mode-switch button > span").all()) assert.equal(await label.isVisible(), true);
  await noOverflow("sidebar-wide-control");
  await snapshot("sidebar-wide-1240x820");
  log("sidebar-wide-labels-preserved", { width: 1240, height: 820 });
}

const escapeHtml = value => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
async function writeReport(status, failure) {
  await writeFile(join(output, "result.json"), JSON.stringify({
    synthetic: true, scope: "components-with-mocked-handlers", selection: railOnly ? "sidebar-rail" : "all-components", status, browserVersion,
    reducedMotion: true, records, screenshots, contrastReports, errors, externalRequests,
    limitations: ["Keine Live-Geräte, Grants oder Modellstarts", "Kein vollständiger App-/Tauri-/WebKit-Nachweis",
      "390 px prüft nur eine isolierte Komponente", "Screenshots benötigen zusätzlich menschliche Sichtprüfung"],
    ...(failure ? { failure } : {})
  }, null, 2) + "\n");
  await writeFile(join(output, "gallery.html"), `<!doctype html><html lang="de"><meta charset="utf-8">
<title>KatoSync UI-Prüfung · ${status}</title><style>body{font:15px system-ui;margin:24px;background:#edf0f4;color:#17202b}main{max-width:1280px;margin:auto}section{margin:24px 0;padding:16px;background:white;border-radius:12px}img{display:block;max-width:100%;height:auto;border:1px solid #cbd3dc}h2{font-size:17px}</style><main>
<h1>KatoSync · synthetische UI-Prüfung</h1><p>Status: ${status}. Ausschließlich Beispielzustände mit Mock-Handlern; keine Live-Freigaben oder Modellstarts.</p>
<p>Diese Galerie ergänzt automatische Prüfungen um die visuelle Sichtkontrolle. Native App-Navigation und WebKit sind separat zu prüfen.</p>
${screenshots.map(item => '<section><h2>' + escapeHtml(item.name) + '</h2><p>' + item.viewport.width + ' × ' + item.viewport.height + '</p><img alt="' + escapeHtml(item.name) + '" src="' + item.file + '"></section>').join("\n")}
</main></html>`);
}

try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  browserVersion = browser.version();
  page = await browser.newPage({ viewport: { width: 1240, height: 820 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests.push(route.request().url()); return route.abort("blockedbyclient");
  });
  if (!railOnly) {
  const dialog = page.getByRole("dialog");

  for (const theme of ["dark", "light"]) {
    await open({ theme });
    assert.equal(await page.locator(".account-device-notification").count(), 0, "Keine doppelte Meldung auf der Geräteseite");
    assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), 0);
    await noOverflow("desktop-ready-" + theme);
    await contrast("ready-" + theme, ".account-device-state, .account-main-status");
    await snapshot("desktop-ready-" + theme);
    const connect = page.getByRole("button", { name: "Verbinden", exact: true });
    await tabTo(connect); await visibleKeyboardFocus(connect); await page.keyboard.press("Enter");
    await dialog.waitFor();
    assert.equal(await count("approve"), 0, "Das Öffnen der Prüfung erteilt keine Freigabe");
    assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
    for (let step = 0; step < 10; step += 1) {
      await page.keyboard.press(step < 5 ? "Tab" : "Shift+Tab");
      assert.equal(await page.evaluate(() => document.activeElement === document.body ||
        document.querySelector("dialog[open]")?.contains(document.activeElement)), true,
      "Hintergrund-Controls dürfen bei geöffnetem Modal keinen Fokus erhalten");
    }
    await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
    assert.equal(await count("approve"), 0, "Escape erteilt keine Freigabe");
    assert.equal(await connect.evaluate(element => document.activeElement === element), true,
      "Nach Escape muss der Fokus zum auslösenden Button zurückkehren");
    await page.keyboard.press("Enter"); await dialog.waitFor();
    const automatic = dialog.locator('input[value="automatic"]');
    await automatic.focus(); await page.keyboard.press("Space");
    assert.equal(await automatic.isChecked(), true); assert.equal(await count("approve"), 0);
    await noOverflow("desktop-approval-" + theme);
    await contrast("approval-" + theme, "dialog[open] .account-device-review-name small, dialog[open] .account-device-modes small, dialog[open] .account-device-scope, dialog[open] .account-device-secondary-note");
    await snapshot("desktop-approval-" + theme);
    await dialog.getByRole("button", { name: "Gerät freigeben und verbinden", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal((await actions()).find(action => action.name === "approve")?.args.mode, "automatic");
    await page.getByRole("button", { name: "Verbindung trennen", exact: true }).click();
    assert.equal(await count("stop"), 1);
    log("keyboard-review-explicit-approval-and-disconnect", { theme });
  }

  await open();
  await page.getByRole("button", { name: "Hauptgerät wechseln", exact: true }).click();
  assert.equal(await count("primary"), 0);
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await count("primary"), 0);
  await page.getByRole("button", { name: "Hauptgerät wechseln", exact: true }).click();
  await dialog.getByRole("button", { name: "Als Hauptgerät festlegen", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual((await actions()).find(action => action.name === "primary")?.args,
    { deviceId: "20000000-0000-4000-8000-000000000001", expectedRevision: 1 });
  log("primary-choice-explicit-and-revision-bound");

  await open({ scene: "approved" });
  const selectedAutomatic = page.locator('.account-device-connect-area input[value="automatic"]');
  await selectedAutomatic.locator("..").click();
  await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  assert.equal(await selectedAutomatic.isChecked(), true, "Refresh darf die Auswahl nicht zurücksetzen");
  assert.equal(await count("approve"), 0);
  await page.getByRole("button", { name: "Verbinden", exact: true }).click();
  assert.equal((await actions()).find(action => action.name === "connect")?.args.mode, "automatic");
  log("mode-selection-survives-refresh-without-grant");

  await open({ scene: "approved" });
  await page.getByRole("button", { name: "Freigabe verwalten", exact: true }).click();
  await dialog.getByRole("button", { name: "Gerätefreigabe entfernen", exact: true }).click();
  assert.equal(await count("revoke"), 0, "Entfernen benötigt die zweite sichtbare Bestätigung");
  await dialog.getByRole("button", { name: "Gerätefreigabe entfernen", exact: true }).click();
  await dialog.waitFor({ state: "hidden" }); assert.equal(await count("revoke"), 1);
  log("revoke-requires-confirmation");

  await open({ scene: "add" });
  assert.equal(await count("add"), 0);
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  assert.equal(await count("add"), 1); log("registration-is-explicit");

  for (const theme of ["dark", "light"]) {
    for (const { width, height } of [{ width: 1240, height: 820 }, { width: 1040, height: 720 }]) {
      const dimensions = width + "x" + height;
      await open({ view: "gateway", theme, width, height });
      await noOverflow("gateway-" + theme + "-" + dimensions);
      assert.equal(await page.locator(".mode-gateway-head img").evaluate(image => image.complete && image.naturalWidth > 0), true);
      const devices = page.locator(".gateway-device-action");
      await tabTo(devices); await visibleKeyboardFocus(devices);
      await snapshot("gateway-" + theme + "-" + dimensions);
      await page.keyboard.press("Enter"); await page.locator("#section-account-devices").waitFor();
      assert.deepEqual((await actions()).map(action => action.name), ["view"],
        "Der Gateway-Callback öffnet ausschließlich die synthetische Geräteansicht");
      assert.equal(await page.locator("#section-account-devices").evaluate(element => document.activeElement === element), true);
      await noOverflow("gateway-target-" + theme + "-" + dimensions);
      log("gateway-keyboard-callback-and-fixture-focus", { theme, width, height });

      for (const scene of ["ready", "connected"]) {
        await open({ scene, names: "long", theme, width, height });
        await noOverflow("long-names-" + scene + "-" + theme + "-" + dimensions);
        assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), scene === "connected" ? 1 : 0);
        if (scene === "connected" && width === 1240) await contrast("connected-" + theme, ".account-device-state, .account-main-status");
        await snapshot("long-names-" + scene + "-" + theme + "-" + dimensions);
        log("long-device-names", { scene, theme, width, height });
      }
    }

    for (const scene of ["ready", "empty", "add", "connected", "offline", "review"]) {
      await open({ scene, width: 390, height: 900, theme, names: "long" });
      if (scene === "review") await dialog.waitFor();
      await noOverflow("narrow-" + scene + "-" + theme);
      if (scene === "connected") assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), 1);
      if (scene === "offline") assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), 0);
      if (scene === "empty") assert.equal(await page.locator(".account-devices-empty").count(), 1);
      if (scene === "ready" || scene === "review") await snapshot("narrow-" + scene + "-" + theme);
      if (scene === "review") {
        await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
        assert.equal(await count("approve"), 0);
      }
      log("narrow-component", { scene, theme, width: 390 });
    }

    for (const lang of ["en", "es", "ru"]) {
      await open({ width: 640, height: 900, lang, theme, names: "long" });
      await noOverflow("localized-" + lang + "-" + theme);
      const title = await page.locator("#account-devices-title").textContent();
      assert.ok(title && title.length > 3, "Eine lokalisierte Überschrift muss vorhanden sein");
      assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
      log("localized-component", { lang, theme, title });
    }

    for (const brain of ["installed", "running", "memory", "installing", "unsupported", "uninstalled"]) {
      const width = brain === "installed" ? 1240 : 1040;
      await open({ view: "brain", brain, theme, width, height: brain === "installed" ? 820 : 720 });
      await noOverflow("local-brain-" + brain + "-" + theme);
      assert.equal(await page.locator(".local-brain-memory-note").count(), 1);
      assert.ok((await page.locator(".local-brain-memory-note").textContent())?.trim().length > 10);
      if (brain === "running") await contrast("local-brain-running-" + theme, ".local-brain-state, .local-brain-memory-note");
      if (["installed", "memory", "installing"].includes(brain)) await snapshot("local-brain-" + brain + "-" + theme);
      if (brain === "installing" || brain === "unsupported") {
        assert.equal(await page.locator(".local-brain-actions button:enabled").count(), 0);
      }
      if (brain === "installing") assert.equal(await page.locator(".local-brain-progress").count(), 1);
      if (brain === "installed") {
        await page.locator(".local-brain-actions .primary").click();
        assert.equal(await count("brain-start"), 1);
        assert.equal(await page.locator(".local-brain-card.running").count(), 1);
        await page.locator(".local-brain-actions .secondary").click();
        assert.equal(await count("brain-stop"), 1);
        assert.equal(await count("brain-install"), 0); assert.equal(await count("brain-remove"), 0);
      }
      if (brain === "uninstalled") {
        await page.locator(".local-brain-actions .primary").click();
        assert.equal(await count("brain-install"), 1);
      }
      log("local-brain-synthetic-state", { brain, theme, width });
    }
  }
  }
  await sidebarRailChecks();
  assert.notEqual(themeBackgrounds.get("dark"), themeBackgrounds.get("light"), "Die beiden Themes müssen unterschiedliche Tokens verwenden");
  assert.deepEqual(errors, [], "Unerwartete Frontend-Ausnahme oder Konsolenfehler");
  assert.deepEqual(externalRequests, [], "Die Prüfung darf keine externen Browserrequests benötigen");
  await writeReport("passed");
  console.log(JSON.stringify({ status: "passed", checks: records.length, screenshots: screenshots.length, output, synthetic: true }));
} catch (error) {
  if (page && !page.isClosed()) await snapshot("failure").catch(() => {});
  await writeReport("failed", String(error)); throw error;
} finally {
  if (browser) await browser.close();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
}
