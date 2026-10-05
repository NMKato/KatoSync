// Created by NMKato Solutions
// Providerneutrale Projekt-Kostenplanung. Schaetzungen dienen der Routing-Entscheidung;
// reale Usage gewinnt immer gegen die Planprognose.
import type {
  ActionTask,
  ApiCapability,
  ApiEffort,
  ApiModelProfile,
  ApiProviderConfig
} from "../types";
import { apiModelProfile } from "./apiModelCatalog.ts";

export type ApiOptimizationMode = "balanced" | "lowest_cost" | "fastest" | "best_quality";

export interface ApiTaskEstimate {
  taskId: string;
  title: string;
  required: ApiCapability[];
  inputTokens: number;
  outputTokens: number;
}

export interface ApiPlanOption {
  connectionId: string;
  providerLabel: string;
  model: string;
  effort: ApiEffort;
  fit: number;
  speed: ApiModelProfile["speed"];
  estimatedCostUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  pricingKnown: boolean;
  supported: boolean;
  qualityScore: number;
  valueScore: number;
}

export interface ApiTaskPlan {
  task: ApiTaskEstimate;
  options: ApiPlanOption[];
  cheapest: ApiPlanOption | null;
  fastest: ApiPlanOption | null;
  bestFit: ApiPlanOption | null;
  balanced: ApiPlanOption | null;
}

export interface ApiProjectEstimate {
  projectId: string;
  tasks: ApiTaskEstimate[];
  options: ApiPlanOption[];
  taskPlans: ApiTaskPlan[];
}

const TASK_BASE: Record<ActionTask["taskType"], { input: number; output: number; caps: ApiCapability[] }> = {
  code_task: { input: 18_000, output: 7_000, caps: ["coding", "reasoning", "tools"] },
  desktop_task: { input: 10_000, output: 3_500, caps: ["reasoning", "tools"] },
  research_task: { input: 24_000, output: 8_000, caps: ["reasoning", "tools", "long_context"] },
  document_task: { input: 14_000, output: 6_000, caps: ["reasoning"] },
  email_task: { input: 6_000, output: 2_000, caps: ["reasoning"] },
  form_task: { input: 8_000, output: 2_500, caps: ["reasoning", "tools"] },
  visual_task: { input: 10_000, output: 3_000, caps: ["vision", "reasoning"] },
  project_management_task: { input: 14_000, output: 5_000, caps: ["reasoning", "long_context"] },
  katoos_task: { input: 18_000, output: 6_000, caps: ["reasoning", "tools"] }
};

const RISK = { low: 1, medium: 1.2, high: 1.5, critical: 1.8 } as const;
const EFFORT = { auto: 1, low: 0.82, medium: 1, high: 1.28, xhigh: 1.5, max: 1.72 } as const;
const SPEED_SCORE: Record<ApiModelProfile["speed"], number> = {
  fast: 100,
  balanced: 76,
  deep: 52,
  unknown: 60
};

export function estimateTaskDemand(task: ActionTask): ApiTaskEstimate {
  const base = TASK_BASE[task.taskType];
  const titleFactor = Math.min(1.35, 1 + task.title.length / 500);
  const multiplier = RISK[task.riskLevel] * titleFactor;
  return {
    taskId: task.taskId,
    title: task.title,
    required: [...base.caps],
    inputTokens: Math.round(base.input * multiplier),
    outputTokens: Math.round(base.output * multiplier)
  };
}

function cost(profile: ApiModelProfile, input: number, output: number): number | null {
  const pricing = profile.pricing;
  if (!pricing || pricing.inputPerMillion === null || pricing.outputPerMillion === null) return null;
  return input / 1_000_000 * pricing.inputPerMillion + output / 1_000_000 * pricing.outputPerMillion;
}

function fitScore(profile: ApiModelProfile, required: Set<ApiCapability>): number {
  if (!required.size) return 100;
  const caps = new Set(profile.capabilities);
  const matched = [...required].filter((cap) => caps.has(cap)).length;
  return Math.round(matched / required.size * 100);
}

function qualityScore(profile: ApiModelProfile, fit: number, effort: ApiEffort): number {
  const effortBonus = { auto: 4, low: 0, medium: 4, high: 8, xhigh: 11, max: 14 }[effort];
  const depthBonus = profile.speed === "deep" ? 8 : profile.speed === "balanced" ? 4 : 0;
  return Math.min(100, Math.round(fit * 0.82 + effortBonus + depthBonus));
}

function valueScore(option: Pick<ApiPlanOption, "qualityScore" | "fit" | "speed" | "estimatedCostUsd">): number {
  const speed = SPEED_SCORE[option.speed];
  const costPenalty = option.estimatedCostUsd == null
    ? 12
    : Math.min(35, Math.log10(1 + option.estimatedCostUsd * 100) * 12);
  return Math.max(0, Math.round(option.qualityScore * 0.55 + option.fit * 0.25 + speed * 0.2 - costPenalty));
}

