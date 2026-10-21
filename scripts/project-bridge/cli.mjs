#!/usr/bin/env node
// Created by NMKato Solutions
// Usage: node scripts/project-bridge/cli.mjs list|get <ID> --allow-project-id <ID>
import { bridgeConfig, getProjectContext, listProjects, BridgeError } from "./core.mjs";
const [command, ...rest] = process.argv.slice(2);
let id = null;
if (command === "get") id = rest.shift();
try {
  const config = bridgeConfig(rest);
  const result = command === "list" ? listProjects(config)
    : command === "get" ? getProjectContext(config, id)
    : (() => { throw new BridgeError("unknown_command"); })();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  // No absolute user paths, raw file contents or credentials in CLI errors.
  process.stderr.write("KatoSync Bridge: " + (error instanceof BridgeError ? error.code : "bridge_failed") + "\n");
  process.exitCode = 1;
}
