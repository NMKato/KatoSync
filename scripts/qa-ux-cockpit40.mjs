// Created by NMKato Solutions
// Real production React components, synthetic statuses. Never call native or external endpoints.
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
const output = resolve(process.argv[2] || join(tmpdir(), "katosync-ux-cockpit40-" + Date.now()));
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root, entryPoints: ["tests/fixtures/uxCockpitUi.tsx"],
  bundle: true, outfile: join(output, "bundle.js"), platform: "browser", format: "iife",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  logLevel: "warning"
});
await writeFile(join(output, "index.html"),
  '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>KatoSync isolated cockpit QA</title><link rel="stylesheet" href="/bundle.css">' +
  '<style>body{min-width:0!important;height:auto;min-height:100vh;overflow:auto}' +
  '.ks40-qa-wrap{width:min(1140px,100%);box-sizing:border-box;display:grid;gap:20px;margin:20px auto;padding:0 18px 26px}' +
  '.ks40-qa-banner{padding:11px 16px;color:var(--ks40-muted);border:1px solid var(--ks40-line);border-radius:12px;font-size:12px}' +
  '</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
const entries = [
  ["/", join(output, "index.html"), "text/html; charset=utf-8"],
  ["/bundle.js", join(output, "bundle.js"), "text/javascript; charset=utf-8"],
  ["/bundle.css", join(output, "bundle.css"), "text/css; charset=utf-8"],
  ["/agent-openai.png", join(root, "public/agent-openai.png"), "image/png"],
  ["/agent-claude.png", join(root, "public/agent-claude.png"), "image/png"],
  ["/github-mark-white.svg", join(root, "public/github-mark-white.svg"), "image/svg+xml"]
];
const files = new Map(await Promise.all(entries.map(async ([path, file, type]) =>
  [path, { body: await readFile(file), type }])));
const server = createServer((req, res) => {
  const path = new URL(req.url || "/", "http://127.0.0.1").pathname;
  if (path === "/favicon.ico") { res.writeHead(204);res.end(); return; }
  const entry = files.get(path);
  if (!entry) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": "no-store" });
  res.end(entry.body);
});
await new Promise((ok, reject) => { server.once("error",reject); server.listen(0,"127.0.0.1",ok); });
const origin = "http://127.0.0.1:" + server.address().port;
const localChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.KATOSYNC_QA_CHROME || (existsSync(localChrome) ? localChrome : undefined);
const errors=[],external=[],records=[];
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => { if (!request.url().startsWith(origin)) external.push(request.url()); });
  page.on("console", (message) => { if (message.type()==="error") errors.push(message.text()); });
  const cases = [
    { name: "desktop-dark-de", lang: "de", theme: "dark", width: 1240, height: 900 },
    { name: "compact-light-en", lang: "en", theme: "light", width: 1040, height: 760 },
    { name: "narrow-dark-ru", lang: "ru", theme: "dark", width: 720, height: 840 },
    { name: "component-small-light-es", lang: "es", theme: "light", width: 390, height: 850 }
  ];
  for (const scene of cases) {
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.goto(origin + "/?lang=" + scene.lang + "&theme=" + scene.theme, { waitUntil: "load" });
    await page.locator(".ks40-cockpit-tile").first().waitFor();
    assert.equal(await page.locator(".ks40-cockpit-tile").count(), 6);
    assert.equal(await page.locator(".ks40-evidence-panel").count(), 3);
    if (scene.width === 390) {
      const positions = await page.locator(".ks40-cockpit-tile").evaluateAll((tiles) =>
        tiles.map((tile) => ({ x: tile.getBoundingClientRect().x,
          y: tile.getBoundingClientRect().y, w: tile.getBoundingClientRect().width,
          h: tile.getBoundingClientRect().height })));
      assert.ok(Math.abs(positions[0].y - positions[1].y) < 2,
        "Mobile cockpit must have two columns");
      assert.ok(positions[0].x + positions[0].w <= positions[1].x + 2,
        "Mobile columns must not overlap");
      assert.ok(positions.every(tile => tile.w >= 44 && tile.h >= 44),
        "Every cockpit tile must remain accessible");
    }
    assert.equal(await page.locator(".ks40-cockpit-tile.state-ready").count(), 1,
      "Only the genuinely ready mocked provider is green");
    const initialActions = await page.evaluate(() => window.__cockpitActions || []);
    assert.deepEqual(initialActions, [], "Initial render never executes handlers");
    // Gateway deep link must select the device card, without pairing or logging in.
    await page.getByTestId("gateway-open-devices").click();
    assert.equal(await page.locator(".ks40-cockpit-tile").first().getAttribute("aria-pressed"), "true",
      "Gateway deep link must visibly select the devices tile");
    assert.deepEqual(await page.evaluate(() => window.__cockpitActions || []), [],
      "A device deep link must never initiate an authorization or connection");
    // Pointer click must remain stable even when the tile is hovered.
    await page.locator(".ks40-cockpit-tile").nth(1).click({ timeout: 15000 });
    assert.deepEqual(await page.evaluate(() => window.__cockpitActions || []), [],
      "Pointer selection must not initiate a provider request");
    for (let index = 0; index < 6; index++) {
      await page.locator(".ks40-cockpit-tile").nth(index).focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator(".ks40-cockpit-tile[aria-pressed=true]").count(), 1);
      assert.deepEqual(await page.evaluate(() => window.__cockpitActions || []), [],
        "Selecting tiles cannot authorize or connect services");
    }
    await page.locator(".ks40-cockpit-tile").nth(2).focus();
    await page.keyboard.press("Enter");
    const connect = page.locator(".ks40-cockpit-actions .primary");
    assert.equal(await connect.count(), 1, "Claude sign-in is explicitly actionable");
    await connect.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.__cockpitActions || []), ["connect:claude"]);
    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth, full: document.documentElement.scrollWidth,
      root: document.querySelector(".ks40-qa-wrap")?.getBoundingClientRect().width
    }));
    assert.ok(widths.full <= widths.viewport + 4, "No horizontal overflow: " + JSON.stringify(widths));
    const broken = await page.locator("img").evaluateAll((images) =>
      images.filter((img) => !(img instanceof HTMLImageElement) || !img.complete || img.naturalWidth === 0)
        .map((img) => img.getAttribute("src")));
    assert.deepEqual(broken, [], "All bundled provider brand assets must render");
    const screenshot = join(output, scene.name + ".png");
    await page.screenshot({ path: screenshot, fullPage: true });
    records.push({ ...scene, screenshot, widths, externalRequests: external.length, errors: errors.length });
    console.log(JSON.stringify({ event: "PASS", scene: scene.name, width: widths.full }));
  }
  assert.deepEqual(errors, [], "No browser runtime or console errors");
  assert.deepEqual(external, [], "No external requests from the QA surface");
  const report = { passed: cases.length, failed: 0, screens: records, noNativeBridge: true,
    noExternalRequests: true, realComponents: true, mockedDataOnly: true };
  await writeFile(join(output, "result.json"), JSON.stringify(report, null, 2)+"\n");
  console.log(JSON.stringify({ event: "UX_COCKPIT40_QA_PASS", ...report }));
} finally {
  await browser?.close();
  await new Promise((ok) => server.close(ok));
}
