import { toCanonicalCssRgba } from '@utils/color/colorUtils';
import {
  hexRepresentative,
  toStrictStopColor,
  type GradientSpec,
} from '@src/types/color';

export const DEFAULT_NOTE_COLOR = '#FFFFFF';

export const toNoteStopColor = (color: string): string | null =>
  toStrictStopColor(color) ?? toCanonicalCssRgba(color);

export const toNoteHexColor = (color: string): string => {
  const strict = toNoteStopColor(color);
  return strict
    ? hexRepresentative(strict) ?? DEFAULT_NOTE_COLOR
    : DEFAULT_NOTE_COLOR;
};

// 팔레트는 표면 공용이라 §2A 밖 스톱이 들어올 수 있다 - 가능한 색은
// compact rgba로 강제하고, 변환 불가면 실패 예정 커밋을 만들지 않는다
export const coerceStrictStops = (
  rawStops: GradientSpec['stops'],
  logTag: string,
): GradientSpec['stops'] | null => {
  const stops: GradientSpec['stops'] = [];
  for (const stop of rawStops) {
    const color = toNoteStopColor(stop.color);
    if (color === null) {
      console.error(
        `[${logTag}] unsupported gradient stop color: ${stop.color}`,
      );
      return null;
    }
    stops.push({ ...stop, color });
  }
  return stops;
};
