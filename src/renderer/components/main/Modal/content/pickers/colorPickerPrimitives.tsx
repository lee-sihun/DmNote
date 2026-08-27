import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { hsvToColorObject, type ColorObject } from '@utils/color/colorUtils';
import { CHECKER_PATTERN, CHECKER_SIZE } from './ColorSwatch';
import GooeyThumb from './GooeyThumb';
import {
  createRafLatestScheduler,
  type ContinuousInputStrategy,
} from '@utils/animation/rafLatestScheduler';
import { getEditSessionTarget } from '@src/renderer/editor/runtime/editSessionTarget';
import { useIsEditSessionScoped } from '@src/renderer/contexts/EditSessionScope';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';

// 디자인 조절점 — 내부 폭 148px 기준 비율 ≈1.42:1
const SATURATION_HEIGHT = 104;
const SATURATION_CURSOR_SIZE = 12;
const TRACK_HEIGHT = 12;
const KNOB_SIZE = 14;

// 키보드 스텝 — 화살표 1, Shift/Page는 hue 15° / 나머지 10
const HUE_PAGE_STEP = 15;
const PAGE_STEP = 10;

// 코너 마스크 — 32×32 rx=8 소스에 slice 8이면 코너 타일 1:1이라 크기 무관 rx 왜곡 없음
const SATURATION_CORNER_MASK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' rx='8' fill='%23000'/%3E%3C/svg%3E") 8 fill stretch`;

const HUE_TRACK_GRADIENT =
  'linear-gradient(to right, #f00, #ff0 16.67%, #0f0 33.33%, #0ff 50%, #00f 66.67%, #f0f 83.33%, #f00)';

interface ColorTrackProps {
  color: ColorObject;
  onChange: (color: ColorObject) => void;
  onChangeComplete?: (color: ColorObject) => void;
  disabled?: boolean;
  /** 성능 계측용 비교 전략. 제품 경로는 프레임당 최신 입력만 반영한다. */
  continuousInputStrategy?: ContinuousInputStrategy;
}

const clampRatio = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

// layout effect라야 flushSync로 당긴 커밋 직후 같은 호출 스택에서 최신 값을 읽는다
const useLatest = <T,>(value: T) => {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
};

