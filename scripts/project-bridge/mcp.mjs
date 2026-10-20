#!/usr/bin/env node
// Created by NMKato Solutions
// Official MCP v2 stdio server; launched ONLY by a locally authorized MCP host.
// No HTTP port, no implicit project enumeration and no write-capable tools.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { bridgeConfig, getProjectContext, listProjects, BridgeError } from "./core.mjs";

let config;
try {
  config = bridgeConfig(process.argv.slice(2));
} catch (error) {
  process.stderr.write("KatoSync Project MCP: " + (error instanceof BridgeError ? error.code : "configuration_error") + "\n");
  process.exit(2);
}

function reply(run) {
  try {
    const value = run();
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof BridgeError ? error.code : "bridge_failed" }]
    };
  }
}

const serverFactory = () => {
  const server = new McpServer({ name: "katosync-project-bridge", version: "0.1.0" });
  server.registerTool("project_list", {
    title: "List explicitly allowed KatoSync projects",
    description: "Read only: returns project IDs/names scoped by the explicit local launch-time allowlist. Never grants file, tool, Git write or cloud upload privileges.",
    inputSchema: z.object({})
  }, () => reply(() => listProjects(config)));

  server.registerTool("project_context_get", {
    title: "Get a fresh KatoSync project context",
    description: "Read only: Git HEAD/branch/dirty state, safe documentation references and generic KUAS v1 instructions for an explicitly allowed Project Registry ID. No raw docs, local filesystem paths, credentials, private status contents or write permissions.",
    inputSchema: z.object({ projectId: z.string().min(1).max(160) })
  }, ({ projectId }) => reply(() => getProjectContext(config, projectId)));
  return server;
};

await serveStdio(serverFactory);
// MCP stdout is reserved for JSON-RPC only.
