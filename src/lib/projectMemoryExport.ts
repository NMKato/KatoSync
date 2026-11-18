// Created by NMKato Solutions
// Explicit local snapshot export. The selected project and directory remain
// bound across the native dialog; changing projects never exports the new one.
export type MemoryProjectionExportReceipt = {
  projectId: string;
  written: string[];
  unchanged: string[];
  preservedEdits: string[];
};

type MemoryExportActions = {
  isCurrent: () => boolean;
  chooseDirectory: () => Promise<string | null>;
  writeProjection: (input: {projectId: string; targetDir: string}) => Promise<MemoryProjectionExportReceipt>;
};

export async function exportProjectMemoryProjection(
  projectId: string,
  actions: MemoryExportActions
): Promise<MemoryProjectionExportReceipt | null> {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(projectId)) {
    throw new Error("memory_export_invalid_project");
  }
  if (!actions.isCurrent()) return null;
  const targetDir = await actions.chooseDirectory();
  if (!targetDir || !actions.isCurrent()) return null;
  const receipt = await actions.writeProjection({projectId, targetDir});
  if (!actions.isCurrent()) return null;
  if (!receipt || receipt.projectId !== projectId ||
      [receipt.written, receipt.unchanged, receipt.preservedEdits].some(
        entries => !Array.isArray(entries) || entries.some(entry => typeof entry !== "string")
      )) {
    throw new Error("memory_export_invalid_receipt");
  }
  return receipt;
}
