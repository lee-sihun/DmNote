import { useEffect, useMemo } from 'react';
import { useStatItemStore } from '@stores/useStatItemStore';
import { useGraphItemStore } from '@stores/useGraphItemStore';
import { applyStatsSnapshot } from '@stores/statsSignals';

export function useBuiltinStatsSubscription() {
  const statPositions = useStatItemStore((state) => state.positions);
  const graphPositions = useGraphItemStore((state) => state.positions);

  const hasAnyStatConsumer = useMemo(() => {
    const hasStat = Object.values(statPositions || {}).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
    if (hasStat) return true;

    return Object.values(graphPositions || {}).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }, [statPositions, graphPositions]);

  useEffect(() => {
    if (!hasAnyStatConsumer) {
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
  }, [hasAnyStatConsumer]);
}
