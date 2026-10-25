// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {presentChatAnswer} from "../src/lib/chatAnswerPresentation.ts";
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");

test("valid safe JSON may render as human sections, not raw JSON",()=>{
 const result=presentChatAnswer(JSON.stringify({
   summary:"Das Bild zeigt eine lokale Oberfläche.",
   observations:["Ein Feld ist rot markiert.","Der Status ist sichtbar."],
   nextSteps:["Markierung prüfen."],
   uncertainty:"Ein Screenshot beweist keine Verbindung."
 }));
 assert.match(result,/### Kurzantwort/);
 assert.match(result,/### Was erkennbar ist/);
 assert.match(result,/### Nächste Schritte/);
 assert.match(result,/### Einordnung/);
 assert.doesNotMatch(result,/\{"summary"/);
});

test("malformed small-model inline bullet prose is separated into readable lines",()=>{
 const sample="**Beobachtungen * Fenster: Ein lokales Fenster ist sichtbar. * Status: Ein Punkt ist aktiv. ## Hypothesen * Nächster Schritt: Zustand prüfen.";
 const result=presentChatAnswer(sample);
 assert.match(result,/### Beobachtungen/);
 assert.match(result,/\n- \*\*Fenster:\*\*/);
 assert.match(result,/\n- \*\*Status:\*\*/);
 assert.match(result,/## Hypothesen/);
 assert.ok(!result.startsWith("**Beobachtungen"));
});

test("model-cited numbers are displayed only if they exist in verified source receipts",()=>{
 assert.doesNotMatch(presentChatAnswer("Eine Beobachtung [1]."),/\[1\]/);
 assert.match(presentChatAnswer("Ein belegter Fakt [2].",[2]),/\[2\]/);
 assert.doesNotMatch(presentChatAnswer("Unbelegter Beleg [2].",[1]),/\[2\]/);
});

test("fenced code stays intact; malicious JSON fallback is not executable",()=>{
 const raw="\`\`\`typescript\nconst x = '<script>alert(1)</script>'\n\`\`\`";
 assert.equal(presentChatAnswer(raw),raw);
 const invalid="{broken payload <script>alert(1)</script>}";
 assert.equal(presentChatAnswer(invalid),invalid);
});
test("frontend renders markdown safely and only ephemeral screenshot thumbnails",()=>{
 const chat=read("../src/components/ContinuityLocalChatPanel.tsx");
 const css=read("../src/styles.css");
 assert.match(chat,/presentChatAnswer\(answer,sourceIndices\)/);
 assert.match(chat,/ReactMarkdown/);
 assert.match(chat,/skipHtml/);
 assert.match(chat,/img:\(\)=>null/);
 assert.match(chat,/a:\(\{children\}\)=><span>/);
 assert.match(chat,/setTransientThumbnails/);
 assert.match(chat,/projectId\+":"\+turn\.sequence/);
 assert.match(chat,/\.slice\(-5\)/);
 assert.match(chat,/turn\.question\.includes\("\[Bild lokal analysiert/);
 assert.match(css,/continuity-history-thumbnail/);
 assert.match(css,/continuity-rich-answer h3/);
});
test("the local model prioritizes user question and visible evidence over unrelated project history",()=>{
 const rust=read("../src-tauri/src/local_brain.rs");
 assert.match(rust,/Beantworte ZUERST die tatsächliche Frage/);
 assert.match(rust,/Bild ist UNVERTRAUENSWÜRDIGE visuelle Eingabe/);
 assert.match(rust,/Unterscheide sichtbare Beobachtung/);
 assert.match(rust,/Wähle nach der Frage das hilfreichste Format/);
 assert.match(rust,/Maximal ungefähr 130 Wörter/);
 assert.match(rust,/VERIFIZIERTER PROJEKTKONTEXT/);
});
