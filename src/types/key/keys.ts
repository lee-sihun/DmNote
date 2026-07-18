import { z } from 'zod';
import { NOTE_SETTINGS_CONSTRAINTS } from '../settings/noteSettingsConstraints';
import { getDefaultCounterSettings } from '@src/renderer/defaults';
import { gradientSpecSchema, type GradientSpec } from '../color';

export const keyCounterPlacementSchema = z.union([
  z.literal('inside'),
  z.literal('outside'),
]);

export const keyCounterAlignSchema = z.union([
  z.literal('top'),
  z.literal('bottom'),
  z.literal('left'),
  z.literal('right'),
]);

export const keyCounterAlignModeSchema = z.union([
  z.literal('center'),
  z.literal('between'),
]);

export const keyCounterColorSchema = z.object({
  idle: z.string(),
  active: z.string(),
});

export const counterAnimationBezierSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

export const keyCounterAnimationSchema = z.object({
  enabled: z.boolean(),
  presetId: z.string().trim().min(1).nullable().optional(),
  bezier: counterAnimationBezierSchema,
  scale: z.number(),
  durationMs: z.number().int().min(1).max(5000),
});

const keyCounterSettingsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    placement: keyCounterPlacementSchema.optional(),
    align: keyCounterAlignSchema.optional(),
    alignMode: keyCounterAlignModeSchema.optional(),
    fill: keyCounterColorSchema.partial().optional(),
    stroke: keyCounterColorSchema.partial().optional(),
    gap: z.number().int().min(0).optional(),
    fontSize: z.number().int().min(8).max(72).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    fontFamily: z.string().nullable().optional(),
    fontItalic: z.boolean().optional(),
    fontUnderline: z.boolean().optional(),
    fontStrikethrough: z.boolean().optional(),
    animation: keyCounterAnimationSchema.partial().optional(),
    fillIdleGradient: gradientSpecSchema.nullable().optional(),
    fillActiveGradient: gradientSpecSchema.nullable().optional(),
  })
  .partial();

export type KeyCounterPlacement = z.infer<typeof keyCounterPlacementSchema>;
export type KeyCounterAlign = z.infer<typeof keyCounterAlignSchema>;
export type KeyCounterAlignMode = z.infer<typeof keyCounterAlignModeSchema>;
export type KeyCounterColor = z.infer<typeof keyCounterColorSchema>;
export type CounterAnimationBezier = [number, number, number, number];

export interface KeyCounterAnimationSettings {
  enabled: boolean;
  presetId: string | null;
  bezier: CounterAnimationBezier;
  scale: number;
  durationMs: number;
}

export interface KeyCounterSettings {
  enabled: boolean;
  placement: KeyCounterPlacement;
  align: KeyCounterAlign;
  alignMode: KeyCounterAlignMode;
  fill: KeyCounterColor;
  stroke: KeyCounterColor;
  // fill 전용 그라데이션 형제 (stroke는 영구 제외)
  fillIdleGradient?: GradientSpec | null;
  fillActiveGradient?: GradientSpec | null;
  gap: number; // px 단위 간격
  fontSize: number; // px
  fontWeight: number; // CSS font-weight
  fontFamily: string | null; // 커스텀 폰트
  fontItalic: boolean;
  fontUnderline: boolean;
  fontStrikethrough: boolean;
  animation: KeyCounterAnimationSettings;
}

/** @deprecated Use getDefaultCounterAnimationPresetId() from @src/renderer/defaults */
export const DEFAULT_COUNTER_ANIMATION_PRESET_ID = 'builtin-ease-out';

export { getDefaultCounterSettings as createDefaultCounterSettings };

