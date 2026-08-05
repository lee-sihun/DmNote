import { DEFAULT_NOTE_BORDER_RADIUS } from '@constants/overlayDefaults';
import { toRgbHexColor } from '@utils/color/colorUtils';

const MAX_NOTES = 2048;

// GPU 시각은 Float32라 절대값이 커질수록 간격이 벌어진다. 노트 길이보다 간격이
// 넓어지면 시작·종료가 같은 값으로 뭉개져 길이가 0이 되므로 epoch를 주기적으로 옮긴다.
// 최소 노트 길이는 1px / 9999px/s ≈ 0.10001ms 이고 2^19ms 구간의 간격은 0.0625ms라,
// 이 한도에서는 설정 범위 전체가 안전하다. 한도를 올리면 정밀도 테스트가 깨진다
const EPOCH_REBASE_LIMIT_MS = 524_288;
// 셰이더 sentinel(startTime 0.0 = 빈 슬롯, endTime 0.0 = 활성)과의 우연 충돌 방지
const EPOCH_ZERO_NUDGE = 1e-4;

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] =
    c < 0.04045
      ? c * 0.0773993808
      : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

const linearToSRGB = (c: number) => {
  if (c <= 0.0031308) {
    return c * 12.92;
  }
  return 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055;
};

const parseColor = (hex: string) => {
  // rgba(...)/3·8자리 hex 등 어떤 입력이든 #RRGGBB로 정규화 — NaN 방어 (이슈 #73)
  const color = toRgbHexColor(hex).slice(1);
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  return [SRGB_TO_LINEAR[r], SRGB_TO_LINEAR[g], SRGB_TO_LINEAR[b]] as const;
};

const convertLinearToSRGB = (rgb: readonly number[]) =>
  [linearToSRGB(rgb[0]), linearToSRGB(rgb[1]), linearToSRGB(rgb[2])] as const;

const extractColorStops = (
  color:
    | string
    | { type: string; top?: string; bottom?: string }
    | undefined
    | null,
  fallback = '#FFFFFF',
) => {
  if (!color) {
    const c = parseColor(fallback);
    return {
      top: c,
      bottom: [...c] as readonly number[],
    };
  }
  if (typeof color === 'string') {
    const solid = parseColor(color);
    return { top: solid, bottom: [...solid] as readonly number[] };
  }
  if (typeof color === 'object' && color.type === 'gradient') {
    return {
      top: parseColor(color.top ?? fallback),
      bottom: parseColor(color.bottom ?? fallback),
    };
  }
  const parsed = parseColor(fallback);
  return { top: parsed, bottom: [...parsed] as readonly number[] };
};

export type TrackLayoutInput = {
  trackKey: string;
  trackIndex: number;
  position: { dx: number; dy: number };
  width: number;
  height: number;
  noteColor?: string | { type: string; top?: string; bottom?: string };
  noteOpacity?: number;
  noteOpacityTop?: number;
  noteOpacityBottom?: number;
  noteGlowEnabled?: boolean;
  noteGlowSize?: number;
  noteGlowOpacity?: number;
  noteGlowOpacityTop?: number;
  noteGlowOpacityBottom?: number;
  noteGlowColor?: string | { type: string; top?: string; bottom?: string };
  borderRadius?: number;
  noteBorderWidth?: number;
  noteBorderColor?: string;
  noteBorderOpacity?: number;
  noteBorderSide?: 'all' | 'vertical' | 'horizontal';
};

type ResolvedTrackStyle = {
  opacityTop: number;
  opacityBottom: number;
  glowSize: number;
  glowOpacityTop: number;
  glowOpacityBottom: number;
  colorTop: readonly number[];
  colorBottom: readonly number[];
  glowColorTop: readonly number[];
  glowColorBottom: readonly number[];
  borderRadius: number;
  borderWidth: number;
  borderColor: readonly number[];
  borderOpacity: number;
};

type ResolvedTrackLayout = TrackLayoutInput & {
  resolved: ResolvedTrackStyle;
};

const clampPercentToUnit = (value: number) =>
  Math.min(Math.max(value / 100, 0), 1);

