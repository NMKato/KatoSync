// Created by NMKato Solutions
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {presentChatAnswer,repairInlineMarkdownTables} from "../src/lib/chatAnswerPresentation.ts";

test("restores the regression class: single-line title and inline GFM comparison table",()=>{
 const raw="### Vergleich der Runner-Modelle KatoSync kann verschiedene Runner nutzen. "+
   "Hier ist ein Vergleich: | Merkmal | System A | System B |:---|:---|:---| "+
   "| Funktion | Lokale Ausführung | Lokale Ausführung | "+
   "| Verfügbarkeit | Im Dokument genannt [2] | Im Dokument genannt [2] | "+
   "Daraus folgt keine verifizierte Aussage zu anderen Funktionen.";
 const output=presentChatAnswer(raw,[2]);
 assert.match(output,/^### Vergleich der Runner-Modelle\n\nKatoSync/);
 assert.match(output,/\n\n\| Merkmal \| System A \| System B \|\n\| --- \| --- \| --- \|/);
 assert.match(output,/\| Funktion \| Lokale Ausführung \| Lokale Ausführung \|/);
 assert.match(output,/\| Verfügbarkeit \| Im Dokument genannt \[2\] \| Im Dokument genannt \[2\] \|/);
 assert.match(output,/\n\nDaraus folgt keine verifizierte Aussage/);
 assert.doesNotMatch(output,/^### Vergleich der Runner-Modelle KatoSync/);
});
test("repairs inline table with separated, not invented values",()=>{
 const raw="Vergleich: | Feld | Eins | Zwei | :--- | :--- | :--- | Status | Ja | Ungeprüft | "+
 "Rolle | Prüfer | Nicht belegt | Schluss.";
 const result=repairInlineMarkdownTables(raw);
 assert.match(result,/\| Status \| Ja \| Ungeprüft \|/);
 assert.match(result,/\| Rolle \| Prüfer \| Nicht belegt \|/);
 assert.match(result,/\n\nSchluss\./);
 assert.equal((result.match(/\| Status/g)||[]).length,1);
});
test("does not guess missing cells, convert invalid tables or alter fenced code",()=>{
 const malformed="Vergleich: | Merkmal | Eins | Zwei | --- | --- | --- | Status | Nur ein Wert | Schluss.";
 assert.equal(repairInlineMarkdownTables(malformed),malformed);
 const codeFence=String.fromCharCode(96).repeat(3);
 const fenced=codeFence+"markdown\n| Name | A | B |:---|:---|:---| | ok | 1 | 2 |\n"+codeFence;
 assert.equal(repairInlineMarkdownTables(fenced),fenced);
 const valid="| Name | A | B |\n| --- | --- | --- |\n| Status | Ja | Nein |";
 assert.equal(repairInlineMarkdownTables(valid),valid);
});
test("unverified numeric citation is dropped without removing actual table content",()=>{
 const raw="Vergleich: | Merkmal | A | B |:---|:---|:---| | Beleg | geprüft [1] | unbekannt [9] |";
 const result=presentChatAnswer(raw,[1]);
 assert.match(result,/geprüft \[1\]/);
 assert.doesNotMatch(result,/\[9\]/);
 assert.match(result,/\| Beleg \|/);
});
test("rust asks for real Markdown rows and missing data called not verified",()=>{
 const rust=readFileSync(new URL("../src-tauri/src/local_brain.rs",import.meta.url),"utf8");
 assert.match(rust,/lower_question\.contains\("tabelle"\)/);
 assert.match(rust,/jede Tabellenzeile auf eine eigene Zeile/);
 assert.match(rust,/Nicht belegt/);
});
