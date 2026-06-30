import type { AppConfig } from "../types";

export const defaultConfig: AppConfig = {
  appVersion: "1.0.1",
  device: {
    deviceId: "demo-device",
    deviceName: "Dieser Rechner"
  },
  libraryId: "",
  mcp: {
    baseUrl: "https://mcp.katoos.de"
  },
  sourceRoots: [],
  outputDir: "~/Library/Application Support/KatoSync/current",
  schedule: {
    enabled: false,
    hour: 22,
    minute: 0,
    weekdays: ["mon", "tue", "wed", "thu", "fri"]
  },
  scanRules: {
    includeMemory: true,
    includeRoadmaps: true,
    includeTasks: true,
    includeCsv: false,
    includeDocuments: false,
    maxFileSizeMb: 5,
    uploadIndividualStatusFiles: false,
    maxIndividualUploads: 5
  },
  safety: {
    dryRunDefault: true,
    cleanupEnabled: false,
    secretScanEnabled: true
  },
  codexAutoPush: true,
  codexCreatePr: true,
  codexCodingMode: false,
  codexPreferredRunner: "codex_cli",
  referenceRoot: "",
  projectRepos: {}
};

export const weekdayLabels: Record<string, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So"
};
