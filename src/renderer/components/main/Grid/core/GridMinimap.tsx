import { beginDragCursor, endDragCursor } from '@utils/dom/dragCursor';
import React, { useState, useRef, useEffect } from 'react';
import { useGridViewStore } from '@stores/grid/useGridViewStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import DigitPopLayer from '@components/main/common/DigitPopLayer';
import { useDigitPop } from '@hooks/ui/useDigitPop';
import IconMotion from '@components/main/Tool/icons/IconMotion';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';

interface Position {
  dx: number;
  dy: number;
  width?: number;
  height?: number;
  hidden?: boolean;
}

interface PluginElementPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GridMinimapProps {
  positions: Position[];
  statPositions?: Position[];
  graphPositions?: Position[];
  knobPositions?: Position[];
  spritePositions?: Position[];
  zoom: number;
  panX: number;
  panY: number;
  containerRef: React.RefObject<HTMLDivElement>;
  mode: string;
  visible?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
}

const MINIMAP_WIDTH = 120;
const MINIMAP_HEIGHT = 80;
const MINIMAP_PADDING = 10;

interface ZoomButtonProps {
  onClick: () => void;
  title: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

// 줌 컨트롤 공통 버튼. 호버 배경만으로는 눌림이 안 읽혀 아이콘이 누름을 따라 줄어든다
const ZoomButton = ({ onClick, title, style, children }: ZoomButtonProps) => (
  <div
    role="button"
    tabIndex={0}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="dmn-icon-press flex-1 flex items-center justify-center h-full text-fg-faint hover:text-fg cursor-pointer"
    style={{
      backgroundColor: 'transparent',
      transition: 'background-color 150ms, color 150ms',
      ...style,
    }}
    onMouseEnter={(e) =>
      (e.currentTarget.style.backgroundColor = 'var(--ui-fill-active)')
    }
    onMouseLeave={(e) =>
      (e.currentTarget.style.backgroundColor = 'transparent')
    }
    title={title}
  >
    <IconMotion>{children}</IconMotion>
  </div>
);

const GridMinimap = ({
  positions,
  statPositions = [],
  graphPositions = [],
  knobPositions = [],
  spritePositions = [],
  zoom,
  panX,
  panY,
  containerRef,
  mode,
  visible = false,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  continuousInputStrategy = 'frame',
}: GridMinimapProps) => {
  const { setPan } = useGridViewStore();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const minimapRef = useRef<HTMLDivElement>(null);

  // 배율 라벨 - 바뀐 자릿수만 튀어오르는 숫자 스텝 팝인을 NumberInput과 같은 경로로 재생
  const zoomText = `${Math.round(zoom * 100)}%`;
  const { pop: zoomDigitPopState, play: playZoomDigitPop } = useDigitPop();
  const zoomTextRef = useRef(zoomText);
  // 버튼 스텝에서만 재생한다. 휠 줌은 프레임마다 값이 바뀌어 재생이 겹치면
  // 숫자가 계속 깜빡여 눈으로 좇을 수 없다
  const zoomStepPendingRef = useRef(false);
  const stepZoom = (action: () => void) => () => {
    zoomStepPendingRef.current = true;
    action();
  };
  useEffect(() => {
    const prevText = zoomTextRef.current;
    if (prevText === zoomText) return;
    zoomTextRef.current = zoomText;
    const fromStep = zoomStepPendingRef.current;
    zoomStepPendingRef.current = false;
    if (!fromStep) return;
    playZoomDigitPop(
      prevText,
      zoomText,
      parseInt(zoomText, 10) > parseInt(prevText, 10) ? 1 : -1,
    );
  }, [zoomText, playZoomDigitPop]);
  // 표시값과 어긋난 재생은 접는다 - 연속 줌 중 늦게 온 오버레이가 옛 숫자를 남기지 않게
  const zoomPop =
    zoomDigitPopState && zoomDigitPopState.text === zoomText
      ? zoomDigitPopState
      : null;
  const [containerSize, setContainerSize] = useState({
    width: 400,
    height: 300,
  });

  // 플러그인 요소들 가져오기
  const pluginElements = usePluginDisplayElementStore(
    (state) => state.elements,
  );
  const selectedKeyType = useKeyStore((state) => state.selectedKeyType);

  // 현재 탭의 플러그인 요소만 필터링
  const filteredPluginElements = (() => {
    return pluginElements.filter((el) => {
      if (el.hidden) return false;
      if (el.tabId) {
        return el.tabId === selectedKeyType;
      }
      return true;
    });
  })();

  // 플러그인 요소들의 위치 정보 추출
  const pluginPositions: PluginElementPosition[] = (() => {
    return filteredPluginElements.map((el) => ({
      x: el.position?.x || 0,
      y: el.position?.y || 0,
      width: el.measuredSize?.width || el.estimatedSize?.width || 50,
      height: el.measuredSize?.height || el.estimatedSize?.height || 50,
    }));
  })();

  // 컨테이너 크기 추적 (ResizeObserver 사용)
  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    // 초기 크기 설정
    updateSize();

    // ResizeObserver로 크기 변경 감지
    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  // 모든 키 + 플러그인 요소의 바운딩 박스 계산
  const contentBounds = (() => {
    if (
      positions.length === 0 &&
      statPositions.length === 0 &&
      graphPositions.length === 0 &&
      knobPositions.length === 0 &&
      spritePositions.length === 0 &&
      pluginPositions.length === 0
    ) {
      return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    // 키들의 바운딩 박스 계산
    positions.forEach((pos) => {
      if (pos.hidden) return;
      const x = pos.dx || 0;
      const y = pos.dy || 0;
      const w = pos.width || 60;
      const h = pos.height || 60;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    // 통계 요소 bounds
    statPositions.forEach((pos) => {
      if (pos.hidden) return;
      const x = pos.dx || 0;
      const y = pos.dy || 0;
      const w = pos.width || 60;
      const h = pos.height || 60;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    // 그래프 요소 bounds
    graphPositions.forEach((pos) => {
      if (pos.hidden) return;
      const x = pos.dx || 0;
      const y = pos.dy || 0;
      const w = pos.width || 200;
      const h = pos.height || 100;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    // 노브 요소 bounds
    knobPositions.forEach((pos) => {
      if (pos.hidden) return;
      const x = pos.dx || 0;
      const y = pos.dy || 0;
      const w = pos.width || 60;
      const h = pos.height || 60;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    // 스프라이트 요소 bounds
    spritePositions.forEach((pos) => {
      if (pos.hidden) return;
      const x = pos.dx || 0;
      const y = pos.dy || 0;
      const w = pos.width || 200;
      const h = pos.height || 200;

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    });

    // 플러그인 요소들의 바운딩 박스 계산
    pluginPositions.forEach((pos) => {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    });

    return { minX, minY, maxX, maxY };
  })();

  // 초기 뷰포트(panX=0, panY=0, zoom=1)와 컨텐츠를 합친 고정 바운딩 박스
  // panX/panY에 의존하지 않아 드래그 중에도 크기가 변하지 않음
  const bounds = (() => {
    // 초기 상태(pan=0, zoom=1)의 뷰포트 영역: (0,0) ~ (containerSize)
    const initialViewX = 0;
    const initialViewY = 0;
    const initialViewWidth = containerSize.width;
    const initialViewHeight = containerSize.height;

    // 컨텐츠 bounds와 초기 뷰포트 영역을 합침
    const minX = Math.min(contentBounds.minX, initialViewX);
    const minY = Math.min(contentBounds.minY, initialViewY);
    const maxX = Math.max(contentBounds.maxX, initialViewX + initialViewWidth);
    const maxY = Math.max(contentBounds.maxY, initialViewY + initialViewHeight);

    return { minX, minY, maxX, maxY };
  })();

  // 미니맵 스케일 및 오프셋 계산 (중앙 정렬)
  const { minimapScale, offsetX, offsetY } = (() => {
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    const scaleX = (MINIMAP_WIDTH - MINIMAP_PADDING * 2) / contentWidth;
    const scaleY = (MINIMAP_HEIGHT - MINIMAP_PADDING * 2) / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1);

    // 컨텐츠를 미니맵 중앙에 정렬하기 위한 오프셋
    const scaledWidth = contentWidth * scale;
    const scaledHeight = contentHeight * scale;
    const oX = (MINIMAP_WIDTH - scaledWidth) / 2;
    const oY = (MINIMAP_HEIGHT - scaledHeight) / 2;

    return { minimapScale: scale, offsetX: oX, offsetY: oY };
  })();

  // 뷰포트 영역 계산
  const viewport = (() => {
    // 화면에 보이는 그리드 영역 (줌/팬 역산)
    const viewX = -panX / zoom;
    const viewY = -panY / zoom;
    const viewWidth = containerSize.width / zoom;
    const viewHeight = containerSize.height / zoom;

    // 미니맵 좌표로 변환 (중앙 정렬 오프셋 적용)
    const x = (viewX - bounds.minX) * minimapScale + offsetX;
    const y = (viewY - bounds.minY) * minimapScale + offsetY;
    const width = viewWidth * minimapScale;
    const height = viewHeight * minimapScale;

    return { x, y, width, height };
  })();

  // 미니맵 좌표를 팬 값으로 변환
  const minimapToGridPan = (minimapX: number, minimapY: number) => {
    // 미니맵 좌표를 그리드 좌표로 변환 (중앙 정렬 오프셋 적용)
    const gridX = (minimapX - offsetX) / minimapScale + bounds.minX;
    const gridY = (minimapY - offsetY) / minimapScale + bounds.minY;

    // 뷰포트 중앙이 해당 위치로 오도록 팬 설정
    const newPanX = -(gridX * zoom - containerSize.width / 2);
    const newPanY = -(gridY * zoom - containerSize.height / 2);

    return { panX: newPanX, panY: newPanY };
  };

  // 미니맵 클릭으로 팬 이동
  const handleMinimapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) return; // 드래그 중에는 클릭 무시

    const minimapRect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - minimapRect.left;
    const clickY = e.clientY - minimapRect.top;

    const { panX: newPanX, panY: newPanY } = minimapToGridPan(clickX, clickY);
    setPan(mode, newPanX, newPanY);
  };

  // 진행 중 드래그의 복구 함수 - unmount 시에도 전역 커서 원복
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);

  // 드래그 시작
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    // 잡은 순간의 커서를 드래그 내내 유지 - 미니맵 밖으로 나가도 복귀하지 않게
    beginDragCursor(getComputedStyle(e.currentTarget).cursor || 'pointer');

    const minimapRect = e.currentTarget.getBoundingClientRect();

    const applyMouseMove = (moveEvent: MouseEvent) => {
      const clickX = moveEvent.clientX - minimapRect.left;
      const clickY = moveEvent.clientY - minimapRect.top;

      const { panX: newPanX, panY: newPanY } = minimapToGridPan(clickX, clickY);
      setPan(mode, newPanX, newPanY);
    };
    const moveScheduler = createRafLatestScheduler(
      applyMouseMove,
      continuousInputStrategy,
    );
    const handleMouseMove = (moveEvent: MouseEvent) =>
      moveScheduler.push(moveEvent);

    const handleMouseUp = () => {
      moveScheduler.flush();
      moveScheduler.cancel();
      setIsDragging(false);
      endDragCursor();
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      window.removeEventListener('pointercancel', handleMouseUp);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current = handleMouseUp;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    // 드래그 중 포커스 상실·포인터 취소 시에도 커서·드래그 상태 복구
    window.addEventListener('blur', handleMouseUp);
    window.addEventListener('pointercancel', handleMouseUp);
  };

  // 키 개수와 플러그인 요소가 모두 없으면 미니맵 숨김
  if (
    positions.length === 0 &&
    statPositions.length === 0 &&
    graphPositions.length === 0 &&
    knobPositions.length === 0 &&
    spritePositions.length === 0 &&
    pluginPositions.length === 0
  ) {
    return null;
  }

  // 미니맵이 보여야 하는 조건: 그리드 호버 중이거나, 미니맵 자체 호버 중이거나, 드래그 중
  const shouldShow = visible || isHovering || isDragging;

  // 요소 rect 공통 렌더링 — 그룹별 기본 크기·투명도·라운드만 다름
  const renderElementRects = (
    prefix: string,
    items: Position[],
    { opacity = 0.38, defaultW = 60, defaultH = 60, round = false } = {},
  ) =>
    items.map((pos, index) => {
      if (pos.hidden) return null;
      const x = ((pos.dx || 0) - bounds.minX) * minimapScale + offsetX;
      const y = ((pos.dy || 0) - bounds.minY) * minimapScale + offsetY;
      const w = (pos.width || defaultW) * minimapScale;
      const h = (pos.height || defaultH) * minimapScale;

      return (
        <rect
          key={`${prefix}-${index}`}
          x={x}
          y={y}
          width={Math.max(w, 2)}
          height={Math.max(h, 2)}
          fill="var(--ui-fg)"
          fillOpacity={opacity}
          rx={round ? Math.max(w, h) / 2 : 1}
        />
      );
    });

  return (
    <div
      ref={minimapRef}
      className="absolute bottom-2 left-2 z-[var(--z-chrome-panel)] select-none bg-glass-dim backdrop-glass-popup backdrop-glass-canvas rounded-[8px] shadow-elevation-chrome overflow-hidden"
      // 상주 글래스 표면이라 opacity 페이드 금지 - 블러+opacity 조합은 WKWebView에서
      // 블러 레이어가 점멸한다 (panelChrome 규칙). 등퇴장이 필요하면 마운트 토글로.
      // 라이브 블러 유지 조건은 Windows 키 연타 프레임 실측 (미달 시 -solid 토큰 복귀)
      style={{
        width: MINIMAP_WIDTH,
        opacity: shouldShow ? 1 : 0,
        pointerEvents: shouldShow ? 'auto' : 'none',
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* 줌 컨트롤 (미니맵 위) */}
      <div
        className="flex items-center cursor-default"
        style={{
          width: '100%',
          height: 23,
          borderBottom: '0.5px solid var(--ui-line)',
          boxSizing: 'border-box',
        }}
      >
        {/* 초기화 버튼 */}
        <ZoomButton
          onClick={stepZoom(onResetZoom)}
          title="Reset zoom (Ctrl+0)"
          style={{ borderTopLeftRadius: 3, borderBottomLeftRadius: 3 }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            {/* 좌상단 ㄱ */}
            <path
              d="M2 4.5V2H4.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* 우상단 ㄱ 뒤집힌 */}
            <path
              d="M7.5 2H10V4.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* 좌하단 ㄴ */}
            <path
              d="M2 7.5V10H4.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* 우하단 ㄴ 뒤집힌 */}
            <path
              d="M7.5 10H10V7.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </ZoomButton>
        {/* 확대 버튼 */}
        <ZoomButton onClick={stepZoom(onZoomIn)} title="Zoom in (Ctrl++)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M6 3V9M3 6H9"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </ZoomButton>
        {/* 축소 버튼 */}
        <ZoomButton onClick={stepZoom(onZoomOut)} title="Zoom out (Ctrl+-)">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3 6H9"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </ZoomButton>
        {/* 현재 배율 */}
        <span
          className={`relative w-[42px] h-full flex items-center justify-center text-fg-muted text-xs tabular-nums${
            zoomPop ? ' dmn-digit-pop-host' : ''
          }`}
          style={{ borderTopRightRadius: 4, borderBottomRightRadius: 4 }}
        >
          {zoomText}
          {zoomPop && (
            <DigitPopLayer
              key={zoomPop.cycle}
              pop={zoomPop}
              className="text-fg-muted text-xs tabular-nums"
            />
          )}
        </span>
      </div>
      {/* 미니맵 */}
      <div
        data-grid-minimap-surface="true"
        className="relative cursor-pointer"
        style={{
          width: '100%',
          height: MINIMAP_HEIGHT,
        }}
        onClick={handleMinimapClick}
        onMouseDown={handleMouseDown}
      >
        {/* 키 및 플러그인 요소 표시 */}
        <svg
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          className="absolute top-0 left-0"
        >
          {/* 키 표시 */}
          {renderElementRects('key', positions, { opacity: 0.55 })}
          {/* 통계 요소 표시 */}
          {renderElementRects('stat', statPositions)}
          {/* 그래프 요소 표시 */}
          {renderElementRects('graph', graphPositions, {
            defaultW: 200,
            defaultH: 100,
          })}
          {/* 노브 요소 표시 */}
          {renderElementRects('knob', knobPositions, { round: true })}
          {/* 스프라이트 요소 표시 */}
          {renderElementRects('sprite', spritePositions, {
            defaultW: 200,
            defaultH: 200,
          })}
          {/* 플러그인 요소 표시 */}
          {renderElementRects(
            'plugin',
            pluginPositions.map((pos) => ({
              dx: pos.x,
              dy: pos.y,
              width: pos.width,
              height: pos.height,
            })),
          )}
          {/* 현재 뷰포트 표시 */}
          <rect
            x={viewport.x}
            y={viewport.y}
            width={viewport.width}
            height={viewport.height}
            fill="var(--ui-accent-muted)"
            stroke="var(--ui-accent)"
            strokeOpacity={0.8}
            strokeWidth={1}
            rx={2}
          />
        </svg>
      </div>
    </div>
  );
};

export default GridMinimap;
