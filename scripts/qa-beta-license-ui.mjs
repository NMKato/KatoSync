// Created by NMKato Solutions. Real React dialog and CSS; no native calls or real consent.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright";
const root = new URL("../", import.meta.url).pathname;
const bundle = await build({
  absWorkingDir: root, entryPoints: ["tests/fixtures/licenseDialogUi.tsx"],
  bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }
});
const logo = readFileSync(new URL("../public/katosync_logo_centered.png", import.meta.url));
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8") +
  "\n" + readFileSync(new URL("../src/experiencePolish.css", import.meta.url), "utf8");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } :
    process.platform === "darwin" ? { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" } : {})
});
const output = process.env.KATOSYNC_UI_QA_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
let passed = 0;
try {
  for (const lang of ["de", "en", "es", "ru"]) {
    for (const theme of ["light", "dark"]) {
      for (const [width, height] of [[1380, 860], [1550, 390], [390, 600]]) {
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
        const failures = [], requests = [];
        page.on("pageerror", error => failures.push(error.message));
        await page.route("**/*", route => {
          const path = new URL(route.request().url()).pathname;
          if (route.request().url().startsWith("http://katosync-ui.test/")) {
            if (path === "/") return route.fulfill({ contentType: "text/html",
              body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
            if (path === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
            if (path === "/katosync_logo_centered.png") return route.fulfill({ contentType: "image/png", body: logo });
          }
          requests.push(route.request().url().split("?")[0]);
          return route.abort();
        });
        await page.goto("http://katosync-ui.test/?lang=" + lang + "&theme=" + theme);
        await page.addStyleTag({ content: css });
        await page.locator("#previously-inert").evaluate(element => { element.inert = true; });
        await page.locator("#open-license").click();
        await page.waitForFunction(() => document.activeElement?.id === "license-title");
        assert.equal(await page.locator("#qa-background").evaluate(element => element.inert), true);
        assert.equal(await page.locator(".license-actions .primary").isDisabled(), true);
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".license-dialog").count(), 1, "Escape must not accept unaccepted terms");
        assert.deepEqual(await page.evaluate(() => window.__licenseCalls), []);

        const geometry = await page.evaluate(() => {
          const box = selector => {
            const element = document.querySelector(selector), rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
              height: rect.height, width: rect.width, client: element.clientHeight, scroll: element.scrollHeight };
          };
          return { dialog: box(".license-dialog"), header: box(".license-dialog header"),
            body: box(".license-body"), footer: box(".license-dialog footer"),
            checkbox: box(".license-accept input"), buttons: [...document.querySelectorAll(".license-actions button")]
              .map(button => ({ height: button.getBoundingClientRect().height, width: button.getBoundingClientRect().width })),
            documentWidth: document.documentElement.scrollWidth };
        });
        assert.ok(geometry.header.bottom <= geometry.body.top + 1, "Header/body overlap");
        assert.ok(geometry.body.bottom <= geometry.footer.top + 1, "Body/footer overlap");
        assert.ok(geometry.dialog.left >= 0 && geometry.dialog.right <= width + 1, "Dialog outside viewport");
        assert.ok(geometry.documentWidth <= width, "Horizontal overflow");
        assert.ok(geometry.checkbox.width >= 24 && geometry.checkbox.height >= 24, "Checkbox target too small");
        assert.ok(geometry.buttons.every(button => button.height >= 44 && button.width >= 44), "Action target too small");
        if (height <= 620) {
          assert.ok(geometry.body.height >= 220 && geometry.dialog.scroll > geometry.dialog.client, "Text collapsed");
        }

        // Finish CSS color transitions before measuring their final values.
        await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.className), "ghost danger");
        const contrast = await page.evaluate(() => {
          const parse = value => {
            const parts = value.match(/[\d.]+/g)?.map(Number) ?? [];
            return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
          };
          const mix = (top, bottom) => top.slice(0, 3).map((c, i) => c * top[3] + bottom[i] * (1 - top[3]));
          const lum = color => color.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
            .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
          const ratio = (a, b) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
          const background = element => {
            const chain = [];
            for (let node = element; node; node = node.parentElement) chain.unshift(node);
            return chain.reduce((bg, node) => mix(parse(getComputedStyle(node).backgroundColor), bg), [255, 255, 255]);
          };
          const values = [...document.querySelectorAll(".license-dialog h2, .license-dialog h3, .license-dialog p, .license-accept span, .license-actions button:not(:disabled), #palette-primary, #palette-danger, #palette-hint")].map(element => {
            const style = getComputedStyle(element), bg = background(element), fg = mix(parse(style.color), bg);
            const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.667 && Number(style.fontWeight) >= 700);
            return { element: element.id || element.className || element.tagName, ratio: ratio(fg, bg), required: large ? 3 : 4.5 };
          });
          const focused = document.activeElement, style = getComputedStyle(focused);
          return { values, focus: { width: parseFloat(style.outlineWidth),
            ratio: ratio(parse(style.outlineColor).slice(0, 3), background(focused)) } };
        });
        for (const sample of contrast.values) assert.ok(sample.ratio >= sample.required,
          "Contrast " + lang + "/" + theme + ": " + JSON.stringify(sample));
        assert.ok(contrast.focus.width >= 2 && contrast.focus.ratio >= 3, "Focus outline lacks contrast");

        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.className), "license-body");
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT");
        await page.keyboard.press("Space");
        assert.equal(await page.locator(".license-accept input").isChecked(), true);
        assert.equal(await page.locator(".license-actions .primary").isEnabled(), true);
        assert.equal(await page.evaluate(() => document.activeElement?.tagName), "INPUT", "Rerender must not reset focus");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.className), "primary");
        const visible = await page.locator(".license-actions .primary").evaluate(element => {
          const r = element.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        });
        assert.ok(visible, "Focused acceptance action must scroll into view");
        if (output && lang === "de" && width !== 390) {
          await page.locator(".license-dialog").evaluate(element => { element.scrollTop = 0; });
          await page.locator("#license-title").focus();
          await page.screenshot({ path: output + "/" + lang + "-" + theme + "-" + width + "x" + height + ".png" });
          await page.locator(".license-actions .primary").focus();
        }
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.querySelector(".license-dialog") === null);
        assert.deepEqual(await page.evaluate(() => window.__licenseCalls), ["accept"]);
        assert.equal(await page.evaluate(() => localStorage.getItem("katosync.license.acceptedVersion")), null);
        assert.equal(await page.locator("#qa-background").evaluate(element => element.inert), false);
        assert.equal(await page.locator("#previously-inert").evaluate(element => element.inert), true);
        assert.equal(await page.evaluate(() => document.activeElement?.id), "open-license");
        assert.deepEqual(failures, []);
        assert.deepEqual(requests, []);
        console.log(JSON.stringify({ result: "PASS", lang, theme, width, height,
          minTextContrast: Math.min(...contrast.values.map(value => value.ratio)), focusContrast: contrast.focus.ratio }));
        passed++;
        await page.close();
      }
    }
  }
  // Read-only reopening has a real close action and supports Escape without acceptance.
  const page = await browser.newPage({ viewport: { width: 390, height: 600 } });
  await page.route("**/*", route => {
    if (route.request().url().includes("/fixture.js")) return route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles[0].text });
    if (route.request().url().includes("katosync_logo")) return route.fulfill({ contentType: "image/png", body: logo });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>' });
  });
  await page.goto("http://katosync-ui.test/?accepted=1&lang=ru&theme=light");
  await page.addStyleTag({ content: css });
  await page.locator("#open-license").click();
  await page.waitForFunction(() => document.activeElement?.id === "license-title");
  const separated = await page.evaluate(() => {
    const title = document.querySelector("#license-title").getBoundingClientRect();
    const close = document.querySelector(".license-close").getBoundingClientRect();
    return title.right <= close.left;
  });
  assert.ok(separated, "Close button overlaps translated title");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelector(".license-dialog") === null);
  assert.deepEqual(await page.evaluate(() => window.__licenseCalls), ["close"]);
  await page.close();
  console.log("LICENSE_UI_ACCEPTANCE_PASS " + passed + " locale/theme/viewport cases + accepted Escape case");
} finally { await browser.close(); }