// 트랙의 실효 글로우 크기 — 캔버스 crop bounds 계산에서도 동일 규칙 사용
export const resolvedGlowSize = (
  layout: Pick<TrackLayoutInput, 'noteGlowEnabled' | 'noteGlowSize'>,
): number => {
  if (!(layout.noteGlowEnabled ?? false)) return 0;
  return Math.min(Math.max(layout.noteGlowSize ?? 20, 0), 50);
};

const resolveTrackLayout = (layout: TrackLayoutInput): ResolvedTrackLayout => {
  const baseOpacityPercent =
    layout.noteOpacity != null && Number.isFinite(layout.noteOpacity)
      ? layout.noteOpacity
      : 80;
  const opacityTopPercent =
    layout.noteOpacityTop != null && Number.isFinite(layout.noteOpacityTop)
      ? layout.noteOpacityTop
      : baseOpacityPercent;
  const opacityBottomPercent =
    layout.noteOpacityBottom != null &&
    Number.isFinite(layout.noteOpacityBottom)
      ? layout.noteOpacityBottom
      : baseOpacityPercent;

  const glowEnabled = layout.noteGlowEnabled ?? false;
  const glowSize = resolvedGlowSize(layout);

  const baseGlowOpacityPercent =
    layout.noteGlowOpacity != null && Number.isFinite(layout.noteGlowOpacity)
      ? layout.noteGlowOpacity
      : 70;
  const glowOpacityTopPercent =
    layout.noteGlowOpacityTop != null &&
    Number.isFinite(layout.noteGlowOpacityTop)
      ? layout.noteGlowOpacityTop
      : baseGlowOpacityPercent;
  const glowOpacityBottomPercent =
    layout.noteGlowOpacityBottom != null &&
    Number.isFinite(layout.noteGlowOpacityBottom)
      ? layout.noteGlowOpacityBottom
      : baseGlowOpacityPercent;

  const { top, bottom } = extractColorStops(layout.noteColor, '#FFFFFF');
  const glowStops = extractColorStops(
    layout.noteGlowColor ?? layout.noteColor,
    '#FFFFFF',
  );

  const rawBorderWidth = layout.noteBorderWidth ?? 0;
  const borderSide = layout.noteBorderSide ?? 'all';
  // side mode를 width에 인코딩: 0~20=all, 100~120=vertical, 200~220=horizontal
  const sideOffset =
    borderSide === 'vertical' ? 100 : borderSide === 'horizontal' ? 200 : 0;
  const borderWidth = rawBorderWidth + sideOffset;
  const borderColorParsed = parseColor(layout.noteBorderColor ?? '#FFFFFF');
  const borderColorSRGB = convertLinearToSRGB(borderColorParsed);
  const borderOpacityPercent =
    layout.noteBorderOpacity != null &&
    Number.isFinite(layout.noteBorderOpacity)
      ? layout.noteBorderOpacity
      : 100;

  return {
    ...layout,
    resolved: {
      opacityTop: clampPercentToUnit(opacityTopPercent),
      opacityBottom: clampPercentToUnit(opacityBottomPercent),
      glowSize,
      glowOpacityTop: glowEnabled
        ? clampPercentToUnit(glowOpacityTopPercent)
        : 0,
      glowOpacityBottom: glowEnabled
        ? clampPercentToUnit(glowOpacityBottomPercent)
        : 0,
      colorTop: convertLinearToSRGB(top),
      colorBottom: convertLinearToSRGB(bottom),
      glowColorTop: convertLinearToSRGB(glowStops.top),
      glowColorBottom: convertLinearToSRGB(glowStops.bottom),
      borderRadius: layout.borderRadius ?? DEFAULT_NOTE_BORDER_RADIUS,
      borderWidth,
      borderColor: borderColorSRGB,
      borderOpacity: clampPercentToUnit(borderOpacityPercent),
    },
  };
};

export type NoteBufferEventType = 'add' | 'finalize' | 'cleanup' | 'clear';

