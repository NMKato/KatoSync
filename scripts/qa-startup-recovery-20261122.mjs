// Built React application; synthetic IPC only. No native account, keychain or network access.
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve, extname} from "node:path";
import {chromium} from "playwright";
import {defaultConfig} from "../src/lib/defaults.ts";

const root=resolve("dist");
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".svg":"image/svg+xml"};
const server=createServer(async(req,res)=>{
  const path=resolve(root, "."+new URL(req.url,"http://localhost").pathname.replace(/\/$/,"/index.html"));
  if(!path.startsWith(root+"/")){res.writeHead(403);res.end();return;}
  try{res.setHeader("content-type",mime[extname(path)]??"application/octet-stream");res.end(await readFile(path));}
  catch{res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:process.env.KATOSYNC_CHROMIUM_PATH??"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try{
  for(const failure of [true,false]){
    const context=await browser.newContext({viewport:{width:1040,height:720}});
    await context.route("**/*",route=>route.request().url().startsWith(origin+"/")?route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript(({config,failure})=>{
      localStorage.setItem("katosync.lang","de");
      localStorage.setItem("katosync.theme","light");
      window.__startupCalls=[];
      let attempts=0;
      window.__TAURI_INTERNALS__={
        transformCallback(){return 1;}, unregisterCallback(){},
        async invoke(command){
          window.__startupCalls.push(command);
          if(command==="load_config"){
            attempts++;
            if(failure&&attempts===1)throw new Error("STARTUP_READ_TEST_FAILURE");
            return config;
          }
          if(command==="supabase_session_status"){
            if(attempts===1)return new Promise(resolve=>{window.__releaseStartup=()=>resolve({loggedIn:false});});
            return {loggedIn:false};
          }
          if(command==="api_key_status"||command==="mcp_connector_token_status")return {exists:false};
          if(command==="launch_agent_status")return {installed:false,loaded:false,message:""};
          if(command==="provider_statuses")return [];
          if(command==="plugin:event|listen")return 1;
          return null;
        }
      };
    },{config:defaultConfig,failure});
    await page.goto(origin);
    await page.locator(".boot-card").waitFor();
    assert.equal(await page.evaluate(()=>window.__startupCalls.filter(x=>x==="supabase_session_status").length),1);
    if(failure){
      assert.equal(await page.getByRole("alert").textContent(),"STARTUP_READ_TEST_FAILURE");
      const retry=page.getByRole("button",{name:"Erneut versuchen"});
      assert.equal(await retry.isDisabled(),true,"no second prompt before first settles");
      await page.evaluate(()=>window.__releaseStartup());
      await retry.waitFor();
      await page.waitForFunction(()=>!document.querySelector(".boot-card button").disabled);
      assert.ok((await retry.boundingBox()).height>=44);
      await retry.focus();await page.keyboard.press("Enter");
      await page.locator(".boot-card").waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>window.__startupCalls.filter(x=>x==="supabase_session_status").length),2);
      assert.ok(await page.locator("input[type=password]").count(),"recovery reaches signed-out login without granting anything");
    }else{
      await page.getByRole("status").filter({hasText:"Schlüsselbund"}).waitFor({timeout:12000});
      assert.equal(await page.locator(".boot-card button").count(),0,"no repeated OS read while pending");
      await page.evaluate(()=>window.__releaseStartup());
      await page.locator(".boot-card").waitFor({state:"detached"});
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({case:failure?"error_retry_no_duplicate_prompt":"pending_permission_visible",result:"PASS"}));
    await context.close();
  }
}finally{await browser.close();await new Promise(done=>server.close(done));}
