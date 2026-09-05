import React, { useEffect } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { ContinuousInputStrategy } from '@utils/animation/rafLatestScheduler';
import {
  gradientAxisStopPoint,
  resolveGradientAxisBounds,
  type GradientAxisEnd,
} from './gradientAxisGeometry';
import { useGradientAxisDragSession } from './useGradientAxisDragSession';

/**
 * 온캔버스 그라데이션 축 - 피커가 그라데이션 형식으로 열려 있는 동안
 * 대상 요소 위에 축 선·앵커 점·색 스왓치를 그린다.
 * 축과 색은 완전 분리: 축 선·끝 앵커(흰 점) 드래그 = 각도만,
 * 색 스왓치(앵커 점 바로 위 태그) 드래그 = 축 위 위치만.
 * 축 선 클릭 = 스톱 추가, 스왓치 우클릭 = 삭제.
 * 모서리·변 중앙 방향 자석 스냅 기본, Ctrl/Cmd를 누르면 스냅 해제
 */

interface GradientAxisOverlayProps {
  positions: Record<string, KeyPosition[] | undefined>;
  statPositions: Record<string, StatItemPosition[] | undefined>;
  graphPositions?: Record<string, GraphItemPosition[] | undefined>;
  knobPositions?: Record<string, KnobItemPosition[] | undefined>;
  selectedElements: SelectedElement[];
  selectedKeyType: string;
  zoom: number;
  panX: number;
  panY: number;
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
}

