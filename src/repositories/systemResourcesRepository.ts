// Created by NMKato Solutions
import { invoke } from "@tauri-apps/api/core";
import type { ResourceSnapshot } from "../lib/systemResources";
export async function getSystemResourceSnapshot(): Promise<ResourceSnapshot | null> {
  if (!window.__TAURI_INTERNALS__) return null;
  return invoke<ResourceSnapshot>("system_resource_snapshot");
}
