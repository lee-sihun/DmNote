/**
 * 노트 설정 제약 값 (Min/Max)
 * 프론트엔드와 백엔드에서 동일하게 사용되는 중앙 관리 파일
 */

export const NOTE_SETTINGS_CONSTRAINTS = {
  borderRadius: {
    min: 0,
    max: 100,
    default: 4,
  },
  frameLimit: {
    min: 0,
    max: 240,
    default: 0,
  },
  speed: {
    min: 70,
    max: 9999,
    default: 400,
  },
  trackHeight: {
    min: 20,
    max: 2000,
    default: 300,
  },
  shortNoteThresholdMs: {
    min: 0,
    max: 2000,
    default: 50,
  },
  shortNoteMinLengthPx: {
    min: 1,
    max: 9999,
    default: 30,
  },
  keyDisplayDelayMs: {
    min: 0,
    max: 30000,
    default: 0,
  },
  fadeTopPx: {
    min: 0,
    max: 500,
    default: 50,
  },
  fadeBottomPx: {
    min: 0,
    max: 500,
    default: 0,
  },
  reverseFadeTopPx: {
    min: 0,
    max: 500,
    default: 0,
  },
  reverseFadeBottomPx: {
    min: 0,
    max: 500,
    default: 50,
  },
  noteOffsetX: {
    min: -500,
    max: 500,
    default: 0,
  },
  noteOffsetY: {
    min: -500,
    max: 500,
    default: 0,
  },
  noteBorderWidth: {
    min: 0,
    max: 20,
    default: 0,
  },
} as const;

/**
 * 개별 제약 값 접근 헬퍼
 */
export const getConstraints = (key: keyof typeof NOTE_SETTINGS_CONSTRAINTS) => {
  return NOTE_SETTINGS_CONSTRAINTS[key];
};

/**
 * 값 범위 제약 헬퍼
 */
export const clampValue = (
  value: number,
  key: keyof typeof NOTE_SETTINGS_CONSTRAINTS,
): number => {
  const constraint = NOTE_SETTINGS_CONSTRAINTS[key];
  return Math.min(Math.max(value, constraint.min), constraint.max);
};
