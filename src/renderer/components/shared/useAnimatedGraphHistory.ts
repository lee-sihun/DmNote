/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useRef, useState } from 'react';

export const normalizeGraphHistory = (history: number[]): number[] => {
  if (!Array.isArray(history)) return [];
  return history.map((value: number) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  });
};

const resizeHistory = (history: number[], targetSize: number): number[] => {
  if (targetSize <= 0) return [];
  if (!history.length) return new Array(targetSize).fill(0);
  if (history.length === targetSize) return [...history];
  if (targetSize === 1) return [history[history.length - 1] || 0];

  const sourceLastIndex = history.length - 1;
  const targetLastIndex = targetSize - 1;
  return Array.from({ length: targetSize }, (_value, index) => {
    const sourceIndex = Math.round((index / targetLastIndex) * sourceLastIndex);
    return history[sourceIndex] || 0;
  });
};

const areHistoriesEqual = (first: number[], second: number[]): boolean => {
  if (first.length !== second.length) return false;
  for (let index = 0; index < first.length; index += 1) {
    if (Math.abs(first[index] - second[index]) > 0.001) return false;
  }
  return true;
};

export const useAnimatedGraphHistory = (
  normalizedHistory: number[],
  active: boolean,
  durationMs: number,
): number[] => {
  const [animatedHistory, setAnimatedHistory] = useState<number[]>(
    () => normalizedHistory,
  );
  const animatedHistoryRef = useRef<number[]>(animatedHistory);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    animatedHistoryRef.current = animatedHistory;
  }, [animatedHistory]);

  useEffect(
    () => () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!active) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (!areHistoriesEqual(animatedHistoryRef.current, normalizedHistory)) {
        animatedHistoryRef.current = normalizedHistory;
        setAnimatedHistory(normalizedHistory);
      }
      return;
    }

    const targetHistory = normalizedHistory;
    const targetSize = targetHistory.length;
    if (targetSize <= 0) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (animatedHistoryRef.current.length > 0) {
        animatedHistoryRef.current = [];
        setAnimatedHistory([]);
      }
      return;
    }

    const startHistory = resizeHistory(animatedHistoryRef.current, targetSize);
    if (areHistoriesEqual(startHistory, targetHistory)) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (!areHistoriesEqual(animatedHistoryRef.current, targetHistory)) {
        animatedHistoryRef.current = targetHistory;
        setAnimatedHistory(targetHistory);
      }
      return;
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const startTime = performance.now();
    const animate = (now: number): void => {
      const progress = Math.min(1, (now - startTime) / Math.max(durationMs, 1));
      const eased = 1 - (1 - progress) * (1 - progress) * (1 - progress);
      const nextHistory = startHistory.map(
        (startValue, index) =>
          startValue + (targetHistory[index] - startValue) * eased,
      );

      setAnimatedHistory(nextHistory);
      animatedHistoryRef.current = nextHistory;

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [active, durationMs, normalizedHistory]);

  return animatedHistory;
};
