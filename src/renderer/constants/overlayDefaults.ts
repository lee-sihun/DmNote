import type { NoteSettings } from '../../types/settings/noteSettings';
import { NOTE_SETTINGS_CONSTRAINTS } from '../../types/settings/noteSettingsConstraints';
import { NOTE_SETTINGS_FALLBACK } from '../defaults';

export const DEFAULT_NOTE_BORDER_RADIUS: number =
  NOTE_SETTINGS_CONSTRAINTS.borderRadius.default;

// 노트 효과 기본 설정, 단일 원천은 defaults.ts의 NOTE_SETTINGS_FALLBACK
export const DEFAULT_NOTE_SETTINGS: NoteSettings = NOTE_SETTINGS_FALLBACK;

// 기존 상수(하위 호환성 유지)
export const TRACK_HEIGHT: number = DEFAULT_NOTE_SETTINGS.trackHeight;

// 제약 값 export
export { NOTE_SETTINGS_CONSTRAINTS } from '../../types/settings/noteSettingsConstraints';
