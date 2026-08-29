import type { GradientSpec } from '@src/types/color';
import React, { useEffect, useRef, useState } from 'react';
import { getStatValueSignal } from '@stores/signals/statsSignals';
import type { StatItemType } from '@src/types/key/statItems';
import GraphPanel from '@components/shared/GraphPanel';
import { resolveImageSource } from '@utils/core/imageSource';

const GRAPH_UPDATE_MS = 100;

interface GraphPosition {
  hidden?: boolean;
  statType?: string;
  graphType?: string;
  graphSpeed?: number;
  graphColor?: string;
  showAvgLine?: boolean;
  graphAnimationEnabled?: boolean;
  backgroundColor?: string;
  borderColor?: string;
  backgroundGradient?: GradientSpec | null;
  borderGradient?: GradientSpec | null;
  borderWidth?: number;
  borderRadius?: number;
  inactiveImage?: string;
  activeImage?: string;
  idleImageFit?: string;
  imageFit?: string;
  useInlineStyles?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  zIndex?: number;
}

interface OverlayGraphItemProps {
  position: GraphPosition;
  index?: number;
}

interface GraphState {
  history: number[];
  avg: number;
  maxval: number;
}

function normalizeGraphSpeed(speed: number | undefined): number {
  const numeric = Number(speed);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1000;
  return Math.max(500, Math.min(5000, Math.round(numeric)));
}

function createInitialHistory(speed: number | undefined): number[] {
  const targetSize = Math.max(
    1,
    Math.ceil(normalizeGraphSpeed(speed) / GRAPH_UPDATE_MS),
  );
  return new Array(targetSize).fill(0);
}

const OverlayGraphItem = ({ position, index = 0 }: OverlayGraphItemProps) => {
  const {
    statType = 'kps',
    graphType = 'line',
    graphSpeed = 1000,
    graphColor = '#86EFAC',
    showAvgLine = true,
    graphAnimationEnabled = true,
    backgroundColor,
    borderColor,
    backgroundGradient,
    borderGradient,
    borderWidth,
    borderRadius,
    inactiveImage,
    activeImage,
    idleImageFit,
    imageFit,
    useInlineStyles = false,
    dx = 0,
    dy = 0,
    width = 200,
    height = 100,
    className,
  } = position ?? ({} as Partial<GraphPosition>);

  const statSignal = getStatValueSignal(statType as StatItemType);
  const imageSrc =
    resolveImageSource(inactiveImage) ||
    resolveImageSource(activeImage) ||
    null;
  const resolvedImageFit = idleImageFit || imageFit || 'cover';
  const [uid] = useState(
    () => `graph-overlay-${Math.random().toString(36).slice(2, 11)}`,
  );
  const graphSpeedRef = useRef<number>(normalizeGraphSpeed(graphSpeed));
  const historyBufferRef = useRef<number[]>(createInitialHistory(graphSpeed));
  const maxValueRef = useRef<number>(1);
  const valueSumRef = useRef<number>(0);
  const valueCountRef = useRef<number>(0);
  const wasIdleRef = useRef<boolean>(false);

  const [graphState, setGraphState] = useState<GraphState>(() => ({
    history: createInitialHistory(graphSpeed),
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
    wasIdleRef.current = false;
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
        Math.ceil(graphSpeedRef.current / GRAPH_UPDATE_MS),
      );
      while (history.length > targetSize) history.shift();
      while (history.length < targetSize) history.unshift(0);

      // 유휴(현재 값 0 + 히스토리 전부 0)면 이전 커밋과 동일 상태 — 재커밋 생략
      const isIdle =
        currentValue === 0 && !history.some((value) => value !== 0);
      if (isIdle && wasIdleRef.current) return;
      wasIdleRef.current = isIdle;

      setGraphState({
        history: [...history],
        avg,
        maxval: Math.max(maxValueRef.current, 1),
      });
    }, GRAPH_UPDATE_MS);

    return () => clearInterval(interval);
  }, [statSignal]);

  if (!position || position.hidden) return null;

  return (
    <GraphPanel
      dx={dx}
      dy={dy}
      width={width}
      height={height}
      zIndex={position.zIndex ?? index}
      className={className}
      graphType={graphType as 'line' | 'bar'}
      graphColor={graphColor}
      showAvgLine={showAvgLine}
      animationEnabled={graphAnimationEnabled ?? true}
      backgroundColor={backgroundColor}
      borderColor={borderColor}
      backgroundGradient={backgroundGradient}
      borderGradient={borderGradient}
      borderWidth={borderWidth}
      borderRadius={borderRadius}
      imageSrc={imageSrc}
      imageFit={resolvedImageFit}
      useInlineStyles={useInlineStyles}
      history={graphState.history}
      avg={graphState.avg}
      maxval={graphState.maxval}
      uid={uid}
      withOffsetVars={true}
      interactive={false}
      overlayHitRegion
    />
  );
};

export default OverlayGraphItem;