export class NoteBuffer {
  readonly noteInfo: Float32Array;
  readonly noteSize: Float32Array;
  readonly noteColorTop: Float32Array;
  readonly noteColorBottom: Float32Array;
  readonly noteRadius: Float32Array;
  readonly noteBorderOpacity: Float32Array;
  readonly trackIndex: Float32Array;
  readonly noteGlow: Float32Array;
  readonly noteGlowColorTop: Float32Array;
  readonly noteGlowColorBottom: Float32Array;
  readonly noteBorder: Float32Array;

  private readonly noteIdByIndex: (string | null)[];
  private readonly trackKeyByIndex: (string | null)[];
  private readonly indexByNoteId: Map<string, number>;
  private trackLayouts: Map<string, ResolvedTrackLayout>;
  // allocate() 시프트 후 Map이 오래된 첫 인덱스. Infinity = Map 최신 상태
  private dirtyIndexStart: number;
  // noteInfo 시각의 기준점 - GPU에는 (원시 시각 - epoch)만 전달
  private epoch: number;

  activeCount: number;
  version: number;

  constructor() {
    this.noteInfo = new Float32Array(MAX_NOTES * 3);
    this.noteSize = new Float32Array(MAX_NOTES * 2);
    this.noteColorTop = new Float32Array(MAX_NOTES * 4);
    this.noteColorBottom = new Float32Array(MAX_NOTES * 4);
    this.noteRadius = new Float32Array(MAX_NOTES);
    this.noteBorderOpacity = new Float32Array(MAX_NOTES);
    this.trackIndex = new Float32Array(MAX_NOTES);
    this.noteGlow = new Float32Array(MAX_NOTES * 3);
    this.noteGlowColorTop = new Float32Array(MAX_NOTES * 3);
    this.noteGlowColorBottom = new Float32Array(MAX_NOTES * 3);
    this.noteBorder = new Float32Array(MAX_NOTES * 4);

    this.noteIdByIndex = new Array<string | null>(MAX_NOTES).fill(null);
    this.trackKeyByIndex = new Array<string | null>(MAX_NOTES).fill(null);
    this.indexByNoteId = new Map();
    this.trackLayouts = new Map();

    this.activeCount = 0;
    this.version = 0;
    this.dirtyIndexStart = Infinity;
    this.epoch = 0;
  }

  get timeEpoch(): number {
    return this.epoch;
  }

  // 원시 시각(performance.now 기준) → GPU 저장 시각
  private toGpuTime(t: number): number {
    const v = t - this.epoch;
    return v === 0 ? EPOCH_ZERO_NUDGE : v;
  }

  // 한도 초과 시 epoch를 nowMs로 이동하고 저장된 시각을 재기준화.
  // true 반환 시 호출자가 noteInfo 전체 재업로드를 예약해야 함
  maybeRebaseEpoch(nowMs: number): boolean {
    const delta = nowMs - this.epoch;
    if (delta <= EPOCH_REBASE_LIMIT_MS) return false;
    for (let i = 0; i < this.activeCount; i += 1) {
      const infoOffset = i * 3;
      if (this.noteInfo[infoOffset] !== 0) {
        this.noteInfo[infoOffset] -= delta;
        if (this.noteInfo[infoOffset] === 0) {
          this.noteInfo[infoOffset] = -EPOCH_ZERO_NUDGE;
        }
      }
      if (this.noteInfo[infoOffset + 1] !== 0) {
        this.noteInfo[infoOffset + 1] -= delta;
        if (this.noteInfo[infoOffset + 1] === 0) {
          this.noteInfo[infoOffset + 1] = -EPOCH_ZERO_NUDGE;
        }
      }
    }
    this.epoch = nowMs;
    this.version += 1;
    return true;
  }

  // allocate() 시프트로 오염된 Map 항목을 한 번에 재구축
  private ensureIndexMapFresh(): void {
    if (this.dirtyIndexStart >= this.activeCount) return;
    for (let i = this.dirtyIndexStart; i < this.activeCount; i++) {
      const id = this.noteIdByIndex[i];
      if (id) this.indexByNoteId.set(id, i);
    }
    this.dirtyIndexStart = Infinity;
  }

