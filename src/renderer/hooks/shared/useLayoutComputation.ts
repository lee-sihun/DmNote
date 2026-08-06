import {
  DEFAULT_NOTE_BORDER_RADIUS,
  DEFAULT_NOTE_SETTINGS,
} from '@constants/overlayDefaults';
import { FALLBACK_POSITION } from '@components/shared/OverlayScene';
import {
  computeTrackGeometry,
  isVerticalDirection,
  resolveEffectiveDirection,
} from '@utils/layout/trackGeometry';
import type { NoteDirection } from '@src/types/settings/noteSettings';
import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KnobItemPosition } from '@src/types/key/knobs';
import type { NoteSettings } from '@src/types/settings/noteSettings';

interface PluginElement {
  hidden?: boolean;
  tabId?: string;
  position: { x: number; y: number };
  anchor?: {
    keyCode?: string;
    offset?: { x?: number; y?: number };
  };
  measuredSize?: { width?: number; height?: number };
  estimatedSize?: { width?: number; height?: number };
}

interface LayoutInput {
  // canonical 슬롯 식별자 배열 (slotCanonical 결과, 원본 KeySlot 아님)
  currentKeys: string[];
  currentPositions: KeyPosition[];
  currentStatPositions: StatItemPosition[];
  currentGraphPositions: GraphItemPosition[];
  currentKnobPositions: KnobItemPosition[];
  trackHeight: number;
  noteSettings: NoteSettings;
  selectedKeyType?: string;
  pluginElements?: PluginElement[];
  overlayPadding?: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function computeLayout(input: LayoutInput) {
  const {
    currentKeys,
    currentPositions,
    currentStatPositions,
    currentGraphPositions,
    currentKnobPositions,
    trackHeight,
    noteSettings,
    selectedKeyType,
    pluginElements,
    overlayPadding: PADDING = 30,
  } = input;

  const globalDirection: NoteDirection = noteSettings?.direction ?? 'up';

  // 표시 트랙의 유효 방향 집합 → 방향별 트랙 밴드 여백
  // 표시 키가 하나도 없으면 기존 동작(위쪽 예약)으로 폴백
  const visibleDirections = new Set<NoteDirection>();
  currentPositions.forEach((pos) => {
    if (pos.hidden) return;
    visibleDirections.add(
      resolveEffectiveDirection(pos.noteDirection, globalDirection),
    );
  });
  if (visibleDirections.size === 0) {
    visibleDirections.add('up');
  }
  const margins = {
    top: visibleDirections.has('up') ? trackHeight : 0,
    bottom: visibleDirections.has('down') ? trackHeight : 0,
    left: visibleDirections.has('left') ? trackHeight : 0,
    right: visibleDirections.has('right') ? trackHeight : 0,
  };

  // bounds 계산
  const bounds: Bounds | null = (() => {
    const hasContent =
      currentPositions.length > 0 ||
      currentStatPositions.length > 0 ||
      currentGraphPositions.length > 0 ||
      currentKnobPositions.length > 0 ||
      (pluginElements && pluginElements.length > 0);
    if (!hasContent) return null;

    const xs: number[] = [];
    const ys: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];

    currentPositions.forEach((pos) => {
      if (pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + pos.width);
      heights.push(pos.dy + pos.height);

      // 노트 오프셋에 의한 트랙 영역 확장 반영 (교차축 돌출 + 히트라인 이동)
      // 트리거 조건은 기존과 동일: 오프셋이 있을 때만 확장
      const userOffsetX = pos.noteOffsetX ?? 0;
      const userOffsetY = pos.noteOffsetY ?? 0;
      const direction = resolveEffectiveDirection(
        pos.noteDirection,
        globalDirection,
      );
      const vertical = isVerticalDirection(direction);
      const crossOffset = vertical ? userOffsetX : userOffsetY;
      const flowOffset = vertical ? userOffsetY : userOffsetX;
      if (crossOffset !== 0) {
        const geometry = computeTrackGeometry({
          keyX: pos.dx,
          keyY: pos.dy,
          keyWidth: pos.width,
          keyHeight: pos.height,
          direction,
          trackHeight,
          noteWidth: pos.noteWidth,
          noteAlignment: pos.noteAlignment,
          noteOffsetX: pos.noteOffsetX,
          noteOffsetY: pos.noteOffsetY,
        });
        if (vertical) {
          xs.push(geometry.crossStart);
          widths.push(geometry.crossStart + geometry.crossSize);
        } else {
          ys.push(geometry.crossStart);
          heights.push(geometry.crossStart + geometry.crossSize);
        }
      }
      if (flowOffset !== 0) {
        if (vertical) {
          if (userOffsetY > 0) {
            heights.push(pos.dy + pos.height + userOffsetY);
          } else {
            ys.push(pos.dy + userOffsetY);
          }
        } else if (userOffsetX > 0) {
          widths.push(pos.dx + pos.width + userOffsetX);
        } else {
          xs.push(pos.dx + userOffsetX);
        }
      }
    });

    currentStatPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 60));
      heights.push(pos.dy + (pos.height ?? 60));
    });

    currentGraphPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 200));
      heights.push(pos.dy + (pos.height ?? 100));
    });

    currentKnobPositions.forEach((pos) => {
      if (!pos || pos.hidden) return;
      xs.push(pos.dx);
      ys.push(pos.dy);
      widths.push(pos.dx + (pos.width ?? 80));
      heights.push(pos.dy + (pos.height ?? 80));
    });

    // 플러그인 요소 위치 (앵커 기반 계산 포함)
    if (pluginElements && selectedKeyType) {
      pluginElements
        .filter(
          (el) => !el.hidden && (!el.tabId || el.tabId === selectedKeyType),
        )
        .forEach((element) => {
          let x = element.position.x;
          let y = element.position.y;

          if (element.anchor?.keyCode) {
            const keyIndex = currentKeys.findIndex(
              (key) => key === element.anchor?.keyCode,
            );
            if (keyIndex >= 0 && currentPositions[keyIndex]) {
              const keyPosition = currentPositions[keyIndex];
              const offsetX = element.anchor.offset?.x ?? 0;
              const offsetY = element.anchor.offset?.y ?? 0;
              x = keyPosition.dx + offsetX;
              y = keyPosition.dy + offsetY;
            }
          }

          const width =
            element.measuredSize?.width ?? element.estimatedSize?.width ?? 200;
          const height =
            element.measuredSize?.height ??
            element.estimatedSize?.height ??
            150;

          xs.push(x);
          ys.push(y);
          widths.push(x + width);
          heights.push(y + height);
        });
    }

    if (xs.length === 0) return null;

    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...widths),
      maxY: Math.max(...heights),
    };
  })();

  // 오프셋 계산: 방향별 트랙 밴드가 있는 변에만 여백 확보
  const offsetX = bounds ? PADDING + margins.left - bounds.minX : 0;
  const offsetY = bounds ? PADDING + margins.top - bounds.minY : 0;

  const applyOffset = <T extends { dx: number; dy: number }>(
    items: T[],
  ): T[] => {
    if (!bounds || !items.length) return items;
    return items.map((item) => ({
      ...item,
      dx: item.dx + offsetX,
      dy: item.dy + offsetY,
    }));
  };

  const displayPositions = applyOffset(currentPositions);
  const displayStatPositions = applyOffset(currentStatPositions);
  const displayGraphPositions = applyOffset(currentGraphPositions);
  const displayKnobPositions = applyOffset(currentKnobPositions);

  const positionOffset = bounds ? { x: offsetX, y: offsetY } : { x: 0, y: 0 };

  // 방향 그룹별 공통 히트라인 (표시 좌표 기준, autoCorrection용)
  const contentWidth = bounds ? bounds.maxX - bounds.minX : 0;
  const contentHeight = bounds ? bounds.maxY - bounds.minY : 0;
  const baselines: Record<NoteDirection, number> = {
    up: bounds ? PADDING + margins.top : 0,
    down: bounds ? PADDING + margins.top + contentHeight : 0,
    left: bounds ? PADDING + margins.left : 0,
    right: bounds ? PADDING + margins.left + contentWidth : 0,
  };
  const topMostY = baselines.up;

  // WebGL 트랙 계산
  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index] ?? FALLBACK_POSITION;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      const useAutoCorrection = position.noteAutoYCorrection !== false;
      // 방향 해석 지점 (계약 §2): 키별 오버라이드 ?? 병합(전역+탭) 설정
      const direction = resolveEffectiveDirection(
        position.noteDirection,
        globalDirection,
      );
      const geometry = computeTrackGeometry({
        keyX: position.dx,
        keyY: position.dy,
        keyWidth: position.width,
        keyHeight: position.height,
        direction,
        trackHeight,
        noteWidth: position.noteWidth,
        noteAlignment: position.noteAlignment,
        noteOffsetX: position.noteOffsetX,
        noteOffsetY: position.noteOffsetY,
        hitline: useAutoCorrection ? baselines[direction] : undefined,
      });

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        direction,
        position: {
          ...position,
          dx: geometry.origin.x,
          dy: geometry.origin.y,
        },
        width: geometry.crossSize,
        height: trackHeight,
        noteColor: position.noteColor,
        noteOpacity: position.noteOpacity,
        noteOpacityTop: position.noteOpacityTop ?? position.noteOpacity,
        noteOpacityBottom: position.noteOpacityBottom ?? position.noteOpacity,
        noteGlowEnabled: position.noteGlowEnabled ?? false,
        noteGlowSize: position.noteGlowSize ?? 20,
        noteGlowOpacity: position.noteGlowOpacity ?? 70,
        noteGlowOpacityTop:
          position.noteGlowOpacityTop ?? position.noteGlowOpacity ?? 70,
        noteGlowOpacityBottom:
          position.noteGlowOpacityBottom ?? position.noteGlowOpacity ?? 70,
        noteGlowColor: position.noteGlowColor ?? position.noteColor,
        flowSpeed: noteSettings?.speed ?? DEFAULT_NOTE_SETTINGS.speed,
        borderRadius: position.noteBorderRadius ?? DEFAULT_NOTE_BORDER_RADIUS,
        noteBorderWidth: position.noteBorderWidth ?? 0,
        noteBorderColor: position.noteBorderColor,
        noteBorderOpacity: position.noteBorderOpacity ?? 100,
        noteBorderSide: position.noteBorderSide ?? 'all',
      };
    })
    .filter(Boolean);

  return {
    bounds,
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    displayKnobPositions,
    positionOffset,
    topMostY,
    margins,
    webglTracks,
  };
}
