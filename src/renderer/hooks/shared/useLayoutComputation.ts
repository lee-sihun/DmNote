import {
  DEFAULT_NOTE_BORDER_RADIUS,
  DEFAULT_NOTE_SETTINGS,
} from '@constants/overlayDefaults';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { NoteSettings } from '@src/types/settings/noteSettings';
// 레이아웃이 읽을 수 있는 플러그인 필드는 투영 타입으로 제한 —
// 필드 추가 시 selectPluginLayoutElements·pluginLayoutElementsEqual 동반 수정 필요
import type { PluginLayoutElement } from '@utils/plugin/pluginLayoutElements';

interface LayoutInput {
  // canonical 슬롯 식별자 배열 (slotCanonical 결과, 원본 KeySlot 아님)
  currentKeys: string[];
  currentPositions: CanonicalEditorDocumentV1['keyPositions'][string];
  currentStatPositions: CanonicalEditorDocumentV1['statPositions'][string];
  currentGraphPositions: CanonicalEditorDocumentV1['graphPositions'][string];
  currentKnobPositions: CanonicalEditorDocumentV1['knobPositions'][string];
  trackHeight: number;
  noteSettings: NoteSettings;
  selectedKeyType?: string;
  pluginElements?: PluginLayoutElement[];
  overlayPadding?: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// 오프셋 적용 결과 캐시. 키가 원본 위치 객체라 원본이 사라지면 함께 회수된다
const offsetCache = new WeakMap<
  object,
  { x: number; y: number; result: unknown }
>();

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

      // 노트 오프셋에 의한 트랙 영역 확장 반영
      const userOffsetX = pos.noteOffsetX ?? 0;
      const userOffsetY = pos.noteOffsetY ?? 0;
      if (userOffsetX !== 0) {
        const keyWidth = pos.width;
        const desiredNoteWidth =
          typeof pos.noteWidth === 'number' && Number.isFinite(pos.noteWidth)
            ? Math.max(1, pos.noteWidth)
            : keyWidth;
        const noteAlign = pos.noteAlignment ?? 'center';
        const alignOff =
          noteAlign === 'left'
            ? 0
            : noteAlign === 'right'
            ? keyWidth - desiredNoteWidth
            : (keyWidth - desiredNoteWidth) / 2;
        const noteLeft = pos.dx + alignOff + userOffsetX;
        const noteRight = noteLeft + desiredNoteWidth;
        xs.push(noteLeft);
        widths.push(noteRight);
      }
      if (userOffsetY > 0) {
        heights.push(pos.dy + pos.height + userOffsetY);
      } else if (userOffsetY < 0) {
        ys.push(pos.dy + userOffsetY);
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

  // 오프셋 계산
  const topOffset = trackHeight + PADDING;
  const offsetX = bounds ? PADDING - bounds.minX : 0;
  const offsetY = bounds ? topOffset - bounds.minY : 0;

  // 원본 객체와 오프셋이 그대로면 이전 결과를 재사용한다.
  // 매번 새 객체를 만들면 아래쪽 Key의 React.memo가 항상 깨져,
  // 프리뷰로 키 하나만 움직여도 오버레이의 모든 키가 다시 그려진다
  const applyOffset = <T extends { dx: number; dy: number }>(
    items: T[],
  ): T[] => {
    if (!bounds || !items.length) return items;
    return items.map((item) => {
      const cached = offsetCache.get(item);
      if (cached && cached.x === offsetX && cached.y === offsetY) {
        return cached.result as T;
      }
      const shifted = {
        ...item,
        dx: item.dx + offsetX,
        dy: item.dy + offsetY,
      };
      offsetCache.set(item, { x: offsetX, y: offsetY, result: shifted });
      return shifted;
    });
  };

  const displayPositions = applyOffset(currentPositions);
  const displayStatPositions = applyOffset(currentStatPositions);
  const displayGraphPositions = applyOffset(currentGraphPositions);
  const displayKnobPositions = applyOffset(currentKnobPositions);

  const positionOffset = bounds ? { x: offsetX, y: offsetY } : { x: 0, y: 0 };

  const topMostY = bounds ? topOffset : 0;

  // WebGL 트랙 계산
  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index];
      if (!originalPosition) return null;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      const useAutoCorrection = position.noteAutoYCorrection !== false;
      const trackStartY = useAutoCorrection ? topMostY : position.dy;
      const keyWidth = position.width;
      const desiredNoteWidth =
        typeof position.noteWidth === 'number' &&
        Number.isFinite(position.noteWidth)
          ? Math.max(1, position.noteWidth)
          : keyWidth;
      const noteAlign = position.noteAlignment ?? 'center';
      const noteAlignOffsetX =
        noteAlign === 'left'
          ? 0
          : noteAlign === 'right'
          ? keyWidth - desiredNoteWidth
          : (keyWidth - desiredNoteWidth) / 2;
      const userOffsetX = position.noteOffsetX ?? 0;
      const userOffsetY = position.noteOffsetY ?? 0;

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        position: {
          ...position,
          dx: position.dx + noteAlignOffsetX + userOffsetX,
          dy: trackStartY + userOffsetY,
        },
        width: desiredNoteWidth,
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
    // 창 높이·배경 박스가 같은 값을 쓰도록 노출 (창 == 콘텐츠 박스 불변식)
    topOffset,
    topMostY,
    webglTracks,
  };
}