// 트랙 드래그 세션 — 캡처 기반, 시작 시 1회 실측.
// 커서 렌더는 % 포지셔닝이라 측정에 의존하지 않음
// eslint-disable-next-line react-refresh/only-export-components
export const usePointerSession = (
  emit: (ratioX: number, ratioY: number, final: boolean) => void,
  continuousInputStrategy: ContinuousInputStrategy = 'frame',
  disabled = false,
) => {
  const emitRef = useLatest(emit);
  const activePointerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const lastRatioRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const blurCleanupRef = useRef<(() => void) | null>(null);
  const previewSchedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<true>
  > | null>(null);
  const editSessionScoped = useIsEditSessionScoped();
  const sessionTargetRef = useRef<string | null>(null);

  // 좌표를 0~1 비율로 갱신 — 세션 시작 시 rect 유효성이 보장됨
  const updateRatio = (clientX: number, clientY: number) => {
    const rect = rectRef.current;
    if (!rect) return false;
    lastRatioRef.current = {
      x: clampRatio((clientX - rect.left) / rect.width),
      y: clampRatio((clientY - rect.top) / rect.height),
    };
    return true;
  };

  const emitLast = (final: boolean) => {
    const { x, y } = lastRatioRef.current;
    emitRef.current(x, y, final);
  };

  // 스케줄러는 세션 시작 때 트랙이 사는 창으로 만들어 둔다
  const schedulePreview = () => {
    previewSchedulerRef.current?.push(true);
  };

  // 세션 해제 — 어떤 종료 경로로 와도 1회만 동작
  const teardown = () => {
    const pointerId = activePointerRef.current;
    if (pointerId === null) return;
    activePointerRef.current = null;
    useGradientEditStore.getState().setColorAdjusting(false);
    rectRef.current = null;
    previewSchedulerRef.current?.cancel();
    previewSchedulerRef.current = null;
    sessionTargetRef.current = null;
    blurCleanupRef.current?.();
    blurCleanupRef.current = null;
    const target = targetRef.current;
    targetRef.current = null;
    // 드래그 전역 커서 복원 - 포인터가 트랙 밖에 있어도 grabbing 유지 후 해제
    endDragCursor(target?.ownerDocument ?? document);
    if (target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  };

  // 종료 커밋 — 소유권을 먼저 해제해 complete 콜백이 동기로
  // blur/캡처 상실을 유발해도 재진입 중복 커밋이 불가능
  const finish = (clientX?: number, clientY?: number) => {
    if (activePointerRef.current === null) return;
    if (clientX !== undefined && clientY !== undefined) {
      updateRatio(clientX, clientY);
    }
    teardown();
    emitLast(true);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.button !== 0 || !event.isPrimary) return;
    if (activePointerRef.current !== null) return;
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    // 트랙 드래그가 시작되면 같은 팝업 안의 텍스트 편집은 끝난 것으로 본다.
    // 먼저 blur해 확정하고 그 커밋을 flushSync로 당겨야 첫 preview가 확정된 색에서
    // 출발한다. 확정만 하고 렌더를 기다리면 emit이 옛 색 클로저로 hex를 되덮는다
    const scope =
      target.closest('[role="dialog"]') ?? target.ownerDocument.body;
    const active = target.ownerDocument.activeElement;
    if (active?.matches('input, textarea') && scope.contains(active)) {
      flushSync(() => (active as HTMLElement).blur());
    }
    activePointerRef.current = event.pointerId;
    targetRef.current = target;
    rectRef.current = rect;
    // 색 조정 드래그 신호 - 그라데이션 축 오버레이가 스스로를 흐린다
    useGradientEditStore.getState().setColorAdjusting(true);
    sessionTargetRef.current = editSessionScoped
      ? getEditSessionTarget()
      : null;
    target.setPointerCapture(event.pointerId);
    // 잡는 동안 전역 grabbing - 캡처 중에도 커서는 히트테스트 기준(크로뮴)
    beginDragCursor('grabbing', target.ownerDocument);
    // 트랙이 분리 패널 자식 창에 있으면 그 창의 blur·프레임을 쓴다
    const ownerWindow = target.ownerDocument.defaultView ?? window;
    const onWindowBlur = () => finish();
    ownerWindow.addEventListener('blur', onWindowBlur);
    blurCleanupRef.current = () =>
      ownerWindow.removeEventListener('blur', onWindowBlur);
    previewSchedulerRef.current = createRafLatestScheduler<true>(
      () => emitLast(false),
      continuousInputStrategy,
      ownerWindow,
    );
    updateRatio(event.clientX, event.clientY);
    emitLast(false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerRef.current) return;
    updateRatio(event.clientX, event.clientY);
    schedulePreview();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerRef.current) return;
    finish(event.clientX, event.clientY);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerRef.current) return;
    finish();
  };

  // 명시적 release 후에는 activePointerRef가 이미 null이라 no-op
  const onLostPointerCapture = () => {
    finish();
  };

  // 드래그 중 언마운트(Esc로 팝업 닫힘 등)돼도 마지막 값을 커밋 - 저장 계약 유지.
  // 단 편집 대상에 묶인 피커에서 그 대상이 갈려 사라지는 경우는 커밋하지 않는다.
  // 콜백이 가리키는 곳이 드래그를 시작한 요소가 아니고, 배열이 줄어든 경우
  // 옛 index는 이미 다른 요소다. 캠버스 선택과 무관한 피커는 그대로 커밋한다
  const finishOnUnmount = () => {
    if (activePointerRef.current === null) return;
    const sessionTarget = sessionTargetRef.current;
    if (sessionTarget !== null && sessionTarget !== getEditSessionTarget()) {
      teardown();
      return;
    }
    finish();
  };
  const finishOnUnmountRef = useLatest(finishOnUnmount);
  useEffect(() => () => finishOnUnmountRef.current(), [finishOnUnmountRef]);

  // undo/redo 반영 시 진행 중 드래그를 커밋 없이 종료 - 이후 pointerup이나
  // 캡처 상실이 마지막 draft로 Undo 결과를 되돌리지 않게
  const historyTick = useCommittedApplyStore((state) => state.historyTick);
  const historyTickRef = useRef(historyTick);
  const teardownRef = useLatest(teardown);
  useEffect(() => {
    if (historyTickRef.current === historyTick) return;
    historyTickRef.current = historyTick;
    teardownRef.current();
  }, [historyTick, teardownRef]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  };
};

// 색 표면은 무테 — 원색 트랙·체커·필드가 스스로 경계를 정의, 밝은 링은 검정 영역에서 도드라짐
// 커서는 캔버스 아이템과 같은 정책 - 호버 무변화, 잡는 동안만 grabbing
const trackClassName =
  'relative w-full cursor-default touch-none select-none rounded-full ' +
  'outline-none focus-visible:shadow-focus-ring';

interface SaturationAreaProps extends ColorTrackProps {
  height?: number;
}