// 축 끝 회전 앵커 - 시각 점과 히트 영역(px)
const ANCHOR_DOT_SIZE = 7;
const ANCHOR_HIT_SIZE = 18;
// 스톱 표식 - 앵커 점은 선 위, 색 스왓치는 그 바로 위에 붙는 태그
const STOP_ANCHOR_DOT_SIZE = 5;
const SWATCH_SIZE = 15;
const SWATCH_LIFT = 16;
// 축 선의 드래그 히트 두께(px) - 시각 선은 1.5px, 잡는 영역은 넓게
const AXIS_HIT_THICKNESS = 12;
const stopAll = (e: React.SyntheticEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

const GradientAxisOverlay = ({
  positions,
  statPositions,
  graphPositions,
  knobPositions,
  selectedElements,
  selectedKeyType,
  zoom,
  panX,
  panY,
  continuousInputStrategy = 'frame',
}: GradientAxisOverlayProps) => {
  const { t } = useTranslation();
  const session = useGradientEditStore((state) => state.session);
  // 카운터처럼 요소 저장 박스와 페인트 박스가 다른 표면이 등록한 실측 박스
  const registeredAnchorBounds = useGradientEditStore(
    (state) => state.anchorBounds,
  );
  // 피커 색 드래그 중 - 오버레이를 흐려 대상의 실제 색이 보이게 한다
  const colorAdjusting = useGradientEditStore((state) => state.colorAdjusting);
  const bounds = resolveGradientAxisBounds({
    session,
    registeredAnchorBounds,
    positions,
    statPositions,
    graphPositions,
    knobPositions,
    selectedElements,
    selectedKeyType,
  });
  const {
    rootRef,
    angle,
    geometry,
    dragStop,
    isRotating,
    beginStripPointer,
    beginAnchorRotate,
    beginStopDrag,
    handleRotateKeyDown,
    handleStopContextMenu,
  } = useGradientAxisDragSession({
    session,
    bounds,
    zoom,
    panX,
    panY,
    continuousInputStrategy,
  });
  const missingSingleSessionKey =
    session && session.anchor.kind !== 'batch' && !bounds
      ? session.sessionKey
      : null;

  useEffect(() => {
    if (!missingSingleSessionKey) return;
    const store = useGradientEditStore.getState();
    if (store.session?.sessionKey === missingSingleSessionKey) {
      store.setSession(null);
    }
  }, [missingSingleSessionKey]);

  if (!session || !bounds || !geometry) return null;

  const { cx, cy, halfLine, endX, endY } = geometry;
  // pos(0~1) → 축 위 화면 좌표
  const stopPoint = (pos: number) => gradientAxisStopPoint(geometry, pos);

  const dragStopScreen = dragStop ? stopPoint(dragStop.pos) : null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none"
      // 리사이즈 핸들 위, 사이드 패널 아래에 두는 내부 편집 층 - 패널 위로 새지 않게
      style={{ zIndex: 'var(--z-canvas-gradient-editor)' }}
      data-dmn-canvas-editor-overlay="true"
    >
      {/* 조작 UI 묶음 - 핸들 드래그나 피커 색 드래그 동안 흐려져
          가려진 대상의 실제 색이 보인다. 값 배지는 묶음 밖이라 선명 유지 */}
      <div
        className="absolute inset-0 pointer-events-none"
        data-dmn-gradient-axis-ui="true"
        style={{
          opacity: colorAdjusting || isRotating || dragStop ? 0.12 : 1,
          transition: 'opacity 120ms ease',
        }}
      >
        {/* 축 선 (시각) */}
        <div
          style={{
            position: 'absolute',
            left: cx,
            top: cy,
            width: halfLine * 2,
            height: 0,
            borderTop: '1.5px solid var(--ui-selection-border-strong)',
            transform: `translate(-50%, -50%) rotate(${angle - 90}deg)`,
            opacity: 0.9,
            pointerEvents: 'none',
          }}
        />
        {/* 축 히트 스트립 - 드래그 = 회전, 클릭 = 스톱 추가, 화살표 = 미세 조절 */}
        <div
          role="slider"
          tabIndex={0}
          // 마우스로 잡은 뒤 방향키 미세 조정이 설계된 컨트롤 - 잔류 포커스 가드 제외
          data-dmn-pointer-focus="retain"
          aria-label={t('colorPicker.gradientAngle')}
          aria-valuemin={0}
          aria-valuemax={359}
          aria-valuenow={Math.round(angle)}
          className="outline-none focus-visible:shadow-focus-ring"
          onPointerDown={beginStripPointer}
          onKeyDown={handleRotateKeyDown}
          onMouseDown={stopAll}
          style={{
            position: 'absolute',
            left: cx,
            top: cy,
            width: halfLine * 2,
            height: AXIS_HIT_THICKNESS,
            transform: `translate(-50%, -50%) rotate(${angle - 90}deg)`,
            cursor: isRotating ? 'grabbing' : 'default',
            pointerEvents: 'auto',
            touchAction: 'none',
          }}
        />
        {/* 축 끝 앵커 - 선 끝점 위 흰 점, 드래그로 각도만 조절 */}
        {(['start', 'end'] as GradientAxisEnd[]).map((end) => {
          const point = stopPoint(end === 'end' ? 1 : 0);
          return (
            <div
              key={`axis-${end}`}
              data-axis-anchor={end}
              aria-hidden="true"
              onPointerDown={beginAnchorRotate(end)}
              onMouseDown={stopAll}
              style={{
                position: 'absolute',
                left: point.x,
                top: point.y,
                width: ANCHOR_HIT_SIZE,
                height: ANCHOR_HIT_SIZE,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'translate(-50%, -50%)',
                cursor: isRotating ? 'grabbing' : 'default',
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
            >
              <i
                style={{
                  display: 'block',
                  width: ANCHOR_DOT_SIZE,
                  height: ANCHOR_DOT_SIZE,
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                }}
              />
            </div>
          );
        })}
        {/* 스톱 - 앵커 점은 선 위, 색 스왓치는 바로 위 태그. 드래그 = 위치, 우클릭 = 삭제 */}
        {session.spec.stops.map((stop, i) => {
          const point = stopPoint(stop.pos);
          const isAxisEnd = stop.pos === 0 || stop.pos === 1;
          return (
            <React.Fragment key={`stop-${i}`}>
              {!isAxisEnd && (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: point.x,
                    top: point.y,
                    width: STOP_ANCHOR_DOT_SIZE,
                    height: STOP_ANCHOR_DOT_SIZE,
                    borderRadius: '50%',
                    background: 'white',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
                    transform: 'translate(-50%, -50%)',
                    pointerEvents: 'none',
                  }}
                />
              )}
              <div
                role="button"
                aria-label={`stop ${i + 1}`}
                onPointerDown={beginStopDrag(i)}
                onMouseDown={stopAll}
                onContextMenu={handleStopContextMenu(i)}
                style={{
                  position: 'absolute',
                  left: point.x,
                  top: point.y - SWATCH_LIFT,
                  width: SWATCH_SIZE,
                  height: SWATCH_SIZE,
                  borderRadius: 4,
                  // 반투명 색은 격자 위 합성으로 표시 - 뒤 요소 비침 방지
                  background: `linear-gradient(${stop.color}, ${stop.color}), var(--ui-checker-pattern) center / var(--ui-checker-size-sm) var(--ui-checker-size-sm) repeat`,
                  border: '1.5px solid white',
                  boxShadow:
                    i === session.selectedIndex
                      ? '0 0 0 2px var(--ui-selection-border-strong), 0 1px 4px rgba(0,0,0,0.5)'
                      : '0 1px 4px rgba(0,0,0,0.5)',
                  transform: 'translate(-50%, -50%)',
                  cursor: dragStop?.index === i ? 'grabbing' : 'default',
                  pointerEvents: 'auto',
                  touchAction: 'none',
                }}
              />
            </React.Fragment>
          );
        })}
      </div>
      {/* 드래그 중 각도 표시 */}
      {isRotating && (
        <div
          className="text-caption text-fg tabular-nums"
          style={{
            position: 'absolute',
            left: endX + 12,
            top: endY - 24,
            padding: '2px 6px',
            borderRadius: 6,
            background: 'var(--ui-bg-inset-solid, rgba(24,24,29,0.9))',
            boxShadow: 'inset 0 0 0 1px var(--ui-line)',
            whiteSpace: 'nowrap',
          }}
        >
          {angle}°
        </div>
      )}
      {/* 스톱 드래그 중 위치 표시 */}
      {dragStop && dragStopScreen && (
        <div
          className="text-caption text-fg tabular-nums"
          style={{
            position: 'absolute',
            left: dragStopScreen.x + 12,
            top: dragStopScreen.y - 24,
            padding: '2px 6px',
            borderRadius: 6,
            background: 'var(--ui-bg-inset-solid, rgba(24,24,29,0.9))',
            boxShadow: 'inset 0 0 0 1px var(--ui-line)',
            whiteSpace: 'nowrap',
          }}
        >
          {Math.round(dragStop.pos * 100)}%
        </div>
      )}
    </div>
  );
};

export default GradientAxisOverlay;
