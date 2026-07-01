import type { AppConfig } from "../types";

// Anzeige-Version inkl. Beta-Stand (eine zentrale Quelle; pro Release-Tag aktualisieren).
// Der macOS-"Ueber"-Dialog zeigt nur die reine semver (2.0.0); diese Zeile macht den Beta-Stand sichtbar.
export const APP_VERSION_LABEL = "2.0.0 Beta 20";

export const defaultConfig: AppConfig = {
  appVersion: "2.0.0",
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
    dedupeUploads: false,
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
  codexModel: "",
  claudeModel: "",
  claudeEffort: "",
  runnerConnectorMode: false,
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
