import { NOTE_SETTINGS_CONSTRAINTS } from '../../types/noteSettingsConstraints';

export const DEFAULT_NOTE_BORDER_RADIUS =
  NOTE_SETTINGS_CONSTRAINTS.borderRadius.default;

// 노트 효과 기본 설정
export const DEFAULT_NOTE_SETTINGS = {
  frameLimit: NOTE_SETTINGS_CONSTRAINTS.frameLimit.default,
  speed: NOTE_SETTINGS_CONSTRAINTS.speed.default,
  trackHeight: NOTE_SETTINGS_CONSTRAINTS.trackHeight.default,
  reverse: false,
  fadeTopPx: NOTE_SETTINGS_CONSTRAINTS.fadeTopPx.default,
  fadeBottomPx: NOTE_SETTINGS_CONSTRAINTS.fadeBottomPx.default,
  reverseFadeTopPx: NOTE_SETTINGS_CONSTRAINTS.reverseFadeTopPx.default,
  reverseFadeBottomPx: NOTE_SETTINGS_CONSTRAINTS.reverseFadeBottomPx.default,
  delayedNoteEnabled: false,
  shortNoteThresholdMs: NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.default,
  shortNoteMinLengthPx: NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.default,
  keyDisplayDelayMs: NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.default,
};

// 기존 상수(하위 호환성 유지)
export const TRACK_HEIGHT = DEFAULT_NOTE_SETTINGS.trackHeight;

// 제약 값 export
export { NOTE_SETTINGS_CONSTRAINTS } from '../../types/noteSettingsConstraints';
