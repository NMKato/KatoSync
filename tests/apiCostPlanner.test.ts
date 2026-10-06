// Created by NMKato Solutions
import assert from "node:assert/strict";
import test from "node:test";
import {
  apiBudgetBlocks,
  apiBudgetState,
  balancedOption,
  bestFitOption,
  cheapestKnownOption,
  estimateProject,
  fastestOption
} from "../src/lib/apiCostPlanner.ts";
import {
  apiEffortOptions,
  apiModelChoices,
  defaultApiModel,
  effectiveApiEffort,
  formatApiPrice,
  apiModelProfile
} from "../src/lib/apiModelCatalog.ts";
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
    enabled: true,
    monthlyBudgetUsd: null
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
    enabled: true,
    monthlyBudgetUsd: null
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

test("every planner value is labelled as an estimate", () => {
  const estimate = estimateProject("project-1", [task], apis);
  assert.ok(estimate.options.every((option) => option.costBasis === "estimate"));
  assert.ok(estimate.taskPlans.every((plan) => plan.options.every((option) => option.costBasis === "estimate")));
});

test("unknown pricing stays unknown instead of becoming zero", () => {
  const unpriced: ApiProviderConfig = { ...apis[0], id: "api-unpriced", preset: "openrouter_eu", model: "vendor/unlisted-model" };
  const estimate = estimateProject("project-1", [task], [unpriced]);
  assert.equal(estimate.options[0].estimatedCostUsd, null);
  assert.equal(estimate.options[0].pricingKnown, false);
  assert.equal(cheapestKnownOption(estimate), null);
  assert.equal(formatApiPrice(apiModelProfile("openrouter_eu", "vendor/unlisted-model")), null);
});

test("budget states: none, ok, warning, would_exceed, exceeded", () => {
  assert.equal(apiBudgetState(null, 50).status, "none");
  assert.equal(apiBudgetState(0, 50).status, "none");
  assert.equal(apiBudgetState(100, 10, 5).status, "ok");
  assert.equal(apiBudgetState(100, 79, 2).status, "warning");
  assert.equal(apiBudgetState(100, 95, 10).status, "would_exceed");
  assert.equal(apiBudgetState(100, 100).status, "exceeded");
  assert.equal(apiBudgetBlocks(apiBudgetState(100, 100)), true);
  assert.equal(apiBudgetBlocks(apiBudgetState(100, 79, 2)), false);
  // Negative/NaN-Ausgaben werden nicht als Guthaben gewertet.
  assert.equal(apiBudgetState(10, Number.NaN).spentUsd, 0);
});

test("over-budget connections stay visible but never win an auto recommendation", () => {
  const budgeted = apis.map((api) => api.id === "api-mistral" ? { ...api, monthlyBudgetUsd: 5 } : api);
  const estimate = estimateProject("project-1", [task], budgeted, { "api-mistral": 5 });
  const mistral = estimate.options.find((option) => option.connectionId === "api-mistral");
  assert.equal(mistral?.blocked, "over_budget");
  assert.equal(mistral?.budget.status, "exceeded");
  assert.equal(cheapestKnownOption(estimate)?.connectionId, "api-openai");
  assert.equal(fastestOption(estimate)?.connectionId, "api-openai");
  assert.equal(balancedOption(estimate)?.connectionId, "api-openai");
  assert.equal(bestFitOption(estimate)?.connectionId, "api-openai");
  // Gesperrte Optionen sortieren ans Ende.
  assert.equal(estimate.options.at(-1)?.connectionId, "api-mistral");
});

test("effort only applies where the provider wiring supports it", () => {
  assert.deepEqual(apiEffortOptions("anthropic", "claude-opus-5-5"), ["auto"]);
  assert.deepEqual(apiEffortOptions("deepseek", "deepseek-v4-pro"), ["auto"]);
  assert.deepEqual(apiEffortOptions("custom_openai", "anything"), ["auto"]);
  assert.ok(apiEffortOptions("openai", "gpt-5.6-sol").includes("xhigh"));
  assert.deepEqual(apiEffortOptions("openai", ""), ["auto"]);
  // Planner rechnet mit dem real gesendeten Effort.
  const anthropic: ApiProviderConfig = { ...apis[0], id: "api-anthropic", preset: "anthropic", model: "claude-opus-5-5", effort: "max" };
  assert.equal(effectiveApiEffort(anthropic), "auto");
  assert.equal(estimateProject("project-1", [task], [anthropic]).options[0].effort, "auto");
});

test("model choices annotate the live list without inventing model ids", () => {
  assert.deepEqual(apiModelChoices("openai", null), { recommended: [], other: [], source: "unavailable" });
  const choices = apiModelChoices("openai", ["gpt-5.6-luna", "text-embedding-x", "gpt-5.6-sol", "gpt-5.6-sol"]);
  assert.equal(choices.source, "live");
  assert.deepEqual(choices.recommended.map((entry) => entry.id).sort(), ["gpt-5.6-luna", "gpt-5.6-sol"]);
  assert.deepEqual(choices.other, ["text-embedding-x"]);
  assert.equal(defaultApiModel("openai", ["text-embedding-x", "gpt-5.6-sol"]), "gpt-5.6-sol");
  assert.equal(defaultApiModel("custom_openai", ["my-model"]), "my-model");
  assert.equal(defaultApiModel("openai", []), "");
});
