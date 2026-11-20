// Created by NMKato Solutions
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Provider card and route use bundled OpenAI and Claude marks", () => {
  const manager = read("../src/components/ProviderManager.tsx");
  const brands = read("../src/components/ProviderBrandMark.tsx");
  assert.match(manager, /<ProviderBrandMark provider=\{provider\} size="route"/);
  assert.match(manager, /<ProviderBrandMark provider=\{provider\} size="card"/);
  assert.match(brands, /codex: "\/agent-openai.png"/);
  assert.match(brands, /claude: "\/agent-claude.png"/);
  for (const asset of ["agent-openai.png", "agent-claude.png"]) {
    assert.ok(existsSync(new URL(`../public/${asset}`, import.meta.url)));
  }
});

test("GitHub App uses a local recognizable GitHub brand mark, no remote URL", () => {
  const panel = read("../src/components/GithubAppConnectionPanel.tsx");
  const brands = read("../src/components/ProviderBrandMark.tsx");
  const svg = read("../public/github-mark-white.svg");
  const css = read("../src/styles.css");
  assert.match(panel, /<ProviderBrandMark provider="github" size="card"/);
  assert.match(brands, /github: "\/github-mark-white.svg"/);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /<path fill="#fff"/);
  assert.doesNotMatch(svg, /<script|onload=|href=/i);
  assert.match(css, /\.provider-brand-mark-github\s*\{/);
  assert.doesNotMatch(brands, /https?:\/\//);
});

test("Non-brand local and local-control providers retain fallback icons", () => {
  const brands = read("../src/components/ProviderBrandMark.tsx");
  assert.match(brands, /provider === "local_control" \? ShieldCheck : Cpu/);
  assert.match(brands, /aria-hidden="true"/);
});


test("Vision uses the exact same bundled OpenAI and Anthropic marks on the matching lanes", () => {
  const graph = read("../src/lib/visionGraph.ts");
  const vision = read("../src/components/VisionWorkspace.tsx");
  assert.match(graph, /asset: lane\.id === "codex" \? "openai" : lane\.id === "claude" \? "anthropic" : null/);
  assert.match(vision, /openai: "\/agent-openai\.png"/);
  assert.match(vision, /anthropic: "\/agent-claude\.png"/);
  assert.doesNotMatch(vision, /https?:\/\/[^\s]+agent-(?:openai|claude)/);
});

test("Navigation and cockpit keep authentication and approval in their existing handlers", () => {
  const app = read("../src/App.tsx");
  const providers = read("../src/components/ProviderManager.tsx");
  const cockpit = read("../src/components/ConnectionCockpit.tsx");
  const polish = read("../src/uxCockpit40.css");
  assert.match(app, /className="ks40-nav-group-toggle"/);
  assert.match(app, /moreNavOpen/);
  assert.match(app, /className="ks40-settings-panel"/);
  assert.match(app, /openDevicesRequested=\{deviceFocusRequested\}/);
  assert.match(providers, /<ConnectionCockpit/);
  assert.match(providers, /hidden=\{visibleDetail !== "devices"\}/);
  assert.match(providers, /hidden=\{visibleDetail !== "mcp"\}/);
  assert.match(providers, /hidden=\{visibleDetail !== "github"\}/);
  assert.match(providers, /className="provider-cards"/);
  assert.match(providers, /variant="provider" hidden=\{visibleDetail !== "github"\}/);
  assert.match(providers, /cardProviders\.map/);
  assert.match(cockpit, /selectedTile/);
  assert.match(cockpit, /scrollIntoView/);
  assert.match(cockpit, /onClick=\{\(\) => \{ setLocalSelected\(key\); onSelect\?\.\(key\); \}\}/);
  assert.match(cockpit, /handleConnectProvider/);
  assert.match(polish, /prefers-reduced-motion: reduce/);
  assert.match(polish, /ks40-active-detail\[hidden\]/);
});
