// Created by NMKato Solutions. Component-only checks with synthetic account data.
// No native commands, live permissions, model starts or device connections occur here.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] || join(tmpdir(), `katosync-account-ui-${Date.now()}`));
await mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: ["tests/fixtures/accountMeshUi.tsx"],
  bundle: true, outfile: join(output, "bundle.js"), platform: "browser", format: "iife",
  jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "warning" });
// The desktop app provides its own scrolling workspace. This isolated component
// fixture supplies page scrolling and allows narrow component-width checks.
// It does not claim that the entire desktop shell supports a mobile viewport.
await writeFile(join(output, "index.html"), `<!doctype html><html lang="de"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KatoSync synthetic device UI check</title><link rel="stylesheet" href="bundle.css">
<style>body{min-width:0;height:auto;min-height:100vh;overflow:auto}</style>
</head><body><div id="root"></div><script src="bundle.js"></script></body></html>`);
const configuredChrome = process.env.KATOSYNC_QA_CHROME;
const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = configuredChrome || (existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const records = [], errors = [];
let page;
const log = (name, details = {}) => { records.push({ name, ...details }); console.log(JSON.stringify({ event: "UI_CHECK_PASS", name, ...details })); };
const actions = () => page.evaluate(() => window.__meshActions);
const count = async (name) => (await actions()).filter(a => a.name === name).length;
async function open(scene, width = 1200, lang = "de") {
  await page.setViewportSize({ width, height: 900 });
  const url = pathToFileURL(join(output, "index.html"));
  url.searchParams.set("scene", scene); url.searchParams.set("lang", lang);
  await page.goto(url.href, { waitUntil: "load", timeout: 90_000 });
  await page.locator(".account-devices-card").waitFor();
}
async function noOverflow(name) {
  const size = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth,
    dialog: document.querySelector("dialog[open]")?.getBoundingClientRect().toJSON() }));
  assert.ok(size.content <= size.width + 1, `${name}: horizontal content overflow ${JSON.stringify(size)}`);
  if (size.dialog) assert.ok(size.dialog.left >= -1 && size.dialog.right <= size.width + 1, `${name}: dialog outside viewport`);
}
async function snapshot(name) { await page.screenshot({ path: join(output, name + ".png"), fullPage: true, timeout: 90_000 }); }
try {
  page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(90_000);
  page.on("pageerror", error => errors.push(error.message));
  await open("ready");
  assert.equal(await page.locator(".account-device-notification").count(), 0, "No duplicate detected-device toast on the devices page");
  assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), 0);
  await snapshot("desktop-ready");
  await page.getByRole("button", { name: "Verbinden", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.equal(await count("approve"), 0, "Opening review never grants approval");
  await dialog.locator("label").filter({ has: page.locator('input[value="automatic"]') }).click();
  assert.equal(await dialog.locator('input[value="automatic"]').isChecked(), true);
  await snapshot("desktop-approval");
  await dialog.getByRole("button", { name: "Gerät freigeben und verbinden", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal((await actions()).find(a => a.name === "approve")?.args.mode, "automatic");
  await page.getByRole("button", { name: "Verbindung trennen", exact: true }).click();
  assert.equal(await count("stop"), 1);
  log("explicit-approval-mode-and-disconnect");

  await open("ready");
  await page.getByRole("button", { name: "Hauptgerät wechseln", exact: true }).click();
  await dialog.getByRole("button", { name: "Als Hauptgerät festlegen", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual((await actions()).find(a => a.name === "primary")?.args,
    { deviceId: "20000000-0000-4000-8000-000000000001", expectedRevision: 1 });
  log("primary-choice-carries-observed-revision");

  await open("approved");
  const automatic = page.locator('.account-device-connect-area input[value="automatic"]');
  await automatic.locator("..").click();
  assert.equal(await automatic.isChecked(), true);
  await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  assert.equal(await automatic.isChecked(), true, "A new profile array must not reset the selected mode");
  await page.getByRole("button", { name: "Verbinden", exact: true }).click();
  assert.equal((await actions()).find(a => a.name === "connect")?.args.mode, "automatic");
  log("remembered-mode-selection-survives-refresh");

  await open("approved");
  await page.getByRole("button", { name: "Freigabe verwalten", exact: true }).click();
  await dialog.getByRole("button", { name: "Gerätefreigabe entfernen", exact: true }).click();
  assert.equal(await count("revoke"), 0, "Revocation requires the visible second confirmation");
  await dialog.getByRole("button", { name: "Gerätefreigabe entfernen", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await count("revoke"), 1);
  log("revoke-requires-confirmation");

  await open("add");
  assert.equal(await count("add"), 0);
  await page.getByRole("button", { name: "Gerät hinzufügen", exact: true }).click();
  assert.equal(await count("add"), 1);
  log("registration-is-an-explicit-action");

  for (const scene of ["ready", "empty", "add", "connected", "offline", "review"]) {
    await open(scene, 390);
    if (scene === "review") await dialog.waitFor();
    await noOverflow(scene);
    if (scene === "connected") assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), 1);
    if (scene === "offline") assert.equal(await page.locator('.account-device-state[data-state="connected"]').count(), 0);
    if (scene === "empty") assert.equal(await page.locator(".account-devices-empty").count(), 1);
    if (scene === "ready" || scene === "review") await snapshot("narrow-" + scene);
    if (scene === "review") {
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
      assert.equal(await count("approve"), 0, "Escape never approves a peer");
    }
    log("narrow-component-" + scene);
  }
  for (const [lang, title] of [["en", "My devices"], ["es", "Mis dispositivos"], ["ru", "Мои устройства"]]) {
    await open("ready", 640, lang); await noOverflow(lang);
    assert.equal(await page.locator("#account-devices-title").textContent(), title);
    log("localized-component-" + lang);
  }
  assert.deepEqual(errors, [], "Unexpected frontend exception");
  await writeFile(join(output, "result.json"), JSON.stringify({ synthetic: true, status: "passed", records, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "passed", checks: records.length, output, synthetic: true }));
} catch (error) {
  await writeFile(join(output, "result.json"), JSON.stringify({ synthetic: true, status: "failed", records, errors,
    failure: String(error) }, null, 2) + "\n");
  throw error;
} finally { await browser.close(); }
