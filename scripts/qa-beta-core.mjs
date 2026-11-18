#!/usr/bin/env node
// Created by NMKato Solutions
// KatoSync 2.0 private beta: reproducible core regression gate.
// Source-level tests are NOT a substitute for native owner/session,
// signed installer, or cross-device end-to-end acceptance.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const suites = [
  'tests/chatMemorySafeRecovery.test.ts',
  'tests/localChatErrorClassification.test.ts',
  'tests/localMultimodalChatMvp.test.ts',
  'tests/continuityRecoveryLayout.test.ts',
  'tests/continuityHandoff.test.ts',
  'tests/masterChatHandoff.test.ts',
  'tests/readOnlyDispatchMvp.test.ts',
  'tests/resumeRunnerPlatformGate.test.ts',
];
if (process.argv.length > 2) {
  console.error('Usage: npm run test:beta-core (no release/deploy switches)');
  process.exit(2);
}
console.log('KatoSync 2.0 PRIVATE BETA core regression (no hardware/deploy)');
console.log('Coverage: local project chat, memory recovery, context handoff, read-only agent dispatch.');
const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', ...suites],
  { cwd: root, stdio: 'inherit', shell: false },
);
if (result.error) {
  console.error('Beta core test runner could not start:', result.error.code || 'START_ERROR');
  process.exit(1);
}
process.exit(result.status === 0 ? 0 : 1);
