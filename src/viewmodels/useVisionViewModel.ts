// Created by NMKato Solutions
// Vision-ViewModel: komponiert den Systemgraphen aus dem bestehenden KatoSync-ViewModel.
// Einzige eigene Quelle ist die read-only Memory-Fabric-Uebersicht (Zaehler, keine Inhalte).
// Keine Schreibaktionen, keine versteckten Seiteneffekte: "Aktualisieren" liest nur neu.
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildVisionGraph, filterVisionGraph, type VisionFilter } from "../lib/visionGraph";
import { getMemoryFabricOverview, isNativeRuntime } from "../repositories/katoSyncRepository";
import type { MemoryFabricOverview } from "../types";
import type { useKatoSyncViewModel } from "./useKatoSyncViewModel";

type KatoSyncViewModel = ReturnType<typeof useKatoSyncViewModel>;

export function useVisionViewModel(vm: KatoSyncViewModel) {
  const nativeRuntime = isNativeRuntime();
  const [memory, setMemory] = useState<MemoryFabricOverview | null>(null);
  const [memoryFailed, setMemoryFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState(() => new Date().toISOString());
  const [filter, setFilter] = useState<VisionFilter>("all");
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMemory(await getMemoryFabricOverview());
      setMemoryFailed(false);
    } catch {
      // Fehlertext bleibt intern; die Projektion weist die Quelle nur als nicht verfuegbar aus.
      setMemory(null);
      setMemoryFailed(true);
    } finally {
      setLoading(false);
      setLoadedAt(new Date().toISOString());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const config = vm.config;
  const graph = useMemo(
    () =>
      buildVisionGraph({
        nativeRuntime,
        config: config ? { device: config.device, libraryId: config.libraryId } : null,
        registry: vm.projects.loaded ? vm.projects.registry : null,
        agentSync: vm.agentSync,
        providerStatuses: vm.providerStatuses,
        localBrain: vm.localBrainStatus,
        memory,
        // libraryOk=false heisst nur "in dieser Sitzung nicht getestet", nicht "fehlgeschlagen".
        libraryVerified: vm.libraryOk ? true : null,
        now: vm.agentSync?.generatedAt ?? loadedAt
      }),
    [
      nativeRuntime,
      config,
      vm.projects.loaded,
      vm.projects.registry,
      vm.agentSync,
      vm.providerStatuses,
      vm.localBrainStatus,
      memory,
      vm.libraryOk,
      loadedAt
    ]
  );

  const view = useMemo(() => filterVisionGraph(graph, filter, query), [graph, filter, query]);

  return { graph, view, filter, setFilter, query, setQuery, refresh, loading, memoryFailed };
}
