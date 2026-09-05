import React from 'react';
import type { CounterAnimationBezier } from '@src/types/key/keys';
import {
  COUNTER_EDITOR_PADDING as EDITOR_PADDING,
  COUNTER_EDITOR_SIZE as EDITOR_SIZE,
  COUNTER_EDITOR_TOTAL_SIZE as TOTAL_SIZE,
  COUNTER_GRID_PATH_MAJOR as GRID_PATH_MAJOR,
  COUNTER_GRID_PATH_MINOR as GRID_PATH_MINOR,
  resolveCounterEditorViewDimensions as viewDims,
} from './counterAnimationEditorModel';

// 캔버스 그리드 색 — 커브 에디터와 미리보기 스테이지가 공유
// 흰색 알파 토큰이라 반투명 인셋 웰(글래스) 위에서 배경 톤을 따라 자연 합성됨
const GRID_MAJOR_COLOR = 'var(--ui-line)';
export const COUNTER_ANIMATION_GRID_MINOR_COLOR = 'var(--ui-line-faint)';
export const COUNTER_ANIMATION_HANDLE_RADIUS = 6;
const HANDLE_HIT_RADIUS = 10;

interface CounterAnimationCurveCanvasProps {
  editorAreaRef: React.RefCallback<HTMLDivElement>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  bezier: CounterAnimationBezier;
  editorSize: { width: number; height: number };
  viewOffset: { x: number; y: number };
  viewScale: number;
  onWheel: React.WheelEventHandler<SVGSVGElement>;
  onPointerDown: React.PointerEventHandler<SVGSVGElement>;
  onDoubleClick: React.MouseEventHandler<SVGSVGElement>;
  onHandlePointerDown: (
    event: React.PointerEvent<SVGCircleElement>,
    target: 'p1' | 'p2',
  ) => void;
}

const CounterAnimationCurveCanvas = ({
  editorAreaRef,
  svgRef,
  bezier,
  editorSize,
  viewOffset,
  viewScale,
  onWheel,
  onPointerDown,
  onDoubleClick,
  onHandlePointerDown,
}: CounterAnimationCurveCanvasProps) => {
  const P = EDITOR_PADDING;
  const S = EDITOR_SIZE;
  const p1w = { x: P + bezier[0] * S, y: P + (1 - bezier[1]) * S };
  const p2w = { x: P + bezier[2] * S, y: P + (1 - bezier[3]) * S };
  const startW = { x: P, y: P + S };
  const endW = { x: P + S, y: P };

  const renderAspect =
    editorSize.height > 0 ? editorSize.width / editorSize.height : 1;
  const { base: vbBase, vbW, vbH } = viewDims(viewScale, renderAspect);
  const viewLeft = viewOffset.x - (vbW - vbBase) / 2;
  const viewTop = viewOffset.y - (vbH - vbBase) / 2;
  const viewBoxStr = `${viewLeft} ${viewTop} ${vbW} ${vbH}`;
  const ns = 1 / viewScale;
  // 캔버스와 줌에 관계없이 기존 손잡이 화면 크기 유지
  const uns =
    ns *
    (TOTAL_SIZE / Math.max(Math.min(editorSize.width, editorSize.height), 1));

  return (
    <div className="flex-1 min-w-0 min-h-0 bg-fill-faint rounded-surface p-[10px] flex flex-col">
      <div
        ref={editorAreaRef}
        className="relative flex-1 min-h-0 min-w-0 rounded-md overflow-hidden bg-inset"
      >
        <svg
          ref={svgRef}
          data-counter-bezier-editor="true"
          className="absolute inset-0 w-full h-full"
          viewBox={viewBoxStr}
          preserveAspectRatio="xMidYMid meet"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          style={{ cursor: 'default', touchAction: 'none' }}
        >
          {/* 배경 웰은 컨테이너 div(bg-inset)가 소유 — 프레임별 좌표 갱신 제거 */}
          {/* 커브 작업 사각형 — 좌표 영역이라 라운딩 없이 각을 유지 */}
          <rect x={P} y={P} width={S} height={S} fill="var(--ui-fill-faint)" />
          {/* crispEdges — CSS 그리드(미리보기)와 같은 또렷한 1px 라인 */}
          <path
            d={GRID_PATH_MINOR}
            fill="none"
            stroke={COUNTER_ANIMATION_GRID_MINOR_COLOR}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            shapeRendering="crispEdges"
          />
          <path
            d={GRID_PATH_MAJOR}
            fill="none"
            stroke={GRID_MAJOR_COLOR}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            shapeRendering="crispEdges"
          />
          <rect
            x={P}
            y={P}
            width={S}
            height={S}
            fill="none"
            stroke="var(--ui-line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={P}
            y1={P + S}
            x2={P + S}
            y2={P}
            stroke="var(--ui-line-strong)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="3 3"
          />
          <line
            x1={startW.x}
            y1={startW.y}
            x2={p1w.x}
            y2={p1w.y}
            stroke="var(--ui-fg-disabled)"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={endW.x}
            y1={endW.y}
            x2={p2w.x}
            y2={p2w.y}
            stroke="var(--ui-fg-disabled)"
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={`M ${startW.x} ${startW.y} C ${p1w.x} ${p1w.y}, ${p2w.x} ${p2w.y}, ${endW.x} ${endW.y}`}
            fill="none"
            stroke="var(--ui-accent)"
            strokeWidth="1.8"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            data-counter-bezier-handle="p1"
            cx={p1w.x}
            cy={p1w.y}
            r={HANDLE_HIT_RADIUS * uns}
            fill="transparent"
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => onHandlePointerDown(event, 'p1')}
          />
          <circle
            cx={p1w.x}
            cy={p1w.y}
            r={COUNTER_ANIMATION_HANDLE_RADIUS * uns}
            fill="var(--ui-bg-inset-solid)"
            stroke="var(--ui-accent)"
            strokeWidth={2 * uns}
            style={{ pointerEvents: 'none' }}
          />
          <circle
            data-counter-bezier-handle="p2"
            cx={p2w.x}
            cy={p2w.y}
            r={HANDLE_HIT_RADIUS * uns}
            fill="transparent"
            style={{ cursor: 'grab' }}
            onPointerDown={(event) => onHandlePointerDown(event, 'p2')}
          />
          <circle
            cx={p2w.x}
            cy={p2w.y}
            r={COUNTER_ANIMATION_HANDLE_RADIUS * uns}
            fill="var(--ui-bg-inset-solid)"
            stroke="rgba(255, 255, 255, 0.85)"
            strokeWidth={2 * uns}
            style={{ pointerEvents: 'none' }}
          />
        </svg>
      </div>
    </div>
  );
};

export default CounterAnimationCurveCanvas;
