import {
  DEFAULT_NOTE_BORDER_RADIUS,
  DEFAULT_NOTE_SETTINGS,
} from '@constants/overlayDefaults';
import { FALLBACK_POSITION } from '@components/shared/OverlayScene';
import type { KeyPosition } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { NoteSettings } from '@src/types/settings/noteSettings';

const PADDING = 30;

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
  currentKeys: string[];
  currentPositions: KeyPosition[];
  currentStatPositions: StatItemPosition[];
  currentGraphPositions: GraphItemPosition[];
  trackHeight: number;
  noteSettings: NoteSettings;
  selectedKeyType?: string;
  pluginElements?: PluginElement[];
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
    trackHeight,
    noteSettings,
    selectedKeyType,
    pluginElements,
  } = input;

  // bounds 계산
  const bounds: Bounds | null = (() => {
    const hasContent =
      currentPositions.length > 0 ||
      currentStatPositions.length > 0 ||
      currentGraphPositions.length > 0 ||
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

  const positionOffset = bounds ? { x: offsetX, y: offsetY } : { x: 0, y: 0 };

  const topMostY = bounds ? topOffset : 0;

  // WebGL 트랙 계산
  const webglTracks = currentKeys
    .map((key, index) => {
      const originalPosition = currentPositions[index] ?? FALLBACK_POSITION;
      if (originalPosition.hidden) return null;
      const position = displayPositions[index] ?? originalPosition;
      const useAutoCorrection = position.noteAutoYCorrection !== false;
      const trackStartY = useAutoCorrection ? topMostY : position.dy;
      const keyWidth = position.width;
      const desiredNoteWidth =
        typeof position.noteWidth === 'number' &&
        Number.isFinite(position.noteWidth)
          ? Math.max(1, Math.round(position.noteWidth))
          : keyWidth;
      const noteOffsetX = (keyWidth - desiredNoteWidth) / 2;

      return {
        trackKey: key,
        trackIndex: position.zIndex ?? index,
        position: {
          ...position,
          dx: position.dx + noteOffsetX,
          dy: trackStartY,
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
      };
    })
    .filter(Boolean);

  return {
    bounds,
    displayPositions,
    displayStatPositions,
    displayGraphPositions,
    positionOffset,
    topMostY,
    webglTracks,
  };
}