export const SaturationArea = ({
  color,
  height = SATURATION_HEIGHT,
  onChange,
  onChangeComplete,
  disabled = false,
  continuousInputStrategy,
}: SaturationAreaProps) => {
  const session = usePointerSession(
    (x, y, final) => {
      const next = hsvToColorObject({
        ...color.hsv,
        s: x * 100,
        v: 100 - y * 100,
      });
      onChange(next);
      if (final) onChangeComplete?.(next);
    },
    continuousInputStrategy,
    disabled,
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? PAGE_STEP : 1;
    let { s, v } = color.hsv;
    switch (event.key) {
      case 'ArrowLeft':
        s -= step;
        break;
      case 'ArrowRight':
        s += step;
        break;
      case 'ArrowUp':
        v += step;
        break;
      case 'ArrowDown':
        v -= step;
        break;
      case 'PageUp':
        v += PAGE_STEP;
        break;
      case 'PageDown':
        v -= PAGE_STEP;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = hsvToColorObject({ ...color.hsv, s, v });
    onChange(next);
    onChangeComplete?.(next);
  };

  return (
    <div
      {...session}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(color.hsv.v)}
      aria-valuetext={`Saturation ${Math.round(
        color.hsv.s,
      )}%, Brightness ${Math.round(color.hsv.v)}%`}
      onKeyDown={onKeyDown}
      className={`relative w-full touch-none select-none rounded-lg outline-none focus-visible:shadow-focus-ring ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-default'
      }`}
      style={{ height }}
    >
      {/* 라운딩은 클립이 아니라 9-slice 마스크 — 클립은 페인트 연산별 AA 중첩으로
          코너 곡률에서 밝은 바탕색이 호로 누설됨 (radius 변경 시 마스크 rx도 함께) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={
          {
            backgroundColor: `hsl(${color.hsv.h} 100% 50%)`,
            backgroundImage:
              'linear-gradient(rgba(0, 0, 0, 0), #000), linear-gradient(90deg, #fff, rgba(255, 255, 255, 0))',
            WebkitMaskBoxImage: SATURATION_CORNER_MASK,
          } as React.CSSProperties
        }
      />
      <GooeyThumb
        x={color.hsv.s / 100}
        y={1 - color.hsv.v / 100}
        size={SATURATION_CURSOR_SIZE}
        color={`rgb(${color.rgb.r} ${color.rgb.g} ${color.rgb.b})`}
      />
    </div>
  );
};

export const HueSlider = ({
  color,
  onChange,
  onChangeComplete,
  disabled = false,
  continuousInputStrategy,
}: ColorTrackProps) => {
  const session = usePointerSession(
    (x, _y, final) => {
      const next = hsvToColorObject({ ...color.hsv, h: x * 360 });
      onChange(next);
      if (final) onChangeComplete?.(next);
    },
    continuousInputStrategy,
    disabled,
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? HUE_PAGE_STEP : 1;
    let h = color.hsv.h;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        h -= step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        h += step;
        break;
      case 'PageUp':
        h += HUE_PAGE_STEP;
        break;
      case 'PageDown':
        h -= HUE_PAGE_STEP;
        break;
      case 'Home':
        h = 0;
        break;
      case 'End':
        h = 360;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = hsvToColorObject({ ...color.hsv, h });
    onChange(next);
    onChangeComplete?.(next);
  };

  return (
    <div
      {...session}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label="Hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(color.hsv.h)}
      onKeyDown={onKeyDown}
      className={`${trackClassName} ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
      style={{ height: TRACK_HEIGHT, background: HUE_TRACK_GRADIENT }}
    >
      <GooeyThumb
        x={color.hsv.h / 360}
        y={0.5}
        size={KNOB_SIZE}
        color={`hsl(${color.hsv.h} 100% 50%)`}
      />
    </div>
  );
};

export const AlphaSlider = ({
  color,
  onChange,
  onChangeComplete,
  disabled = false,
  continuousInputStrategy,
  ariaLabel = 'Alpha',
}: ColorTrackProps & {
  // 스톱 알파와 전역 배율이 나란한 형식에서 역할 구분
  ariaLabel?: string;
}) => {
  const session = usePointerSession(
    (x, _y, final) => {
      const next = hsvToColorObject({ ...color.hsv, a: x });
      onChange(next);
      if (final) onChangeComplete?.(next);
    },
    continuousInputStrategy,
    disabled,
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = (event.shiftKey ? PAGE_STEP : 1) / 100;
    let a = color.hsv.a;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        a -= step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        a += step;
        break;
      case 'PageUp':
        a += PAGE_STEP / 100;
        break;
      case 'PageDown':
        a -= PAGE_STEP / 100;
        break;
      case 'Home':
        a = 0;
        break;
      case 'End':
        a = 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = hsvToColorObject({ ...color.hsv, a });
    onChange(next);
    onChangeComplete?.(next);
  };

  const rgb = `${color.rgb.r} ${color.rgb.g} ${color.rgb.b}`;

  return (
    <div
      {...session}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(color.hsv.a * 100)}
      onKeyDown={onKeyDown}
      className={`${trackClassName} ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
      style={{
        height: TRACK_HEIGHT,
        background: `linear-gradient(to right, rgb(${rgb} / 0), rgb(${rgb} / 1)), ${CHECKER_PATTERN} top left / ${CHECKER_SIZE} ${CHECKER_SIZE} repeat`,
      }}
    >
      <GooeyThumb
        x={color.hsv.a}
        y={0.5}
        size={KNOB_SIZE}
        color={`rgb(${rgb})`}
        colorOpacity={color.hsv.a}
        checker
      />
    </div>
  );
};
