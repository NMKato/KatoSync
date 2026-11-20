// Created by NMKato Solutions
// Actual C12 React connection cockpit with synthetic targets; no native IPC or account actions.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] || "/tmp/katosync-c12-cockpit-qa-20261120");
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["tests/fixtures/accountMeshUi.tsx"],
  bundle: true, outfile: join(output, "bundle.js"),
  platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
  logLevel: "warning"
});
await writeFile(join(output, "index.html"),
  '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="bundle.css"></head><body><div id="root"></div><script src="bundle.js"></script></body></html>');
const allowed = new Map(await Promise.all([
  ["/", "index.html", "text/html; charset=utf-8"],
  ["/bundle.js", "bundle.js", "text/javascript; charset=utf-8"],
  ["/bundle.css", "bundle.css", "text/css; charset=utf-8"],
  ["/katosync_logo_centered.png", "logo", "image/png"],
  ["/agent-openai.png", "openai", "image/png"],
  ["/agent-claude.png", "claude", "image/png"]
].map(async ([uri, file, type]) => [
  uri, { content: await readFile(
    file === "logo" ? join(root, "public/katosync_logo_centered.png")
    : file === "openai" ? join(root, "public/agent-openai.png")
    : file === "claude" ? join(root, "public/agent-claude.png")
    : join(output, file)), type }
])));
const server = createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
  if (pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  const item = allowed.get(pathname);
  if (!item) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": item.type, "Cache-Control": "no-store" });
  res.end(item.content);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = process.env.KATOSYNC_QA_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cases = [
  { width: 1240, height: 820, theme: "dark", lang: "de" },
  { width: 1040, height: 720, theme: "dark", lang: "en" },
  { width: 820, height: 740, theme: "light", lang: "es" },
  { width: 390, height: 780, theme: "light", lang: "ru" }
];
const selectedCases = process.argv.includes("--mobile-only") ? cases.filter(item => item.width === 390) : cases;
const screenshots = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(existsSync(chrome) ? { executablePath: chrome } : {})
  });
  for (const state of selectedCases) {
    const page = await browser.newPage({
      viewport: { width: state.width, height: state.height },
      reducedMotion: "reduce"
    });
    const events = [], external = [];
    page.on("pageerror", error => events.push(error.message));
    page.on("request", request => {
      if (!request.url().startsWith(origin)) external.push(request.url());
    });
    const url = new URL(origin);
    Object.entries({ ...state, view: "cockpit", scene: "ready" }).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    await page.goto(url.href, { waitUntil: "load", timeout: 60_000 });
    await page.locator(".connection-cockpit-tile").first().waitFor();
    assert.equal(await page.locator(".connection-cockpit-tile").count(), 5);
    const metrics = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".connection-cockpit-tile")];
      return {
        synthetic: window.__qaSynthetic === true,
        native: typeof window.__TAURI_INTERNALS__ !== "undefined",
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        buttons: buttons.map(button => {
          const b = button.getBoundingClientRect();
          return { label: button.textContent?.trim(), width: b.width, height: b.height, left: b.left, right: b.right };
        })
      };
    });
    assert.ok(metrics.synthetic && !metrics.native, "QA must remain synthetic");
    assert.ok(metrics.width <= metrics.viewport + 1, "Unexpected horizontal overflow: " + JSON.stringify(metrics));
    for (const button of metrics.buttons) {
      assert.ok(button.width >= 44 && button.height >= 44, "Tap target too small: " + button.label);
      assert.ok(button.left >= -1 && button.right <= metrics.viewport + 1, "Clipped tile: " + button.label);
    }
    assert.equal(await page.locator('img[src="/agent-openai.png"]').count(), 1);
    assert.equal(await page.locator('img[src="/agent-claude.png"]').count(), 1);
    const targets = [
      ["SmartMesh", "section-account-devices"],
      ["ChatGPT MCP", "remote-mcp-owner-card"],
      ["OpenAI Codex", "provider-card-codex"],
      ["Claude Code", "provider-card-claude"]
    ];
    for (const [label, target] of targets) {
      await page.getByRole("button", { name: new RegExp(label, "i") }).first().click();
      const focused = await page.evaluate(() => document.activeElement?.className + " " + document.activeElement?.id);
      assert.ok(focused.includes(target), "Navigation did not focus " + target + ": " + focused);
      assert.deepEqual(await page.evaluate(() => window.__meshActions), [], "Navigation must not trigger approvals");
    }
    assert.deepEqual(external, [], "External requests forbidden");
    assert.deepEqual(events, [], "No browser error permitted");
    const name = `c12-cockpit-${state.width}-${state.theme}-${state.lang}`;
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(output, name + ".png"), fullPage: true });
    screenshots.push({ ...state, file: name + ".png", metrics });
    console.log("C12_COCKPIT_VIEW_PASS", name);
    await page.close();
  }
  const result = { result: "PASS", scenarios: screenshots.length, synthetic: true,
    noAuthOrNativeActions: true, noExternalRequests: true, screenshots };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ result: result.result, scenarios: result.scenarios,
    screenshotNames: screenshots.map(x => x.file) }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
