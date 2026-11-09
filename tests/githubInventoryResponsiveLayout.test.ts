// Created by NMKato Solutions
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/components/GithubAppReadOnlyInventory.tsx", import.meta.url), "utf8");
const provider = readFileSync(new URL("../src/components/ProviderManager.tsx", import.meta.url), "utf8");

test("GitHub provider expands only when inventory is actually loaded", () => {
  assert.match(css, /\.provider-cards > \.github-provider-card:has\(\.github-app-inventory-result\)\s*\{\s*grid-column:1\s*\/\s*-1;/);
  assert.match(provider, /className="provider-cards"/);
  assert.match(ui, /inventory\?<div className="github-app-inventory-result">/);
  assert.match(css, /\.provider-cards > \.github-provider-card\s*\{\s*width:100%/);
});
test("Repository card uses internal grid, never wrapped flex rows that push issue buttons sideways", () => {
  assert.match(css, /\.github-app-inventory-list \.github-app-repo-card\s*\{[\s\S]*?display:grid;/);
  assert.match(css, /\.github-app-inventory-list \.github-app-repo-card\s*\{[\s\S]*?grid-template-columns:minmax\(0,1fr\);/);
  assert.match(css, /\.github-app-inventory-list \.github-app-repo-card > button\s*\{[\s\S]*?max-width:100%;/);
  assert.match(css, /\.github-app-inventory-list\s*\{[\s\S]*?overflow-x:hidden;/);
});
test("Repository list sizes to available width and preserves native owner and issue controls", () => {
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(min\(100%,220px\),1fr\)\);/);
  assert.match(ui, /githubRepoTitle\(repo.fullName\)/);
  assert.match(ui, /githubRepoOwner\(repo.fullName\)/);
  assert.match(ui, /onClick=\{\(\)=>void showIssues\(repo\)\}/);
  assert.match(ui, /disabled title=\{t\("github.inventory.noAutostart"\)\}/);
});
