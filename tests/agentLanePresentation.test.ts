import assert from "node:assert/strict";
import test from "node:test";

import {
  agentLaneBrand,
  agentLaneDisplayModel,
  agentLaneDisplayStatus,
  splitAgentLaneTitle,
} from "../src/lib/agentLanePresentation.ts";
import type { AgentLane } from "../src/types";

function lane(patch: Partial<AgentLane> = {}): AgentLane {
  return {
    id: "remote_orchestrator",
    kind: "orchestrator",
    intelligent: true,
    rank: 3,
    connectivity: "connected",
    activity: "idle",
    eligible: true,
    model: null,
    ...patch,
  };
}

test("attached remote orchestrator reads connected, not limited", () => {
  assert.equal(agentLaneDisplayStatus(lane()), "connected");
});

test("stale remote orchestrator explains stale connection", () => {
  assert.equal(
    agentLaneDisplayStatus(lane({ connectivity: "limited", activity: "waiting", reason: "stale" })),
    "connection_stale",
  );
});

test("provider quota and auth states expose the cause", () => {
  assert.equal(
    agentLaneDisplayStatus(
      lane({ id: "codex", kind: "model_provider", connectivity: "limited", reason: "quota_limited" }),
    ),
    "quota_limited",
  );
  assert.equal(
    agentLaneDisplayStatus(
      lane({ id: "claude", kind: "model_provider", connectivity: "disconnected", reason: "sign_in_required" }),
    ),
    "sign_in_required",
  );
});

test("Local Brain is branded Kai without exposing technical alias in visible model text", () => {
  const local = lane({
    id: "local",
    kind: "model_provider",
    rank: 2,
    model: "kato-local-brain",
  });
  assert.equal(agentLaneBrand(local), "kai");
  assert.equal(agentLaneDisplayModel(local), "Kai");
  assert.equal(agentLaneDisplayStatus(local), "ready");
});

test("remote brand follows the active model family", () => {
  assert.equal(agentLaneBrand(lane({ model: "gpt-5.6-sol" })), "openai");
  assert.equal(agentLaneBrand(lane({ model: "claude-opus-4" })), "claude");
  assert.equal(agentLaneBrand(lane({ model: "gemma-4-e4b" })), "kai");
  assert.equal(agentLaneBrand(lane({ model: null })), "remote");
});

test("long lane titles split instead of widening or ellipsizing cards", () => {
  assert.deepEqual(splitAgentLaneTitle("Remote Orchestrator + RDC"), {
    primary: "Remote",
    secondary: "Orchestrator",
  });
  assert.deepEqual(splitAgentLaneTitle("Local Brain"), {
    primary: "Local Brain",
    secondary: null,
  });
});
