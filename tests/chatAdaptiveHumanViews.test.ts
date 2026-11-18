// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseHumanView} from "../src/lib/chatAdaptiveViews.ts";
import {presentChatAnswer} from "../src/lib/chatAnswerPresentation.ts";

test("dense previous Gemma reply becomes short headings, separate list items, normal text",()=>{
 const raw="### Kurzantwort KatoSync fasst den Projektstand zusammen. ### Das ist wichtig - Verifizierte Quelle vorhanden [4]. - Der Test benötigt eine Freigabe. ### Nächste Schritte - Sprachaufnahme prüfen. - Eine Frage stellen.";
 const result=presentChatAnswer(raw,[4]);
 assert.match(result,/### Kurzantwort\n\nKatoSync/);
 assert.match(result,/### Das ist wichtig\n\n- Verifizierte Quelle/);
 assert.match(result,/\n- Der Test benötigt/);
 assert.match(result,/### Nächste Schritte\n\n- Sprachaufnahme/);
 assert.doesNotMatch(result,/^### Kurzantwort KatoSync/);
});
test("comparison table accepted only with bounded rectangular primitive data",()=>{
 const sample=JSON.stringify({summary:"Die Komponenten unterscheiden sich.",view:{
  kind:"table",title:"Verbindungen",columns:["Anbieter","Zustand"],
  rows:[["Lokal","Bereit"],["Cloud","Nicht geprüft"]]}});
 const result=parseHumanView(sample,[]);
 assert.ok(result && result.kind==="table");
 if(result?.kind==="table") {
   assert.equal(result.rows.length,2);assert.equal(result.rows[0][0],"Lokal");
 }
 assert.equal(parseHumanView(JSON.stringify({view:{
  type:"table",columns:["Name","Zustand"],rows:[["Ein Wert"]]
 }}),[]),null);
 assert.equal(parseHumanView(JSON.stringify({view:{
  type:"table",columns:["Name","Zustand"],rows:[[{}, "ok"]]
 }}),[]),null);
});
test("bar chart only with independently verified citations and real finite numbers",()=>{
 const sample=JSON.stringify({summary:"Belegter Vergleich",presentation:{
  kind:"bars",title:"Messwerte",unit:"ms",sources:[2],
  points:[{label:"A",value:12},{label:"B",value:18}]}});
 assert.equal(parseHumanView(sample,[]),null);
 assert.equal(parseHumanView(sample,[1]),null);
 const result=parseHumanView(sample,[2]);
 assert.ok(result && result.kind==="bars");
 if(result?.kind==="bars")assert.equal(result.points[1].value,18);
 const forged=JSON.stringify({view:{kind:"bars",sources:[2],points:[
  {label:"A",value:100},{label:"B",value:Infinity}]}});
 assert.equal(parseHumanView(forged,[2]),null);
 const missing=JSON.stringify({view:{kind:"bars",sources:[2],points:[
  {label:"A",value:0},{label:"B",value:0}]}});
 assert.equal(parseHumanView(missing,[2]),null);
});
test("cannot convert unverified prose percentages into authoritative chart",()=>{
 assert.equal(parseHumanView("KatoSync ist angeblich 80 Prozent fertig.",[1]),null);
});
test("no backend tool calls or external HTML/SVG for adaptive views",()=>{
 const parser=readFileSync(new URL("../src/lib/chatAdaptiveViews.ts",import.meta.url),"utf8");
 const chat=readFileSync(new URL("../src/components/ContinuityLocalChatPanel.tsx",import.meta.url),"utf8");
 const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
 assert.doesNotMatch(parser,/fetch\(|eval\(|dangerouslySetInnerHTML/);
 assert.match(chat,/parseHumanView\(answer,sourceIndices\)/);
 assert.match(chat,/view\?\.kind==="table"/);
 assert.match(chat,/view\?\.kind==="bars"/);
 assert.match(css,/\.continuity-adaptive-view/);
 assert.match(css,/font-weight:400!important/);
});
