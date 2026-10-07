import assert from "node:assert/strict";
import test from "node:test";

import { jobActivityPresentation, jobActivityTitle } from "../src/lib/agentJobPresentation.ts";

test("natural task text stays unchanged", () => {
  assert.equal(jobActivityTitle("Vision verbessern"), "Vision verbessern");
  assert.equal(jobActivityTitle("Task a1"), "Task a1");
  assert.equal(jobActivityTitle("Refactor"), "Refactor");
});

test("technical KatoSync slug is humanized without date, time or lane suffix", () => {
  assert.equal(jobActivityTitle("20261006-1928-katosync-vision-claude"), "KatoSync · Vision");
  assert.equal(jobActivityTitle("20261006-1928-katosync-vision-claude", "katosync"), "KatoSync · Vision");
  assert.equal(jobActivityTitle("20261006-katosync-vision-brand-livecopy-codex"), "KatoSync · Vision brand livecopy");
});

test("repeated project slug becomes a short prefix", () => {
  assert.equal(jobActivityTitle("my-app-fix-login-20261006", "my-app"), "My App · Fix login");
  assert.equal(jobActivityTitle("fix-login-1700000000"), "Fix login");
});

test("pure ID segments and IDs are not turned into titles", () => {
  assert.equal(jobActivityTitle("npm test · 20261006-1928-abc"), "npm test");
  assert.equal(jobActivityTitle("job-1234567"), "job-1234567");
  assert.equal(jobActivityTitle("20261006-1928"), "20261006-1928");
  assert.equal(jobActivityTitle(""), "");
});

test("raw canonical values stay outside the helper and in the tooltip", () => {
  const job = Object.freeze({
    id: "router:20261006-1928-katosync-vision-claude",
    externalId: "20261006-1928-katosync-vision-claude",
    task: "20261006-1928-katosync-vision-claude",
    projectId: "20261006"
  });
  const view = jobActivityPresentation(job);
  assert.equal(view.title, "KatoSync · Vision");
  assert.equal(view.humanized, true);
  assert.equal(view.tooltip, "20261006-1928-katosync-vision-claude");
  assert.equal(job.task, "20261006-1928-katosync-vision-claude");

  const natural = jobActivityPresentation({ id: "local:lc-1", externalId: null, task: "Tests prüfen", projectId: "alpha" });
  assert.equal(natural.title, "Tests prüfen");
  assert.equal(natural.humanized, false);
  assert.equal(natural.tooltip, "Tests prüfen · local:lc-1");
});

test("no secret or path expansion: output only reuses input words", () => {
  for (const task of ["~/Projects/katosync", "$HOME-secret-token", "token=abc-123", "feat/vision-brand", "C:\\work\\katosync-x"]) {
    const title = jobActivityTitle(task);
    assert.ok(!title.includes("/Users/"), title);
    assert.ok(!/\$\{|process\.env/.test(title), title);
    for (const word of title.split(/[\s·]+/).filter(Boolean)) {
      assert.ok(task.toLowerCase().includes(word.toLowerCase()), `${word} not in ${task}`);
    }
  }
  assert.equal(jobActivityTitle("~/Projects/katosync"), "~/Projects/katosync");
});
