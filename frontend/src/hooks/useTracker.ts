import { getTrackerMetrics } from "@/services/api";
import type { TrackerMetrics } from "@/types";
import { useApi } from "@/hooks/useApi";

interface UseTrackerResult {
  tracker: TrackerMetrics | null;
  loading: boolean;
  error: string | null;
}

export function useTracker(): UseTrackerResult {
  const { data: tracker, loading, error } = useApi(getTrackerMetrics);
  return { tracker, loading, error };
}
