// Regression: consent text must not collapse into a one-word-wide column.
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
test("Memory Fabric recovery keeps a full-width label and fixed checkbox",()=>{
 assert.match(css,/\.continuity-chat-recovery \{[^}]*grid-template-columns:minmax\(0,1fr\)/s);
 assert.match(css,/\.continuity-repair-consent \{[^}]*width:min\(100%,690px\)/s);
 assert.match(css,/\.continuity-repair-consent input\[type="checkbox"\] \{[^}]*flex:0 0 18px;[^}]*width:18px;/s);
 assert.match(css,/\.continuity-repair-consent > span \{[^}]*flex:1 1 auto;[^}]*min-width:0;/s);
});
