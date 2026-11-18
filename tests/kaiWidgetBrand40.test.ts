import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";
const read=(p:string)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("approved KAI asset is used in both widget header and Ask Anything",()=>{
  const image=new URL("../public/kai-ai-icon.png",import.meta.url);
  assert.ok(statSync(image).size>10000);
  const source=read("src/desktopWidget40.tsx");
  assert.ok(source.includes('const KAI_ICON="/kai-ai-icon.png"'));
  assert.ok(source.includes('<KaiEmblem/>'));
  assert.ok(source.includes('<KaiEmblem small/>'));
  assert.ok(source.includes('alt="Kato AI – KAI-Symbol"'));
  assert.ok(source.includes('Ask Anything…'));
  assert.doesNotMatch(source,/openai-logo|OpenAI\.svg|openai-mark|ChatGPT-Logo/i);
});

test("compact and expanded widget keep real status and actual navigation",()=>{
  const source=read("src/desktopWidget40.tsx");
  assert.ok(source.includes('widgetSnapshotFresh(snapshot,Date.now())'));
  assert.ok(source.includes('localModelRunning'));
  assert.ok(source.includes('snapshot?.activeJobs'));
  assert.ok(source.includes('snapshot?.queuedJobs'));
  assert.ok(source.includes('snapshot?.needsAttention'));
  assert.ok(source.includes('setExpanded(next)'));
  assert.ok(source.includes('invoke("desktop_widget_set_expanded",{expanded:next})'));
  assert.ok(source.includes('navigate("chat")'));
  assert.ok(source.includes('navigate("jobs")'));
  assert.ok(source.includes('navigate("dashboard")'));
  assert.ok(source.includes('navigate("agent")'));
  assert.doesNotMatch(source,/68%|2,847|16\.4 GB|Llama 3\.1|Syncing project workspace/);
});

test("no fake send: Ask Anything is an explicit navigation to existing chat",()=>{
  const source=read("src/desktopWidget40.tsx");
  const begin=source.indexOf('className="kai-ask-anything"');
  assert.ok(begin>0);
  const part=source.slice(begin,begin+425);
  assert.ok(part.includes('onClick={()=>void navigate("chat")}'));
  assert.ok(part.includes('<KaiEmblem small/>'));
  assert.ok(!part.includes('remote_task_execute'));
});

test("dark orange-gold glass theme is real CSS, accessible and compact",()=>{
  const css=read("src/desktopWidget40.css");
  assert.ok(css.includes("--kai-accent:#ff8f37"));
  assert.ok(css.includes("linear-gradient"));
  assert.ok(css.includes(".kai-widget-expanded"));
  assert.ok(css.includes("prefers-reduced-motion"));
  assert.ok(css.includes("prefers-contrast:more"));
  assert.ok(css.includes("focus-visible"));
  assert.ok(css.includes(".kai-ask-anything"));
});

test("native expansion cannot call job execution and stays in the widget window scope",()=>{
  const rust=read("src-tauri/src/desktop_widget.rs");
  const lib=read("src-tauri/src/lib.rs");
  assert.ok(rust.includes("pub fn desktop_widget_set_expanded("));
  const segment=rust.slice(rust.indexOf("pub fn desktop_widget_set_expanded("),
    rust.indexOf("pub fn desktop_widget_drag("));
  assert.ok(segment.includes("require_window(&window, WIDGET_LABEL)"));
  assert.ok(segment.includes("window.set_size")||
    segment.includes(".set_size("));
  assert.ok(segment.includes("window.set_position")||
    segment.includes(".set_position("));
  for(const forbidden of ["remote_task_execute","mesh_local_approve_peer","shell_execute"]){
    assert.ok(!segment.includes(forbidden),forbidden);
  }
  assert.ok(lib.includes("desktop_widget::desktop_widget_set_expanded"));
  assert.ok(rust.includes("window.available_monitors()"));
  assert.match(rust,/window\s*\.current_monitor\(\)/);
});

test("widget remains opt-in preview, not automatically shipped as the release",()=>{
  const rust=read("src-tauri/src/desktop_widget.rs");
  const main=read("src/App.tsx");
  assert.ok(rust.includes('cfg!(feature = "stage35-qa")'));
  assert.ok(rust.includes('WIDGET_PREVIEW_NOT_RELEASED'));
  assert.ok(main.includes('VITE_KATOSYNC_DESKTOP_WIDGET_QA'));
  assert.ok(main.includes('desktop_widget_show'));
});
