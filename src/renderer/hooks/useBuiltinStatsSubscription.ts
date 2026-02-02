import { useEffect, useMemo } from "react";
import { useStatItemStore } from "@stores/useStatItemStore";
import { applyStatsSnapshot } from "@stores/statsSignals";

export function useBuiltinStatsSubscription() {
  const statPositions = useStatItemStore((state) => state.positions);

  const hasAnyStatItem = useMemo(() => {
    return Object.values(statPositions || {}).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }, [statPositions]);

  useEffect(() => {
    if (!hasAnyStatItem) {
      return;
    }

    // 초기 스냅샷
    try {
      applyStatsSnapshot(window.api.stats.get());
    } catch {
      // ignore
    }

    const unsubscribe = window.api.stats.subscribe((stats) => {
      applyStatsSnapshot(stats);
    });

    return () => {
      try {
        unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [hasAnyStatItem]);
}

