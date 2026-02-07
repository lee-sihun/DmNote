import { z } from "zod";
import { NOTE_SETTINGS_CONSTRAINTS } from "./noteSettingsConstraints";

export const fadePositionSchema = z.union([
  z.literal("auto"),
  z.literal("top"),
  z.literal("bottom"),
  z.literal("none"),
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

export function normalizeNoteSettings(raw: unknown): NoteSettings {
  const parsed = noteSettingsSchema.safeParse({
    ...NOTE_SETTINGS_DEFAULTS,
    ...(typeof raw === "object" && raw !== null ? raw : {}),
  });
  return parsed.success ? parsed.data : NOTE_SETTINGS_DEFAULTS;
}
