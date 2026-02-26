import { z } from "zod";
import { NOTE_SETTINGS_CONSTRAINTS } from "./noteSettingsConstraints";

export const fadePositionSchema = z.union([
  z.literal("auto"),
  z.literal("top"),
  z.literal("bottom"),
  z.literal("none"),
  z.literal("both"),
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
  fadePosition: fadePositionSchema,
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

export const NOTE_SETTINGS_DEFAULTS: NoteSettings = Object.freeze({
  frameLimit: NOTE_SETTINGS_CONSTRAINTS.frameLimit.default,
  speed: NOTE_SETTINGS_CONSTRAINTS.speed.default,
  trackHeight: NOTE_SETTINGS_CONSTRAINTS.trackHeight.default,
  reverse: false,
  fadePosition: "auto",
  delayedNoteEnabled: false,
  shortNoteThresholdMs: NOTE_SETTINGS_CONSTRAINTS.shortNoteThresholdMs.default,
  shortNoteMinLengthPx: NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.default,
  keyDisplayDelayMs: NOTE_SETTINGS_CONSTRAINTS.keyDisplayDelayMs.default,
});

/** fadePosition 문자열을 셰이더 uniform 값으로 변환 */
const FADE_POSITION_UNIFORM: Record<string, number> = {
  auto: 0.0,
  top: 1.0,
  bottom: 2.0,
  none: 3.0,
  both: 4.0,
};

export function fadePositionToUniform(pos: string): number {
  return FADE_POSITION_UNIFORM[pos] ?? 0.0;
}

export function normalizeNoteSettings(raw: unknown): NoteSettings {
  const parsed = noteSettingsSchema.safeParse({
    ...NOTE_SETTINGS_DEFAULTS,
    ...(typeof raw === "object" && raw !== null ? raw : {}),
  });
  return parsed.success ? parsed.data : NOTE_SETTINGS_DEFAULTS;
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
    delayedNoteEnabled: tabOverride.delayedNoteEnabled ?? global.delayedNoteEnabled,
    shortNoteThresholdMs: tabOverride.shortNoteThresholdMs ?? global.shortNoteThresholdMs,
    shortNoteMinLengthPx: tabOverride.shortNoteMinLengthPx ?? global.shortNoteMinLengthPx,
    keyDisplayDelayMs: tabOverride.keyDisplayDelayMs ?? global.keyDisplayDelayMs,
  };
}