  updateTrackLayouts(tracks: TrackLayoutInput[]) {
    const nextLayouts = new Map<string, ResolvedTrackLayout>();
    tracks.forEach((track) => {
      nextLayouts.set(track.trackKey, resolveTrackLayout(track));
    });
    this.trackLayouts = nextLayouts;

    // 기존 노트들의 trackIndex 업데이트 (zIndex 동기화)
    for (let i = 0; i < this.activeCount; i++) {
      const trackKey = this.trackKeyByIndex[i];
      if (trackKey) {
        const layout = nextLayouts.get(trackKey);
        if (layout) {
          this.trackIndex[i] = layout.trackIndex;
        }
      }
    }
    this.version += 1;
  }

  allocate(trackKey: string, noteId: string, startTime: number) {
    const layout = this.trackLayouts.get(trackKey);
    if (!layout) {
      return -1;
    }
    if (this.activeCount >= MAX_NOTES) {
      return -1;
    }
    // 'add' 이벤트가 전 속성 업로드를 예약하므로 여기서의 재기준화는 별도 예약 불필요
    this.maybeRebaseEpoch(startTime);
    const {
      opacityTop,
      opacityBottom,
      glowSize,
      glowOpacityTop,
      glowOpacityBottom,
      colorTop,
      colorBottom,
      glowColorTop,
      glowColorBottom,
      borderRadius,
      borderWidth,
      borderColor,
      borderOpacity,
    } = layout.resolved;
    const trackIndex = layout.trackIndex;

    let insertIndex = this.activeCount;
    for (let i = 0; i < this.activeCount; i += 1) {
      const existingTrackIndex = this.trackIndex[i];
      if (existingTrackIndex > trackIndex) {
        insertIndex = i;
        break;
      }
    }

    if (insertIndex < this.activeCount) {
      this.noteInfo.copyWithin(
        (insertIndex + 1) * 3,
        insertIndex * 3,
        this.activeCount * 3,
      );
      this.noteSize.copyWithin(
        (insertIndex + 1) * 2,
        insertIndex * 2,
        this.activeCount * 2,
      );
      this.noteColorTop.copyWithin(
        (insertIndex + 1) * 4,
        insertIndex * 4,
        this.activeCount * 4,
      );
      this.noteColorBottom.copyWithin(
        (insertIndex + 1) * 4,
        insertIndex * 4,
        this.activeCount * 4,
      );
      this.noteRadius.copyWithin(
        insertIndex + 1,
        insertIndex,
        this.activeCount,
      );
      this.noteBorderOpacity.copyWithin(
        insertIndex + 1,
        insertIndex,
        this.activeCount,
      );
      this.trackIndex.copyWithin(
        insertIndex + 1,
        insertIndex,
        this.activeCount,
      );
      this.noteGlow.copyWithin(
        (insertIndex + 1) * 3,
        insertIndex * 3,
        this.activeCount * 3,
      );
      this.noteGlowColorTop.copyWithin(
        (insertIndex + 1) * 3,
        insertIndex * 3,
        this.activeCount * 3,
      );
      this.noteGlowColorBottom.copyWithin(
        (insertIndex + 1) * 3,
        insertIndex * 3,
        this.activeCount * 3,
      );
      this.noteBorder.copyWithin(
        (insertIndex + 1) * 4,
        insertIndex * 4,
        this.activeCount * 4,
      );

      for (let i = this.activeCount; i > insertIndex; i -= 1) {
        this.noteIdByIndex[i] = this.noteIdByIndex[i - 1];
        this.trackKeyByIndex[i] = this.trackKeyByIndex[i - 1];
      }
      // insertIndex+1부터 Map 항목이 오염됨 — 다음 조회 전에 일괄 재구축
      const shiftStart = insertIndex + 1;
      if (shiftStart < this.dirtyIndexStart) {
        this.dirtyIndexStart = shiftStart;
      }
    }

    this.activeCount += 1;

    const infoOffset = insertIndex * 3;
    this.noteInfo[infoOffset] = this.toGpuTime(startTime);
    this.noteInfo[infoOffset + 1] = 0;
    this.noteInfo[infoOffset + 2] = layout.position.dx;

    const sizeOffset = insertIndex * 2;
    this.noteSize[sizeOffset] = layout.width;
    this.noteSize[sizeOffset + 1] = layout.position.dy;

    const colorOffset = insertIndex * 4;
    this.noteColorTop[colorOffset] = colorTop[0];
    this.noteColorTop[colorOffset + 1] = colorTop[1];
    this.noteColorTop[colorOffset + 2] = colorTop[2];
    this.noteColorTop[colorOffset + 3] = opacityTop;

    this.noteColorBottom[colorOffset] = colorBottom[0];
    this.noteColorBottom[colorOffset + 1] = colorBottom[1];
    this.noteColorBottom[colorOffset + 2] = colorBottom[2];
    this.noteColorBottom[colorOffset + 3] = opacityBottom;

    this.noteRadius[insertIndex] = borderRadius;
    this.noteBorderOpacity[insertIndex] = borderOpacity;
    this.trackIndex[insertIndex] = trackIndex;
    const glowOffset = insertIndex * 3;
    this.noteGlow[glowOffset] = glowSize;
    this.noteGlow[glowOffset + 1] = glowOpacityTop;
    this.noteGlow[glowOffset + 2] = glowOpacityBottom;
    const glowColorOffset = insertIndex * 3;
    this.noteGlowColorTop[glowColorOffset] = glowColorTop[0];
    this.noteGlowColorTop[glowColorOffset + 1] = glowColorTop[1];
    this.noteGlowColorTop[glowColorOffset + 2] = glowColorTop[2];
    this.noteGlowColorBottom[glowColorOffset] = glowColorBottom[0];
    this.noteGlowColorBottom[glowColorOffset + 1] = glowColorBottom[1];
    this.noteGlowColorBottom[glowColorOffset + 2] = glowColorBottom[2];

    const borderOffset = insertIndex * 4;
    this.noteBorder[borderOffset] = borderWidth;
    this.noteBorder[borderOffset + 1] = borderColor[0];
    this.noteBorder[borderOffset + 2] = borderColor[1];
    this.noteBorder[borderOffset + 3] = borderColor[2];

    this.noteIdByIndex[insertIndex] = noteId;
    this.trackKeyByIndex[insertIndex] = trackKey;
    this.indexByNoteId.set(noteId, insertIndex);
    this.version += 1;
    return insertIndex;
  }

