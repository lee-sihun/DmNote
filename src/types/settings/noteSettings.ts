import { z } from 'zod';
import { NOTE_SETTINGS_CONSTRAINTS } from './noteSettingsConstraints';
import {
  getDefaultNoteSettings,
  NOTE_SETTINGS_FALLBACK,
} from '@src/renderer/defaults';

export const fadePositionSchema = z.union([
  z.literal('auto'),
  z.literal('top'),
  z.literal('bottom'),
  z.literal('none'),
  z.literal('both'),
]);

export const noteSettingsSchema = z.object({
  frameLimit: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.frameLimit.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.frameLimit.max),
  speed: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.speed.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.speed.max),
  trackHeight: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.trackHeight.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.trackHeight.max),
  reverse: z.boolean(),
  // 하위 호환: 기존 store.json에 fadePosition이 있을 수 있음
  fadePosition: fadePositionSchema
    .optional()
    .default(NOTE_SETTINGS_FALLBACK.fadePosition),
  fadeTopPx: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.fadeTopPx.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.fadeTopPx.max),
  fadeBottomPx: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.fadeBottomPx.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.fadeBottomPx.max),
  reverseFadeTopPx: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.reverseFadeTopPx.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.reverseFadeTopPx.max),
  reverseFadeBottomPx: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.reverseFadeBottomPx.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.reverseFadeBottomPx.max),
  delayedNoteEnabled: z.boolean(),
  shortNoteThresholdMs: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.max),
  shortNoteMinLengthPx: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.max),
  keyDisplayDelayMs: z
    .number()
    .int()
    .min(NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.max),
});

export type NoteSettings = z.infer<typeof noteSettingsSchema>;

/** 현재 reverse 상태에 따라 활성 페이드 값 반환 */
export function resolvedFadeValues(noteSettings: NoteSettings): {
  topPx: number;
  bottomPx: number;
} {
  return noteSettings.reverse
    ? {
        topPx: noteSettings.reverseFadeTopPx,
        bottomPx: noteSettings.reverseFadeBottomPx,
      }
    : { topPx: noteSettings.fadeTopPx, bottomPx: noteSettings.fadeBottomPx };
}

export function normalizeNoteSettings(raw: unknown): NoteSettings {
  const defaults = getDefaultNoteSettings();
  const parsed = noteSettingsSchema.safeParse({
    ...defaults,
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
  });
  return parsed.success ? parsed.data : defaults;
}

/** 탭별 노트 트랙 설정 (모든 필드 optional → 전역 설정에 오버라이드) */
export type TabNoteSettings = Partial<NoteSettings>;

/** 탭별 노트 트랙 설정 오버라이드 맵 (키: 탭 ID) */
export type TabNoteOverrides = Record<string, TabNoteSettings>;

/** 전역 설정 + 탭별 오버라이드를 병합하여 최종 설정 반환 */
export function mergeNoteSettings(
  global: NoteSettings,
  tabOverride?: TabNoteSettings | null,
): NoteSettings {
  if (!tabOverride) return global;
  return {
    frameLimit: tabOverride.frameLimit ?? global.frameLimit,
    speed: tabOverride.speed ?? global.speed,
    trackHeight: tabOverride.trackHeight ?? global.trackHeight,
    reverse: tabOverride.reverse ?? global.reverse,
    fadePosition: tabOverride.fadePosition ?? global.fadePosition,
    fadeTopPx: tabOverride.fadeTopPx ?? global.fadeTopPx,
    fadeBottomPx: tabOverride.fadeBottomPx ?? global.fadeBottomPx,
    reverseFadeTopPx: tabOverride.reverseFadeTopPx ?? global.reverseFadeTopPx,
    reverseFadeBottomPx:
      tabOverride.reverseFadeBottomPx ?? global.reverseFadeBottomPx,
    delayedNoteEnabled:
      tabOverride.delayedNoteEnabled ?? global.delayedNoteEnabled,
    shortNoteThresholdMs:
      tabOverride.shortNoteThresholdMs ?? global.shortNoteThresholdMs,
    shortNoteMinLengthPx:
      tabOverride.shortNoteMinLengthPx ?? global.shortNoteMinLengthPx,
    keyDisplayDelayMs:
      tabOverride.keyDisplayDelayMs ?? global.keyDisplayDelayMs,
  };
}