export function normalizeCounterSettings(raw: unknown): KeyCounterSettings {
  const fallback = getDefaultCounterSettings();
  const parsed = keyCounterSettingsInputSchema.safeParse(raw);
  if (!parsed.success) {
    return fallback;
  }

  const {
    enabled,
    placement,
    align,
    alignMode,
    fill,
    stroke,
    gap,
    fontSize,
    fontWeight,
    fontFamily,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
    animation,
    fillIdleGradient,
    fillActiveGradient,
  } = parsed.data;
  const normalizedBezier: CounterAnimationBezier = [
    Number.isFinite(animation?.bezier?.[0])
      ? Math.min(Math.max(animation!.bezier[0], 0), 1)
      : fallback.animation.bezier[0],
    Number.isFinite(animation?.bezier?.[1])
      ? Math.min(Math.max(animation!.bezier[1], -2), 2)
      : fallback.animation.bezier[1],
    Number.isFinite(animation?.bezier?.[2])
      ? Math.min(Math.max(animation!.bezier[2], 0), 1)
      : fallback.animation.bezier[2],
    Number.isFinite(animation?.bezier?.[3])
      ? Math.min(Math.max(animation!.bezier[3], -2), 2)
      : fallback.animation.bezier[3],
  ];

  return {
    enabled: typeof enabled === 'boolean' ? enabled : fallback.enabled,
    placement: placement ?? fallback.placement,
    align: align ?? fallback.align,
    alignMode: alignMode ?? fallback.alignMode,
    fill: {
      idle: fill?.idle ?? fallback.fill.idle,
      active: fill?.active ?? fallback.fill.active,
    },
    stroke: {
      idle: stroke?.idle ?? fallback.stroke.idle,
      active: stroke?.active ?? fallback.stroke.active,
    },
    fillIdleGradient: fillIdleGradient ?? fallback.fillIdleGradient ?? null,
    fillActiveGradient:
      fillActiveGradient ?? fallback.fillActiveGradient ?? null,
    gap:
      typeof gap === 'number' && Number.isFinite(gap) && gap >= 0
        ? gap
        : fallback.gap,
    fontSize:
      typeof fontSize === 'number' && Number.isFinite(fontSize)
        ? fontSize
        : fallback.fontSize,
    fontWeight:
      typeof fontWeight === 'number' && Number.isFinite(fontWeight)
        ? fontWeight
        : fallback.fontWeight,
    fontFamily:
      typeof fontFamily === 'string' ? fontFamily : fallback.fontFamily,
    fontItalic:
      typeof fontItalic === 'boolean' ? fontItalic : fallback.fontItalic,
    fontUnderline:
      typeof fontUnderline === 'boolean'
        ? fontUnderline
        : fallback.fontUnderline,
    fontStrikethrough:
      typeof fontStrikethrough === 'boolean'
        ? fontStrikethrough
        : fallback.fontStrikethrough,
    animation: {
      enabled:
        typeof animation?.enabled === 'boolean'
          ? animation.enabled
          : fallback.animation.enabled,
      presetId:
        typeof animation?.presetId === 'string' &&
        animation.presetId.trim().length > 0
          ? animation.presetId.trim()
          : fallback.animation.presetId,
      bezier: normalizedBezier,
      scale:
        typeof animation?.scale === 'number' && Number.isFinite(animation.scale)
          ? animation.scale
          : fallback.animation.scale,
      durationMs:
        typeof animation?.durationMs === 'number' &&
        Number.isFinite(animation.durationMs)
          ? Math.min(Math.max(Math.round(animation.durationMs), 1), 5000)
          : fallback.animation.durationMs,
    },
  };
}

export const keySchema = z.string();

export const keyModeSchema = z.union([
  z.literal('4key'),
  z.literal('5key'),
  z.literal('6key'),
  z.literal('8key'),
]);

export type KeyMode = z.infer<typeof keyModeSchema> | string;

export const keyMappingSchema = z.record(z.string(), z.array(keySchema));
export type KeyMappings = Record<string, string[]>;

const gradientNoteColorSchema = z.object({
  type: z.literal('gradient'),
  top: z.string(),
  bottom: z.string(),
});

export const noteColorSchema = z.union([z.string(), gradientNoteColorSchema]);
export type GradientNoteColor = z.infer<typeof gradientNoteColorSchema>;
export type NoteColor = z.infer<typeof noteColorSchema>;

// 이미지 맞춤 설정 (CSS object-fit과 동일)
export const imageFitSchema = z.union([
  z.literal('cover'),
  z.literal('contain'),
  z.literal('fill'),
  z.literal('none'),
]);
export type ImageFit = z.infer<typeof imageFitSchema>;