function buildOption(
  connection: ApiProviderConfig,
  required: Set<ApiCapability>,
  baseInput: number,
  baseOutput: number
): ApiPlanOption {
  const profile = apiModelProfile(connection.preset, connection.model);
  const factor = EFFORT[connection.effort];
  const inputTokens = Math.round(baseInput * factor);
  const outputTokens = Math.round(baseOutput * factor);
  const fit = fitScore(profile, required);
  const estimatedCostUsd = cost(profile, inputTokens, outputTokens);
  const quality = qualityScore(profile, fit, connection.effort);
  const option: ApiPlanOption = {
    connectionId: connection.id,
    providerLabel: connection.label || connection.preset,
    model: connection.model,
    effort: connection.effort,
    fit,
    speed: profile.speed,
    estimatedCostUsd,
    inputTokens,
    outputTokens,
    pricingKnown: Boolean(profile.pricing),
    supported: fit >= 60,
    qualityScore: quality,
    valueScore: 0
  };
  option.valueScore = valueScore(option);
  return option;
}

function sortOptions(options: ApiPlanOption[]): ApiPlanOption[] {
  return [...options].sort((a, b) => {
    if (a.supported !== b.supported) return a.supported ? -1 : 1;
    if (a.fit !== b.fit) return b.fit - a.fit;
    if (a.estimatedCostUsd === null && b.estimatedCostUsd !== null) return 1;
    if (a.estimatedCostUsd !== null && b.estimatedCostUsd === null) return -1;
    return (a.estimatedCostUsd ?? 0) - (b.estimatedCostUsd ?? 0);
  });
}

function cheapest(options: ApiPlanOption[]): ApiPlanOption | null {
  return [...options]
    .filter((option) => option.supported && option.estimatedCostUsd !== null)
    .sort((a, b) => (a.estimatedCostUsd ?? Infinity) - (b.estimatedCostUsd ?? Infinity))[0] ?? null;
}

function fastest(options: ApiPlanOption[]): ApiPlanOption | null {
  return [...options]
    .filter((option) => option.supported)
    .sort((a, b) => SPEED_SCORE[b.speed] - SPEED_SCORE[a.speed] || b.fit - a.fit)[0] ?? null;
}

function bestFit(options: ApiPlanOption[]): ApiPlanOption | null {
  return [...options]
    .filter((option) => option.supported)
    .sort((a, b) => b.qualityScore - a.qualityScore || b.fit - a.fit || (a.estimatedCostUsd ?? Infinity) - (b.estimatedCostUsd ?? Infinity))[0] ?? null;
}

function balanced(options: ApiPlanOption[]): ApiPlanOption | null {
  return [...options]
    .filter((option) => option.supported)
    .sort((a, b) => b.valueScore - a.valueScore || (a.estimatedCostUsd ?? Infinity) - (b.estimatedCostUsd ?? Infinity))[0] ?? null;
}

export function estimateProject(
  projectId: string,
  tasks: ActionTask[],
  connections: ApiProviderConfig[]
): ApiProjectEstimate {
  const active = connections.filter((connection) => connection.enabled && connection.model.trim());
  const taskEstimates = tasks.map(estimateTaskDemand);
  const required = new Set(taskEstimates.flatMap((task) => task.required));
  const baseInput = taskEstimates.reduce((sum, task) => sum + task.inputTokens, 0);
  const baseOutput = taskEstimates.reduce((sum, task) => sum + task.outputTokens, 0);
  const options = sortOptions(active.map((connection) => buildOption(connection, required, baseInput, baseOutput)));

  const taskPlans = taskEstimates.map((task): ApiTaskPlan => {
    const taskRequired = new Set(task.required);
    const taskOptions = sortOptions(active.map((connection) =>
      buildOption(connection, taskRequired, task.inputTokens, task.outputTokens)
    ));
    return {
      task,
      options: taskOptions,
      cheapest: cheapest(taskOptions),
      fastest: fastest(taskOptions),
      bestFit: bestFit(taskOptions),
      balanced: balanced(taskOptions)
    };
  });

  return { projectId, tasks: taskEstimates, options, taskPlans };
}

export function cheapestKnownOption(estimate: ApiProjectEstimate): ApiPlanOption | null {
  return cheapest(estimate.options);
}

export function fastestOption(estimate: ApiProjectEstimate): ApiPlanOption | null {
  return fastest(estimate.options);
}

export function bestFitOption(estimate: ApiProjectEstimate): ApiPlanOption | null {
  return bestFit(estimate.options);
}

export function balancedOption(estimate: ApiProjectEstimate): ApiPlanOption | null {
  return balanced(estimate.options);
}

export function optionForMode(
  estimate: ApiProjectEstimate,
  mode: ApiOptimizationMode
): ApiPlanOption | null {
  if (mode === "lowest_cost") return cheapestKnownOption(estimate);
  if (mode === "fastest") return fastestOption(estimate);
  if (mode === "best_quality") return bestFitOption(estimate);
  return balancedOption(estimate);
}
