import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
const root=new URL("../",import.meta.url);
const css=readFileSync(new URL("src/styles.css",root),"utf8");
const app=readFileSync(new URL("src/App.tsx",root),"utf8");
test("brand icon is entirely inside its 3D frame and uses centered logo",()=>{
 assert.match(css,/\.brand-mark\s*\{[^}]*width: 88px;[^}]*height: 88px;[^}]*overflow: hidden;/s);
 assert.match(css,/\.brand-mark img\s*\{[^}]*width: 80px;[^}]*height: 80px;/s);
 assert.match(css,/\.brand-mark img\s*\{[^}]*drop-shadow/s);
 assert.match(app,/src="\/katosync_logo_centered\.png"/);
 assert.doesNotMatch(app,/src="\/katoos_icon_logo_trans\.png"/);
});
test("all native macOS icon sizes are emitted by the reproducible builder",()=>{
 const b=readFileSync(new URL("scripts/generate-katosync-icons.py",root),"utf8");
 assert.match(b,/iconutil/);
 for(const filename of ["icon.icns","icon.ico","128x128.png","128x128@2x.png","32x32.png","icon-1024-master.png"]){
  assert.ok(statSync(new URL("src-tauri/icons/"+filename,root)).size>1000,filename);
 }
 assert.ok(statSync(new URL("public/katosync_logo_centered.png",root)).size>1000);
});
