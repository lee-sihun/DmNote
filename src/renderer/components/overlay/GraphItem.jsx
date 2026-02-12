import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { getStatValueSignal } from "@stores/statsSignals";
import GraphPanel from "@components/graph/GraphPanel";

const GRAPH_UPDATE_MS = 100;
const GRAPH_TICK_MS = 50;

function normalizeGraphSpeed(speed) {
  const numeric = Number(speed);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1000;
  return Math.max(500, Math.min(5000, Math.round(numeric)));
}

function createInitialHistory(speed) {
  const targetSize = Math.max(
    1,
    Math.ceil(normalizeGraphSpeed(speed) / GRAPH_UPDATE_MS)
  );
  return new Array(targetSize).fill(0);
}

export default memo(function OverlayGraphItem({ position, index = 0 }) {
  if (!position || position.hidden) return null;

  const {
    statType = "kps",
    graphType = "line",
    graphSpeed = 1000,
    graphColor = "#86EFAC",
    dx = 0,
    dy = 0,
    width = 200,
    height = 100,
    className,
  } = position;

  const statSignal = useMemo(() => getStatValueSignal(statType), [statType]);
  const uidRef = useRef(
    `graph-overlay-${Math.random().toString(36).slice(2, 11)}`
  );
  const graphSpeedRef = useRef(normalizeGraphSpeed(graphSpeed));
  const historyBufferRef = useRef(createInitialHistory(graphSpeed));
  const maxValueRef = useRef(1);
  const valueSumRef = useRef(0);
  const valueCountRef = useRef(0);

  const [graphState, setGraphState] = useState(() => ({
    history: [...historyBufferRef.current],
    avg: 0,
    maxval: 1,
  }));

  useEffect(() => {
    graphSpeedRef.current = normalizeGraphSpeed(graphSpeed);
  }, [graphSpeed]);

  useEffect(() => {
    historyBufferRef.current = createInitialHistory(graphSpeedRef.current);
    maxValueRef.current = 1;
    valueSumRef.current = 0;
    valueCountRef.current = 0;
    setGraphState({
      history: [...historyBufferRef.current],
      avg: 0,
      maxval: 1,
    });
  }, [statType]);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentValue = (statSignal.value ?? 0) | 0;
      const history = historyBufferRef.current;

      if (currentValue > maxValueRef.current) {
        maxValueRef.current = currentValue;
      }

      if (currentValue > 0) {
        valueSumRef.current += currentValue;
        valueCountRef.current += 1;
      }
      const avg =
        valueCountRef.current > 0
          ? Math.round(valueSumRef.current / valueCountRef.current)
          : 0;

      history.shift();
      history.push(currentValue);

      const targetSize = Math.max(
        1,
        Math.ceil(graphSpeedRef.current / GRAPH_UPDATE_MS)
      );
      while (history.length > targetSize) history.shift();
      while (history.length < targetSize) history.unshift(0);

      setGraphState({
        history: [...history],
        avg,
        maxval: Math.max(maxValueRef.current, 1),
      });
    }, GRAPH_TICK_MS);

    return () => clearInterval(interval);
  }, [statSignal]);

  return (
    <GraphPanel
      dx={dx}
      dy={dy}
      width={width}
      height={height}
      zIndex={position.zIndex ?? index}
      className={className}
      graphType={graphType}
      graphColor={graphColor}
      history={graphState.history}
      avg={graphState.avg}
      maxval={graphState.maxval}
      uid={uidRef.current}
      withOffsetVars={true}
      interactive={false}
    />
  );
});