  finalize(noteId: string, endTime: number) {
    this.ensureIndexMapFresh();
    const index = this.indexByNoteId.get(noteId);
    if (index === undefined) {
      return -1;
    }
    this.noteInfo[index * 3 + 1] = this.toGpuTime(endTime);
    this.version += 1;
    return index;
  }

  release(noteId: string) {
    this.ensureIndexMapFresh();
    const index = this.indexByNoteId.get(noteId);
    if (index === undefined) {
      return -1;
    }
    const last = this.activeCount - 1;
    if (last < 0) {
      return -1;
    }

    if (index < last) {
      // 그리기 순서 유지를 위해 이후 슬롯을 앞으로 이동
      const nextIndex = index + 1;
      const totalInfo = (last + 1) * 3;
      const totalSize = (last + 1) * 2;
      const totalColor = (last + 1) * 4;

      this.noteInfo.copyWithin(index * 3, nextIndex * 3, totalInfo);
      this.noteSize.copyWithin(index * 2, nextIndex * 2, totalSize);
      this.noteColorTop.copyWithin(index * 4, nextIndex * 4, totalColor);
      this.noteColorBottom.copyWithin(index * 4, nextIndex * 4, totalColor);
      this.noteRadius.copyWithin(index, nextIndex, last + 1);
      this.noteBorderOpacity.copyWithin(index, nextIndex, last + 1);
      this.trackIndex.copyWithin(index, nextIndex, last + 1);
      this.noteGlow.copyWithin(index * 3, nextIndex * 3, (last + 1) * 3);
      this.noteGlowColorTop.copyWithin(
        index * 3,
        nextIndex * 3,
        (last + 1) * 3,
      );
      this.noteGlowColorBottom.copyWithin(
        index * 3,
        nextIndex * 3,
        (last + 1) * 3,
      );
      this.noteBorder.copyWithin(index * 4, nextIndex * 4, (last + 1) * 4);

      for (let i = index; i < last; i += 1) {
        const movedId = this.noteIdByIndex[i + 1];
        const movedTrackKey = this.trackKeyByIndex[i + 1];
        this.noteIdByIndex[i] = movedId;
        this.trackKeyByIndex[i] = movedTrackKey;
        if (movedId) {
          this.indexByNoteId.set(movedId, i);
        }
      }
    }

    this.noteIdByIndex[last] = null;
    this.trackKeyByIndex[last] = null;
    this.indexByNoteId.delete(noteId);
    this.activeCount = Math.max(last, 0);

    const infoOffset = last * 3;
    this.noteInfo.fill(0, infoOffset, infoOffset + 3);

    const sizeOffset = last * 2;
    this.noteSize.fill(0, sizeOffset, sizeOffset + 2);

    const colorOffset = last * 4;
    this.noteColorTop.fill(0, colorOffset, colorOffset + 4);
    this.noteColorBottom.fill(0, colorOffset, colorOffset + 4);
    this.noteRadius[last] = 0;
    this.noteBorderOpacity[last] = 0;
    this.trackIndex[last] = 0;
    const glowOffset = last * 3;
    this.noteGlow.fill(0, glowOffset, glowOffset + 3);
    const glowColorOffset = last * 3;
    this.noteGlowColorTop.fill(0, glowColorOffset, glowColorOffset + 3);
    this.noteGlowColorBottom.fill(0, glowColorOffset, glowColorOffset + 3);
    const borderClearOffset = last * 4;
    this.noteBorder.fill(0, borderClearOffset, borderClearOffset + 4);

    this.version += 1;
    return index;
  }

