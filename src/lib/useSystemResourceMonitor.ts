// Created by NMKato Solutions
import { useCallback, useEffect, useRef, useState } from "react";
import { getSystemResourceSnapshot } from "../repositories/systemResourcesRepository";
import type { ResourceSnapshot } from "./systemResources";

export function useSystemResourceMonitor() {
  const [snapshot, setSnapshot] = useState<ResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const measured = await getSystemResourceSnapshot();
      setSnapshot(measured);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  // First sample on app open, then conservative polling; no background model process management.
  useEffect(() => {
    void refresh();
    const ticker = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(ticker);
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
