// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  balancedOption,
  cheapestKnownOption,
  estimateProject,
  fastestOption
} from "../src/lib/apiCostPlanner.ts";
import type { ActionTask, ApiProviderConfig } from "../src/types.ts";

const task: ActionTask = {
  taskId: "task-1",
  priority: 1,
  projectId: "project-1",
  title: "Implement and review a provider routing feature",
  taskType: "code_task",
  targetRunner: "codex_cli",
  riskLevel: "medium",
  requiresApproval: false,
  status: "queued"
};

const apis: ApiProviderConfig[] = [
  {
    id: "api-openai",
    label: "OpenAI",
    preset: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-sol",
    effort: "high",
    mode: "auto",
    capabilities: [],
    enabled: true
  },
  {
    id: "api-mistral",
    label: "Mistral",
    preset: "mistral",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    effort: "medium",
    mode: "auto",
    capabilities: [],
    enabled: true
  }
];

test("project cost planner exposes project and task-level recommendations", () => {
  const estimate = estimateProject("project-1", [task], apis);
  assert.equal(estimate.tasks.length, 1);
  assert.equal(estimate.taskPlans.length, 1);
  assert.equal(estimate.options.length, 2);
  assert.ok(estimate.options.every((option) => option.estimatedCostUsd !== null));
  assert.ok(estimate.taskPlans[0].balanced);
  assert.ok(estimate.taskPlans[0].cheapest);
  assert.ok(estimate.taskPlans[0].bestFit);
});

test("cost, speed and balanced selectors remain independent", () => {
  const estimate = estimateProject("project-1", [task], apis);
  assert.equal(cheapestKnownOption(estimate)?.connectionId, "api-mistral");
  assert.equal(fastestOption(estimate)?.connectionId, "api-mistral");
  assert.ok(balancedOption(estimate));
});

test("disabled API slots never enter a project forecast", () => {
  const estimate = estimateProject("project-1", [task], [
    ...apis,
    { ...apis[0], id: "disabled", enabled: false }
  ]);
  assert.equal(estimate.options.some((option) => option.connectionId === "disabled"), false);
});
