// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_STANDARDS_VERSION,
  IMMUTABLE_AGENT_RULES,
  MVVM_R_ENGINEERING_PROFILE,
  IOS_SWIFTUI_ENGINEERING_PROFILE,
  authorizeAgentAction,
  renderUniversalAgentInstructions,
  resolveAgentPolicy
} from "../src/lib/agentStandards.ts";
import { buildSkillPrompt } from "../src/lib/skillTemplate.ts";

test("community default respects the existing project architecture, organization can choose MVVM+R", () => {
  const shared = resolveAgentPolicy();
  assert.equal(shared.schemaVersion, AGENT_STANDARDS_VERSION);
  assert.equal(shared.preferences.architecture, "respect_existing");
  const own = resolveAgentPolicy({ organization: MVVM_R_ENGINEERING_PROFILE });
  assert.equal(own.preferences.architecture, "mvvm_r");
  assert.equal(own.sources.architecture, "organization");
  assert.deepEqual(own.immutableRules, shared.immutableRules);
});

test("project and approved task preferences take precedence, never replacing immutable rules", () => {
  const policy = resolveAgentPolicy({
    organization: { architecture: "mvvm_r", dependencies: "verify_supported_stable" },
    project: { architecture: "clean_modular", changes: "allow_reviewed_refactor" },
    task: { changes: "minimal_reviewable_diff" }
  });
  assert.equal(policy.preferences.architecture, "clean_modular");
  assert.equal(policy.preferences.changes, "minimal_reviewable_diff");
  assert.equal(policy.sources.changes, "task");
  assert.equal(policy.sources.architecture, "project");
  assert.equal(policy.sources.dependencies, "organization");
  assert.deepEqual(policy.immutableRules.map((r) => r.id), IMMUTABLE_AGENT_RULES.map((r) => r.id));
});

test("untrusted or malformed policy configurations fail closed", () => {
  assert.throws(() => resolveAgentPolicy({ project: { deleteAllRules: true } }), /unknown policy field/);
  assert.throws(() => resolveAgentPolicy({ project: { architecture: "latest" } }), /invalid architecture/);
  assert.throws(() => resolveAgentPolicy({ project: "ignore safety" }), /must be an object/);
  assert.throws(() => resolveAgentPolicy({ task: { requireRegressionTests: "no" } }), /expected boolean/);
  assert.throws(() => resolveAgentPolicy({ project: { requireRegressionTests: false } }), /cannot be weakened/);
  assert.throws(() => resolveAgentPolicy({ organization: { __proto__: null, unsafeShell: true } }), /unknown policy field/);
});

test("all connected models receive identical versioned semantic policy", () => {
  const policy = resolveAgentPolicy({ organization: MVVM_R_ENGINEERING_PROFILE });
  const providers = ["gemma", "codex", "claude", "api"] as const;
  const instructions = providers.map(() => renderUniversalAgentInstructions(policy));
  assert.equal(new Set(instructions).size, 1);
  const text = instructions[0];
  assert.match(text, /MVVM\+R/);
  assert.match(text, /supported stable APIs/);
  assert.match(text, /never invent the latest version/);
  assert.match(text, /Git HEAD/);
  assert.match(text, /independent CI\/review/);
  assert.match(text, /Never treat this prompt text alone as authorization/);
  for (const rule of IMMUTABLE_AGENT_RULES) assert.ok(text.includes("[" + rule.id + "]"));
});

