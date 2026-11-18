// Created by NMKato Solutions
import assert from "node:assert/strict";
import {test} from "node:test";
import {exportProjectMemoryProjection, type MemoryProjectionExportReceipt} from "../src/lib/projectMemoryExport.ts";

const projectId = "registered-project-42";
const receipt: MemoryProjectionExportReceipt = {
  projectId, written: ["index.md", "PROJECT_STATUS_FLOW.md"],
  unchanged: ["MEMORY.md"], preservedEdits: ["PROJECT_STATUS_FLOW.user-edit-1.md"]
};

test("explicit export binds the selected directory and project and returns file counts", async () => {
  const writes: {projectId: string; targetDir: string}[] = [];
  const result = await exportProjectMemoryProjection(projectId, {
    isCurrent: () => true,
    chooseDirectory: async () => "/tmp/knowledge vault",
    writeProjection: async input => { writes.push(input); return receipt; }
  });
  assert.deepEqual(writes, [{projectId, targetDir: "/tmp/knowledge vault"}]);
  assert.deepEqual(result, receipt);
});

test("cancelling the directory dialog never invokes an export", async () => {
  let writes = 0;
  const result = await exportProjectMemoryProjection(projectId, {
    isCurrent: () => true,
    chooseDirectory: async () => null,
    writeProjection: async () => { writes++; return receipt; }
  });
  assert.equal(result, null);
  assert.equal(writes, 0);
});

test("changing project while the directory dialog is open prevents the write", async () => {
  let current = true;
  let writes = 0;
  const result = await exportProjectMemoryProjection(projectId, {
    isCurrent: () => current,
    chooseDirectory: async () => { current = false; return "/tmp/vault"; },
    writeProjection: async () => { writes++; return receipt; }
  });
  assert.equal(result, null);
  assert.equal(writes, 0);
});

test("late export completion cannot become the next project's receipt", async () => {
  let current = true;
  let writtenProject: string | undefined;
  const result = await exportProjectMemoryProjection(projectId, {
    isCurrent: () => current,
    chooseDirectory: async () => "/tmp/vault",
    writeProjection: async input => {
      writtenProject = input.projectId;
      current = false;
      return receipt;
    }
  });
  assert.equal(writtenProject, projectId);
  assert.equal(result, null);
});

test("foreign or malformed native receipts are rejected without reporting success", async () => {
  for (const bad of [
    {...receipt, projectId: "other-project"},
    {...receipt, preservedEdits: undefined},
    {...receipt, written: [42]},
    null
  ]) {
    await assert.rejects(exportProjectMemoryProjection(projectId, {
      isCurrent: () => true,
      chooseDirectory: async () => "/tmp/vault",
      writeProjection: async () => bad as unknown as MemoryProjectionExportReceipt
    }), /memory_export_invalid_receipt/);
  }
});

test("invalid projects and stale requests do not open a directory dialog", async () => {
  let dialogs = 0;
  let writes = 0;
  const actions = {
    isCurrent: () => true,
    chooseDirectory: async () => { dialogs++; return "/tmp/vault"; },
    writeProjection: async () => { writes++; return receipt; }
  };
  for (const invalid of ["", "../foreign", "a".repeat(129)]) {
    await assert.rejects(exportProjectMemoryProjection(invalid, actions), /memory_export_invalid_project/);
  }
  assert.equal(await exportProjectMemoryProjection(projectId, {
    ...actions, isCurrent: () => false
  }), null);
  assert.equal(dialogs, 0);
  assert.equal(writes, 0);
});

test("native export failure remains a failure", async () => {
  await assert.rejects(exportProjectMemoryProjection(projectId, {
    isCurrent: () => true,
    chooseDirectory: async () => "/tmp/vault",
    writeProjection: async () => { throw new Error("destination_unwritable"); }
  }), /destination_unwritable/);
});
