// Created by NMKato Solutions. Real current agreement text; synthetic page layout only.
// Does NOT accept any agreement, invoke a native command or send a network request.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { licenseAgreement } from "../src/lib/license.ts";
const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
const esc=(s)=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const license=licenseAgreement;
const html=`<!doctype html><html data-theme="light" lang="de"><head><meta charset="utf-8"></head><body>
 <div class="modal-backdrop license-backdrop" role="presentation">
 <section aria-labelledby="license-title" aria-modal="true" class="license-dialog" role="dialog">
   <header><div style="width:64px;height:64px"></div><div><span class="section-label">KatoSync</span>
   <h2 id="license-title">${esc(license.title)}</h2><p>${esc(license.provider)} · Version ${esc(license.version)} · Stand ${esc(license.updatedAt)}</p>
   </div></header>
   <div class="license-body" tabindex="0" aria-label="Lizenztext">
   <p class="license-intro">${esc(license.intro)}</p>
   ${license.sections.map(s=>`<article><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></article>`).join("")}
   <p class="license-contact">Kontakt: ${esc(license.contact)}</p>
   </div>
   <footer><label class="license-accept"><input type="checkbox"><span>${esc(license.acceptance)}</span></label>
   <div class="license-actions"><button class="ghost danger">App beenden</button><button class="primary" disabled>Akzeptieren und starten</button></div>
   </footer>
 </section></div></body></html>`;
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try{
 for(const [width,height] of [[1380,860],[1550,390],[1040,720],[390,600]]){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  const unexpected=[];
  page.on("request",r=>{if(/^https?:/.test(r.url()))unexpected.push(r.url().split("?")[0]);});
  await page.setContent(html,{waitUntil:"domcontentloaded"});
  await page.addStyleTag({content:css});
  const data=await page.evaluate(()=>{
    const geom=(cls)=>{let e=document.querySelector(cls),r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,client:e.clientHeight,scroll:e.scrollHeight,scrollTop:e.scrollTop};};
    return {dialog:geom(".license-dialog"),header:geom(".license-dialog header"),
      body:geom(".license-body"),footer:geom(".license-dialog footer"),
      bodyStyle:getComputedStyle(document.querySelector(".license-body")).overflowY,
      dialogStyle:getComputedStyle(document.querySelector(".license-dialog")).overflowY,
      footerVisible:document.querySelector(".license-dialog footer").getBoundingClientRect().bottom <= innerHeight,
      sectionCount:document.querySelectorAll(".license-body article").length };
  });
  assert.equal(data.sectionCount,license.sections.length);
  assert.deepEqual(unexpected,[],"Unexpected external request");
  assert.ok(data.body.top>=data.header.bottom-2,"Header/text overlap");
  assert.ok(data.footer.top>=data.body.bottom-2,"Body/footer overlap");
  if(height<=620){
    assert.ok(data.dialog.scroll>data.dialog.client+100,
       `Short viewport must scroll the *whole* license dialog, not collapse text (h=${height}, dialog=${JSON.stringify(data.dialog)}, body=${JSON.stringify(data.body)})`);
    assert.ok(data.body.height>=220,"Readability: license text should not be crushed in short inspector viewport");
    const reached=await page.locator(".license-dialog").evaluate(el=>{el.scrollTop=el.scrollHeight;return el.scrollTop>0;});
    assert.ok(reached,"Short dialog must scroll to the acceptance footer");
  } else {
    assert.ok(data.body.client>=180,"Standard dialog body must be readable");
    assert.ok(data.body.scroll>data.body.client+80,"Standard dialog body should scroll");
  }
  console.log(JSON.stringify({result:"PASS",width,height,dialog:data.dialog,body:data.body,footer:data.footer}));
  await page.close();
 }
} finally { await browser.close(); }