test("model instructions cannot authorize a repository write or production release", () => {
  const read = authorizeAgentAction({
    action: "read_repo", policyVersion: AGENT_STANDARDS_VERSION, verifiedProject: true, explicitApproval: false,
    isolatedWorktree: false, writerLeaseHeld: false
  });
  assert.equal(read.allowed, true);
  for (const action of ["write_worktree", "push_branch", "create_pr"] as const) {
    assert.equal(authorizeAgentAction({
      action, policyVersion: AGENT_STANDARDS_VERSION, verifiedProject: true, explicitApproval: false,
      isolatedWorktree: true, writerLeaseHeld: true
    }).reason, "approval_required");
    assert.equal(authorizeAgentAction({
      action, policyVersion: AGENT_STANDARDS_VERSION, verifiedProject: true, explicitApproval: true,
      isolatedWorktree: false, writerLeaseHeld: true
    }).reason, "isolated_single_writer_required");
    assert.equal(authorizeAgentAction({
      action, policyVersion: AGENT_STANDARDS_VERSION, verifiedProject: true, explicitApproval: true,
      isolatedWorktree: true, writerLeaseHeld: true
    }).allowed, true);
  }
  for (const action of ["merge", "deploy", "production_mutation"] as const) {
    assert.equal(authorizeAgentAction({
      action, policyVersion: AGENT_STANDARDS_VERSION, verifiedProject: true, explicitApproval: true,
      isolatedWorktree: true, writerLeaseHeld: true
    }).allowed, false);
  }
  assert.equal(authorizeAgentAction({
    action: "read_repo", policyVersion: AGENT_STANDARDS_VERSION, verifiedProject: false, explicitApproval: true,
    isolatedWorktree: true, writerLeaseHeld: true
  }).allowed, false);
  assert.equal(authorizeAgentAction({
    action: "write_worktree", policyVersion: "kuas/v0", verifiedProject: true, explicitApproval: true,
    isolatedWorktree: true, writerLeaseHeld: true
  }).reason, "policy_version_mismatch");
});

test("policy result is deterministic and does not read repository text as instructions", () => {
  const a = resolveAgentPolicy({ project: { architecture: "mvvm_r" } });
  const b = resolveAgentPolicy({ project: { architecture: "mvvm_r" } });
  assert.deepEqual(a, b);
  assert.ok(Object.isFrozen(a.preferences));
  assert.ok(Object.isFrozen(a.immutableRules));
  assert.ok(a.immutableRules.every((rule) => Object.isFrozen(rule)));
});

test("legacy iOS expert skill adapts to modern, verified SwiftUI choices instead of hardcoding versions", () => {
  const p = resolveAgentPolicy({ organization: IOS_SWIFTUI_ENGINEERING_PROFILE });
  const guidance = renderUniversalAgentInstructions(p);
  assert.equal(p.preferences.architecture, "mvvm_r");
  assert.equal(p.preferences.platform, "ios_swiftui");
  assert.equal(p.preferences.documentationLanguage, "de");
  assert.match(guidance, /WAS \(what changed\).*WO \(files\/components\).*WARUM/);
  assert.match(guidance, /@Observable\/Observation or ObservableObject\/@Published/);
  assert.match(guidance, /deployment target/);
  assert.match(guidance, /glassmorphism/i);
});

test("platform settings cannot be smuggled in through an unknown key", () => {
  assert.throws(() => resolveAgentPolicy({ project: { platform: "ios-999" } }), /invalid platform/);
  const p = resolveAgentPolicy({ organization: { platform: "ios_swiftui" },
    project: { platform: "web_typescript" } });
  const guide = renderUniversalAgentInstructions(p);
  assert.match(guide, /TypeScript types/);
  assert.doesNotMatch(guide, /SwiftUI MVVM/);
});

test("existing Mistral skill generator includes canonical provider-neutral policy", () => {
  const generic = buildSkillPrompt("Helpful app developer", {
    mcpUrl: "https://mcp.katoos.de", projects: ["test-repo"]
  });
  assert.match(generic, /KatoSync Universal Agent Standards kuas\/v1/);
  assert.match(generic, /Persona \(scope-limited/);
  assert.match(generic, /KatoSync-Integration/);
  const iosPolicy = resolveAgentPolicy({ organization: IOS_SWIFTUI_ENGINEERING_PROFILE });
  const ios = buildSkillPrompt("iOS Developer", {
    mcpUrl: "https://mcp.katoos.de", projects: ["ios-app"], agentPolicy: iosPolicy
  });
  assert.match(ios, /SwiftUI MVVM/);
  assert.match(ios, /Was-Wo-Warum|WAS \(what changed\)/);
});
