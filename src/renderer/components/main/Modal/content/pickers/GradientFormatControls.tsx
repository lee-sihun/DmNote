import React, { useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import ListPopup from '@components/main/Modal/ListPopup';
import { usePointerSession } from './colorPickerPrimitives';
import { CHECKER_PATTERN } from './ColorSwatch';
import {
  gradientToCss,
  toCanonicalGradient,
  GRADIENT_STOPS_MIN,
  GRADIENT_STOPS_MAX,
  type GradientSpec,
} from '@src/types/color';

/**
 * 형식 셀렉트 바(footerSlot, 팔레트 아래) + 전폭 스톱 바(headerSlot).
 * 셀렉트 바는 공용 ListPopup을 쓰고 메뉴가 트리거 폭에 정렬된다.
 * 스톱은 클릭=선택, 드래그=이동(임계값), 우클릭=삭제, 빈 트랙 클릭=추가
 */

export type ColorFormat = 'solid' | 'gradient';

// 클릭이 드래그로 승격되는 이동 임계값(px)과 스톱 그랩 판정 반경(px)
const DRAG_THRESHOLD_PX = 3;
const STOP_GRAB_RADIUS_PX = 11;

interface FormatSelectBarProps {
  format: ColorFormat;
  onFormatChange: (format: ColorFormat) => void;
}

export const FormatSelectBar = ({
  format,
  onFormatChange,
}: FormatSelectBarProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  // 렌더 중 ref를 읽으면 첫 렌더에 null이라 여는 시점에 실측해 둔다
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const labels: Record<ColorFormat, string> = {
    solid: t('colorPicker.solid'),
    gradient: t('colorPicker.gradient'),
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setTriggerWidth(triggerRef.current?.offsetWidth);
          setOpen((previous) => !previous);
        }}
        className={`w-full flex items-center gap-[8px] h-[23px] px-[8px] bg-fill hover:bg-fill-hover rounded-md text-fg text-body transition-colors duration-fast ${
          open ? 'shadow-focus-ring' : ''
        }`}
      >
        <span className="truncate">{labels[format]}</span>
        {/* viewBox 14를 8px로 렌더 - 스트로크 2.1이 화면상 1.2 */}
        <svg
          width="8"
          height="5"
          viewBox="0 0 14 8"
          fill="none"
          className={`ml-auto shrink-0 text-fg-muted transition-transform duration-base ease-out-expo ${
            open ? 'rotate-180' : 'rotate-0'
          }`}
        >
          <path
            d="M1 1L7 7L13 1"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {/* 아래 공간이 부족하면 flip이 위로 돌려준다 - 높이를 추정할 필요가 없다 */}
      <ListPopup
        open={open}
        ariaLabel={labels[format]}
        referenceRef={triggerRef as React.RefObject<HTMLElement>}
        placement="bottom-start"
        minWidth={triggerWidth}
        offset={4}
        className="z-[var(--z-chrome-submenu)]"
        portalToBody
        onClose={() => setOpen(false)}
        items={(['solid', 'gradient'] as ColorFormat[]).map((f) => ({
          id: f,
          label: labels[f],
          checked: format === f,
        }))}
        onSelect={(id) => {
          setOpen(false);
          onFormatChange(id as ColorFormat);
        }}
      />
    </>
  );
};

interface GradientStopEditorProps {
  spec: GradientSpec;
  selectedIndex: number;
  onSelectStop: (index: number) => void;
  onSpecChange: (spec: GradientSpec) => void;
  onSpecChangeComplete: (spec: GradientSpec) => void;
}

interface DragState {
  index: number;
  startX: number;
  thresholdRatio: number;
  moved: boolean;
}

