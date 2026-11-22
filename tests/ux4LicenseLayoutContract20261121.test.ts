// Created by NMKato Solutions – native Web Inspector license layout regression.
// Tests presentation and acceptance gate only; never grants capabilities.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL("../"+p, import.meta.url), "utf8");
const styles = read("src/styles.css");
const app = read("src/App.tsx");
const dialog = read("src/components/LicenseDialog.tsx");
const legal = read("src/lib/license.ts");

test("short-height license dialog scrolls as a whole instead of collapsing legal text",()=>{
  assert.match(styles, /@media \(max-height: 620px\)/);
  assert.match(styles, /\.license-dialog \{\s*height: auto;\s*max-height: calc\(100dvh - 24px\);/);
  assert.match(styles, /\.license-dialog > \.license-body \{\s*flex: 0 0 auto;/);
  assert.match(styles, /\.license-dialog \.license-body \{\s*min-height: 0;\s*overflow: visible;/);
  assert.match(styles, /overscroll-behavior: contain;/);
});
test("legal body is focusable, named and scrollable with keyboard",()=>{
  assert.match(dialog, /className="license-body" role="region" tabIndex=\{0\} aria-label=\{license.title\}/);
});
test("view layout does not pre-accept the agreement or change any privileged grant",()=>{
  assert.match(dialog, /className="primary" disabled=\{!checked\} onClick=\{onAccept\}/);
  assert.match(app, /localStorage\.setItem\(acceptedLicenseKey, licenseAgreement\.version\)/);
  assert.match(dialog, /checked=\{checked\} onChange=\{\(event\) => onCheckedChange\(event.target.checked\)\}/);
  assert.match(legal, /const VERSION = "4\.0\.0-beta\.1"/);
});
