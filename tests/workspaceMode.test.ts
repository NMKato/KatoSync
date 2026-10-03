// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_SYNC_STEPS,
  MISTRAL_STEPS,
  WORKSPACE_MODE_KEY,
  defaultStepForMode,
  modeForStep,
  parseWorkspaceMode,
  readRememberedMode,
  rememberMode,
  stepForMode
} from "../src/lib/workspaceMode.ts";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data
  };
}

test("only known workspace modes are accepted", () => {
  assert.equal(parseWorkspaceMode("mistral"), "mistral");
  assert.equal(parseWorkspaceMode("agentSync"), "agentSync");
  assert.equal(parseWorkspaceMode("AgentSync"), null);
  assert.equal(parseWorkspaceMode(""), null);
  assert.equal(parseWorkspaceMode(null), null);
});

test("last mode is remembered locally and survives invalid or failing storage", () => {
  const storage = memoryStorage();
  assert.equal(readRememberedMode(storage), null);
  rememberMode(storage, "agentSync");
  assert.equal(storage.data.get(WORKSPACE_MODE_KEY), "agentSync");
  assert.equal(readRememberedMode(storage), "agentSync");
  assert.equal(readRememberedMode(memoryStorage({ [WORKSPACE_MODE_KEY]: "something-else" })), null);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    }
  };
  assert.equal(readRememberedMode(broken), null);
  assert.doesNotThrow(() => rememberMode(broken, "mistral"));
});

test("navigation trees are disjoint and Agent Sync is not a Mistral menu item", () => {
  assert.equal(MISTRAL_STEPS.filter((step) => AGENT_SYNC_STEPS.includes(step)).length, 0);
  assert.ok(MISTRAL_STEPS.every((step) => modeForStep(step) === "mistral"));
  assert.ok(AGENT_SYNC_STEPS.every((step) => modeForStep(step) === "agentSync"));
  assert.equal(defaultStepForMode("mistral"), "dashboard");
  assert.equal(defaultStepForMode("agentSync"), "agentDashboard");
});

test("foreign or hidden setup steps fall back to the active workspace home", () => {
  assert.equal(modeForStep("api"), "mistral");
  assert.equal(modeForStep("schedule"), "mistral");
  assert.equal(stepForMode("api", "agentSync"), "agentDashboard");
  assert.equal(stepForMode("projectBoard", "agentSync"), "agentDashboard");
  assert.equal(stepForMode("agentMonitor", "mistral"), "dashboard");
  assert.equal(stepForMode("agentJobs", "agentSync"), "agentJobs");
  assert.equal(stepForMode("briefings", "mistral"), "briefings");
});