  releaseBatch(noteIds: readonly string[]) {
    this.ensureIndexMapFresh();
    if (this.activeCount === 0 || noteIds.length === 0) {
      return 0;
    }

    const toRemove = new Set<string>();
    for (const noteId of noteIds) {
      if (this.indexByNoteId.has(noteId)) {
        toRemove.add(noteId);
      }
    }
    if (toRemove.size === 0) {
      return 0;
    }

    const previousCount = this.activeCount;
    let writeIndex = 0;

    for (let readIndex = 0; readIndex < previousCount; readIndex += 1) {
      const currentNoteId = this.noteIdByIndex[readIndex];
      if (!currentNoteId) {
        continue;
      }

      if (toRemove.has(currentNoteId)) {
        this.indexByNoteId.delete(currentNoteId);
        continue;
      }

      const currentTrackKey = this.trackKeyByIndex[readIndex];
      if (writeIndex !== readIndex) {
        this.copySlot(readIndex, writeIndex);
      }
      this.noteIdByIndex[writeIndex] = currentNoteId;
      this.trackKeyByIndex[writeIndex] = currentTrackKey;
      this.indexByNoteId.set(currentNoteId, writeIndex);
      writeIndex += 1;
    }

    for (let i = writeIndex; i < previousCount; i += 1) {
      this.noteIdByIndex[i] = null;
      this.trackKeyByIndex[i] = null;
    }

    this.noteInfo.fill(0, writeIndex * 3, previousCount * 3);
    this.noteSize.fill(0, writeIndex * 2, previousCount * 2);
    this.noteColorTop.fill(0, writeIndex * 4, previousCount * 4);
    this.noteColorBottom.fill(0, writeIndex * 4, previousCount * 4);
    this.noteRadius.fill(0, writeIndex, previousCount);
    this.noteBorderOpacity.fill(0, writeIndex, previousCount);
    this.trackIndex.fill(0, writeIndex, previousCount);
    this.noteGlow.fill(0, writeIndex * 3, previousCount * 3);
    this.noteGlowColorTop.fill(0, writeIndex * 3, previousCount * 3);
    this.noteGlowColorBottom.fill(0, writeIndex * 3, previousCount * 3);
    this.noteBorder.fill(0, writeIndex * 4, previousCount * 4);

    this.activeCount = writeIndex;
    this.version += 1;
    return previousCount - writeIndex;
  }

