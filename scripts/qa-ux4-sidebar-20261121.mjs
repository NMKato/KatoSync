// Created by NMKato Solutions. Isolated CSS layout QA; no native or network access.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { chromium } from "playwright";

const css = readFileSync(new URL("../src/uxFacelift4.css", import.meta.url), "utf8");
const executablePath = existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
 ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined;
const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  for (const width of [1040, 1380]) {
    const page = await browser.newPage({viewport:{width,height:720}});
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>
      <div class="app-shell mode-agentSync" style="min-width:0;width:100%">
        <aside class="sidebar" style="width:${width===1040?80:238}px">
          <div class="sidebar-footer">
            <div class="ks4-theme-choices ks4-theme-footer" role="group" aria-label="Farbschema">
              <button aria-label="Hell"><span class="ks4-theme-label">Hell</span></button>
              <button aria-label="Dunkel"><span class="ks4-theme-label">Dunkel</span></button>
              <button aria-label="Auto"><span class="ks4-theme-label">Auto</span></button>
            </div>
            <div class="ks40-settings-panel" style="position:static;width:290px">
              <div class="ks4-theme-choices" id="appearance-menu" aria-label="Design">
                <button aria-label="Hell">Hell</button><button aria-label="Dunkel">Dunkel</button>
                <button aria-label="Auto">Auto</button>
              </div>
            </div>
          </div>
        </aside>
      </div></body></html>`);
    const footerDisplay = await page.locator(".ks4-theme-footer").evaluate(el=>getComputedStyle(el).display);
    const menuDisplay = await page.locator("#appearance-menu").evaluate(el=>getComputedStyle(el).display);
    if (width===1040) assert.equal(footerDisplay, "none", "Collapsed sidebar must hide unreadable footer control");
    else {
      assert.notEqual(footerDisplay,"none","Wide sidebar restores all theme controls");
      const boxes = await page.locator(".ks4-theme-footer button").evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,right:r.right,width:r.width}}));
      assert.equal(boxes.length,3);
      assert.ok(boxes.every(b=>b.width>25),"Expanded theme buttons should have usable widths");
      assert.ok(boxes[0].right<=boxes[1].x+1 && boxes[1].right<=boxes[2].x+1, "Theme buttons must not overlap");
    }
    assert.notEqual(menuDisplay,"none","Full theme selection stays in appearance menu");
    console.log(JSON.stringify({event:"UX4_SIDEBAR_QA_PASS",width,footerDisplay,menuDisplay}));
    await page.close();
  }
} finally {
  await browser.close();
}
