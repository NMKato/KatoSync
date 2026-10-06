import assert from "node:assert/strict";
import test from "node:test";

import { inferWorktreeTarget, uniqueProjectTargets } from "../src/lib/projectTargets.ts";
import type { WorktreeFact } from "../src/types.ts";

function wt(path: string, branch: string | null, dirtyCount = 0): WorktreeFact {
  return { path, branch, headSha: "abc123", detached: false, locked: false, dirtyCount };
}

test("THEORG/UIA worktrees are classified as Windows targets", () => {
  assert.equal(
    inferWorktreeTarget("KAI-Desktop-Agent", wt("/work/KAI-Desktop-Agent-keys", "fix/theorg-windows-extended-keys")),
    "windows"
  );
  assert.equal(
    inferWorktreeTarget("KAI-Desktop-Agent", wt("/work/KAI-Desktop-Agent-time", "fix/theorg-time-readback")),
    "windows"
  );
});

test("explicit macOS and local AI worktrees are classified without guessing shared branches", () => {
  assert.equal(inferWorktreeTarget("KAI-Desktop-Agent", wt("/work/kai-macos", "feat/macos-menu")), "macos");
  assert.equal(inferWorktreeTarget("KAI-Desktop-Agent", wt("/work/kai-gemma", "feat/local-cortex-gemma4-e4b")), "local-ai");
  assert.equal(inferWorktreeTarget("KAI-Desktop-Agent", wt("/work/kai", "main")), "shared");
});

test("target summary is stable and deduplicated", () => {
  assert.deepEqual(
    uniqueProjectTargets("KAI-Desktop-Agent", [
      wt("/work/a", "main"),
      wt("/work/b", "fix/theorg-time"),
      wt("/work/c", "fix/theorg-focus"),
      wt("/work/d", "feat/local-cortex-gemma4")
    ]),
    ["windows", "local-ai", "shared"]
  );
});