  clear() {
    this.activeCount = 0;
    this.version += 1;
    this.dirtyIndexStart = Infinity;
    this.indexByNoteId.clear();
    this.noteIdByIndex.fill(null);
    this.trackKeyByIndex.fill(null);
    this.noteInfo.fill(0);
    this.noteSize.fill(0);
    this.noteColorTop.fill(0);
    this.noteColorBottom.fill(0);
    this.noteRadius.fill(0);
    this.noteBorderOpacity.fill(0);
    this.trackIndex.fill(0);
    this.noteGlow.fill(0);
    this.noteGlowColorTop.fill(0);
    this.noteGlowColorBottom.fill(0);
    this.noteBorder.fill(0);
  }

  private copySlot(from: number, to: number) {
    const fromInfo = from * 3;
    const toInfo = to * 3;
    this.noteInfo[toInfo] = this.noteInfo[fromInfo];
    this.noteInfo[toInfo + 1] = this.noteInfo[fromInfo + 1];
    this.noteInfo[toInfo + 2] = this.noteInfo[fromInfo + 2];

    const fromSize = from * 2;
    const toSize = to * 2;
    this.noteSize[toSize] = this.noteSize[fromSize];
    this.noteSize[toSize + 1] = this.noteSize[fromSize + 1];

    const fromColor = from * 4;
    const toColor = to * 4;
    this.noteColorTop[toColor] = this.noteColorTop[fromColor];
    this.noteColorTop[toColor + 1] = this.noteColorTop[fromColor + 1];
    this.noteColorTop[toColor + 2] = this.noteColorTop[fromColor + 2];
    this.noteColorTop[toColor + 3] = this.noteColorTop[fromColor + 3];

    this.noteColorBottom[toColor] = this.noteColorBottom[fromColor];
    this.noteColorBottom[toColor + 1] = this.noteColorBottom[fromColor + 1];
    this.noteColorBottom[toColor + 2] = this.noteColorBottom[fromColor + 2];
    this.noteColorBottom[toColor + 3] = this.noteColorBottom[fromColor + 3];

    this.noteRadius[to] = this.noteRadius[from];
    this.noteBorderOpacity[to] = this.noteBorderOpacity[from];
    this.trackIndex[to] = this.trackIndex[from];

    const fromGlow = from * 3;
    const toGlow = to * 3;
    this.noteGlow[toGlow] = this.noteGlow[fromGlow];
    this.noteGlow[toGlow + 1] = this.noteGlow[fromGlow + 1];
    this.noteGlow[toGlow + 2] = this.noteGlow[fromGlow + 2];
    const fromGlowColor = from * 3;
    const toGlowColor = to * 3;
    this.noteGlowColorTop[toGlowColor] = this.noteGlowColorTop[fromGlowColor];
    this.noteGlowColorTop[toGlowColor + 1] =
      this.noteGlowColorTop[fromGlowColor + 1];
    this.noteGlowColorTop[toGlowColor + 2] =
      this.noteGlowColorTop[fromGlowColor + 2];
    this.noteGlowColorBottom[toGlowColor] =
      this.noteGlowColorBottom[fromGlowColor];
    this.noteGlowColorBottom[toGlowColor + 1] =
      this.noteGlowColorBottom[fromGlowColor + 1];
    this.noteGlowColorBottom[toGlowColor + 2] =
      this.noteGlowColorBottom[fromGlowColor + 2];

    const fromBorder = from * 4;
    const toBorder = to * 4;
    this.noteBorder[toBorder] = this.noteBorder[fromBorder];
    this.noteBorder[toBorder + 1] = this.noteBorder[fromBorder + 1];
    this.noteBorder[toBorder + 2] = this.noteBorder[fromBorder + 2];
    this.noteBorder[toBorder + 3] = this.noteBorder[fromBorder + 3];
  }
}

export const createNoteBuffer = () => new NoteBuffer();
export { MAX_NOTES };