export const GradientStopEditor = ({
  spec,
  selectedIndex,
  onSelectStop,
  onSpecChange,
  onSpecChangeComplete,
}: GradientStopEditorProps) => {
  const dragRef = useRef<DragState | null>(null);

  // 스톱 드래그 — 임계값 전에는 선택만(클릭 오조작 방지), 이동 중에는
  // 정렬하지 않고 인덱스를 안정 유지, 종료 시 canonical + 선택 재매핑
  const session = usePointerSession((x, _y, final) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(x - drag.startX) < drag.thresholdRatio) {
        if (final) dragRef.current = null;
        return;
      }
      drag.moved = true;
    }
    const stops = spec.stops.map((s, i) =>
      i === drag.index ? { ...s, pos: x } : s,
    );
    if (final) {
      dragRef.current = null;
      const next = toCanonicalGradient({ ...spec, stops });
      // canonical과 동일한 안정 정렬을 원본 인덱스 태그로 재현해
      // pos·color가 겹치는 스톱에서도 드래그한 스톱을 정확히 추적
      const sortedIndexes = stops
        .map((s, i) => ({ i, pos: Math.min(1, Math.max(0, s.pos)) }))
        .sort((a, b) => a.pos - b.pos)
        .slice(0, GRADIENT_STOPS_MAX);
      const newIndex = sortedIndexes.findIndex((s) => s.i === drag.index);
      if (newIndex >= 0) onSelectStop(newIndex);
      onSpecChangeComplete(next);
    } else {
      onSpecChange({ ...spec, stops });
    }
  });

  const beginStopDrag = (
    index: number,
    e: React.PointerEvent<HTMLDivElement>,
    barWidth: number,
  ) => {
    dragRef.current = {
      index,
      startX: Math.min(
        1,
        Math.max(
          0,
          (e.clientX - e.currentTarget.getBoundingClientRect().left) / barWidth,
        ),
      ),
      thresholdRatio: DRAG_THRESHOLD_PX / barWidth,
      moved: false,
    };
    onSelectStop(index);
    session.onPointerDown(e);
  };

  const handleBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const px = e.clientX - rect.left;

    // 스톱 히트 영역(버튼) 또는 그랩 반경 내면 해당 스톱 잡기
    const stopEl = (e.target as HTMLElement).closest('[data-stop-index]');
    if (stopEl) {
      const idx = Number(stopEl.getAttribute('data-stop-index'));
      if (Number.isInteger(idx) && idx >= 0) beginStopDrag(idx, e, rect.width);
      return;
    }
    let nearIndex = -1;
    let nearDistance = STOP_GRAB_RADIUS_PX;
    spec.stops.forEach((stop, i) => {
      const distance = Math.abs(stop.pos * rect.width - px);
      if (distance < nearDistance) {
        nearDistance = distance;
        nearIndex = i;
      }
    });
    if (nearIndex >= 0) {
      beginStopDrag(nearIndex, e, rect.width);
      return;
    }

    // 빈 트랙 클릭 → 해당 위치에 스톱 추가 (색은 선택 스톱 기준)
    if (spec.stops.length >= GRADIENT_STOPS_MAX) return;
    const pos = Math.min(1, Math.max(0, px / rect.width));
    const color =
      spec.stops[selectedIndex]?.color ?? spec.stops[0]?.color ?? '#ffffff';
    const next = toCanonicalGradient({
      ...spec,
      stops: [...spec.stops, { color, pos }],
    });
    const newIndex = next.stops.findIndex(
      (s) => s.pos === pos && s.color === color,
    );
    onSelectStop(newIndex >= 0 ? newIndex : next.stops.length - 1);
    onSpecChangeComplete(next);
  };

  // 우클릭 삭제 — 최소 2개 유지
  const handleStopContextMenu = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (spec.stops.length <= GRADIENT_STOPS_MIN) return;
    const stops = spec.stops.filter((_, i) => i !== index);
    const nextSelected =
      selectedIndex > index
        ? selectedIndex - 1
        : Math.min(selectedIndex, stops.length - 1);
    onSelectStop(Math.max(0, nextSelected));
    onSpecChangeComplete(toCanonicalGradient({ ...spec, stops }));
  };

  // 각도는 그리드 온캔버스 핸들로만 조절 — 폼 입력 없음
  return (
    <div
      className="relative h-[23px] rounded-md shadow-[inset_0_0_0_1px_var(--ui-line)] cursor-default touch-none select-none"
      style={{
        background: `${gradientToCss({
          ...spec,
          angle: 90,
        })}, ${CHECKER_PATTERN} center / var(--ui-checker-size-sm) var(--ui-checker-size-sm) repeat`,
      }}
      onPointerDown={handleBarPointerDown}
      onPointerMove={session.onPointerMove}
      onPointerUp={session.onPointerUp}
      onPointerCancel={session.onPointerCancel}
      onLostPointerCapture={session.onLostPointerCapture}
    >
      {spec.stops.map((stop, i) => (
        <button
          key={`${i}-${stop.pos}`}
          type="button"
          data-stop-index={i}
          aria-label={`stop ${i + 1}`}
          onContextMenu={(e) => handleStopContextMenu(i, e)}
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-[22px] h-[23px] flex items-center justify-center cursor-default"
          style={{ left: `${stop.pos * 100}%` }}
        >
          <i
            className={`block w-[14px] h-[14px] rounded-full border-[2px] border-handle ${
              i === selectedIndex ? 'shadow-focus-ring' : 'shadow-handle'
            }`}
            style={{
              // 반투명 색은 격자 위 합성으로 표시 — 트랙 그라데이션 비침 방지
              background: `linear-gradient(${stop.color}, ${stop.color}), ${CHECKER_PATTERN} center / var(--ui-checker-size-sm) var(--ui-checker-size-sm) repeat`,
            }}
          />
        </button>
      ))}
    </div>
  );
};