export const keyPositionSchema = z.object({
  dx: z.number(),
  dy: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  // 레이어 표시 여부 (false면 그리드/오버레이에서 렌더링하지 않음)
  hidden: z.boolean().optional().default(false),
  activeImage: z.string().optional().or(z.literal('')),
  inactiveImage: z.string().optional().or(z.literal('')),
  soundEnabled: z.boolean().optional(),
  soundPath: z.string().optional().or(z.literal('')),
  soundVolume: z.number().min(0).max(200).optional(),
  activeTransparent: z.boolean().optional(),
  idleTransparent: z.boolean().optional(),
  count: z.number().int().nonnegative(),
  noteColor: noteColorSchema,
  noteOpacity: z.number().int().min(0).max(100),
  // 그라디언트용 노트 투명도(Top/Bottom). 없으면 noteOpacity를 사용.
  noteOpacityTop: z.number().int().min(0).max(100).optional(),
  noteOpacityBottom: z.number().int().min(0).max(100).optional(),
  // 노트 모서리 반경 (키별 설정, 없으면 기본값 사용)
  noteBorderRadius: z
    .number()
    .min(NOTE_SETTINGS_CONSTRAINTS.borderRadius.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.borderRadius.max)
    .optional(),
  // 노트 넓이(px). 비어있으면 해당 키 width를 사용(자동)
  noteWidth: z.number().positive().optional(),
  // 노트 정렬 (left/center/right). 기본값 center.
  noteAlignment: z
    .enum(['left', 'center', 'right'])
    .optional()
    .default('center'),
  noteEffectEnabled: z.boolean().optional().default(true),
  noteGlowEnabled: z.boolean().optional().default(false),
  noteGlowSize: z.number().min(0).max(50).optional().default(20),
  noteGlowOpacity: z.number().int().min(0).max(100).optional().default(70),
  // 그라디언트용 글로우 투명도(Top/Bottom). 없으면 noteGlowOpacity를 사용.
  noteGlowOpacityTop: z.number().int().min(0).max(100).optional(),
  noteGlowOpacityBottom: z.number().int().min(0).max(100).optional(),
  noteGlowColor: noteColorSchema.optional(),
  noteAutoYCorrection: z.boolean().optional().default(true),
  // 노트 오프셋 (기본 정렬에 추가 보정값, px)
  noteOffsetX: z
    .number()
    .finite()
    .min(NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.noteOffsetX.max)
    .optional(),
  noteOffsetY: z
    .number()
    .finite()
    .min(NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.noteOffsetY.max)
    .optional(),
  // 노트 테두리
  noteBorderWidth: z
    .number()
    .min(NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.min)
    .max(NOTE_SETTINGS_CONSTRAINTS.noteBorderWidth.max)
    .optional(),
  noteBorderColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  // 테두리 투명도 (0~100, 없으면 100). 노트 배경 투명도와 독립
  noteBorderOpacity: z.number().int().min(0).max(100).optional(),
  noteBorderSide: z.enum(['all', 'vertical', 'horizontal']).optional(),
  className: z.string().optional().or(z.literal('')),
  zIndex: z.number().optional(),
  counter: z
    .any()
    .transform((value) => normalizeCounterSettings(value))
    .default(getDefaultCounterSettings()),
  // 스타일 관련 속성들
  backgroundColor: z.string().optional(),
  activeBackgroundColor: z.string().optional(),
  borderColor: z.string().optional(),
  activeBorderColor: z.string().optional(),
  // 그라데이션 형제 필드 — 있으면 렌더 우선, 단색 필드는 다운그레이드 폴백 (api-contract v2.3)
  backgroundGradient: gradientSpecSchema.optional(),
  activeBackgroundGradient: gradientSpecSchema.optional(),
  borderGradient: gradientSpecSchema.optional(),
  activeBorderGradient: gradientSpecSchema.optional(),
  borderWidth: z.number().optional(),
  borderRadius: z.number().optional(),
  fontSize: z.number().optional(),
  fontColor: z.string().optional(),
  activeFontColor: z.string().optional(),
  graphAnimationEnabled: z.boolean().optional(),
  // 폰트 패밀리 (커스텀 폰트 이름)
  fontFamily: z.string().optional(),
  // 이미지 맞춤(대기/입력 개별 설정). 없으면 imageFit을 fallback으로 사용.
  idleImageFit: imageFitSchema.optional(),
  activeImageFit: imageFitSchema.optional(),
  // 레거시(대기/입력 공통) 이미지 맞춤
  imageFit: imageFitSchema.optional(),
  // 인라인 스타일 우선 여부 (true: 속성 패널 스타일 우선, false: 커스텀 CSS 우선)
  useInlineStyles: z.boolean().optional(),
  // 키에 표시할 커스텀 텍스트 (없으면 기본 키 이름 표시)
  displayText: z.string().optional(),
  // 레이어 패널에서 표시할 커스텀 이름 (없으면 기본 키/통계/그래프 이름 표시)
  layerName: z.string().optional(),
  // 레이어 그룹 ID (같은 그룹에 속한 레이어들은 같은 groupId를 가짐)
  groupId: z.string().optional(),
  // 글꼴 스타일 속성들
  fontWeight: z.number().optional(), // CSS font-weight 값 (400, 700 등)
  fontItalic: z.boolean().optional(),
  fontUnderline: z.boolean().optional(),
  fontStrikethrough: z.boolean().optional(),
});

export type KeyPosition = z.infer<typeof keyPositionSchema>;

export const keyPositionsSchema = z.record(
  z.string(),
  z.array(keyPositionSchema),
);
export type KeyPositions = Record<string, KeyPosition[]>;

export type KeyCounters = Record<string, Record<string, number>>;

export const customTabSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
});
export type CustomTab = z.infer<typeof customTabSchema>;

export const customTabsSchema = z.array(customTabSchema);
