import { z } from 'zod';
import { imageModeSchema, imageTransformSchema } from './imageLayer';
import { DEFAULT_ELEMENT_ROTATION, elementRotationSchema } from './rotation';
import { elementShadowSpecSchema } from './shadows';
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

// 선택 그라데이션 하나가 손상돼도 나머지 카운터 설정은 보존
const optionalCounterGradientSchema = gradientSpecSchema
  .nullable()
  .optional()
  .catch(undefined);

const keyCounterSettingsInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    placement: keyCounterPlacementSchema.optional(),
    align: keyCounterAlignSchema.optional(),
    alignMode: keyCounterAlignModeSchema.optional(),
    fill: keyCounterColorSchema.partial().optional(),
    gap: z.number().int().min(0).optional(),
    fontSize: z.number().int().min(8).max(72).optional(),
    fontWeight: z.number().int().min(100).max(900).optional(),
    // Rust Option은 IPC에서 null로 올 수 있다 - 거부하면 카운터 설정 전체가 폴백된다
    fontBold: z.boolean().nullable().optional(),
    fontFamily: z.string().nullable().optional(),
    fontItalic: z.boolean().optional(),
    fontUnderline: z.boolean().optional(),
    fontStrikethrough: z.boolean().optional(),
    animation: keyCounterAnimationSchema.partial().optional(),
    fillIdleGradient: optionalCounterGradientSchema,
    fillActiveGradient: optionalCounterGradientSchema,
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
  // fill 그라데이션 형제 - 단색 필드는 대표색 폴백
  fillIdleGradient?: GradientSpec | null;
  fillActiveGradient?: GradientSpec | null;
  gap: number; // px 단위 간격
  fontSize: number; // px
  fontWeight: number; // CSS font-weight
  fontBold: boolean; // 선택 굵기에 Bold 보정 적용
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
    gap,
    fontSize,
    fontWeight,
    fontBold,
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
      typeof fontBold !== 'boolean' && fontWeight === 700
        ? 400
        : typeof fontWeight === 'number' && Number.isFinite(fontWeight)
        ? fontWeight
        : fallback.fontWeight,
    fontBold:
      typeof fontBold === 'boolean'
        ? fontBold
        : typeof fontWeight === 'number'
        ? fontWeight === 700
        : fallback.fontBold,
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

// 슬롯 판정 방식: all = 동시 입력, any = 택일
export const slotMatchSchema = z.union([z.literal('all'), z.literal('any')]);
export type SlotMatch = z.infer<typeof slotMatchSchema>;

export const multiKeySlotSchema = z.object({
  keys: z.array(z.string().min(1)).min(2).max(8),
  match: slotMatchSchema,
});
// z.infer가 match를 optional로 추론하지 않도록 명시 선언
export interface MultiKeySlot {
  keys: string[];
  match: SlotMatch;
}

// 단일 키는 문자열 그대로 유지 (하위 호환)
export const keySlotSchema = z.union([keySchema, multiKeySlotSchema]);
export type KeySlot = string | MultiKeySlot;

export const keyModeSchema = z.union([
  z.literal('4key'),
  z.literal('5key'),
  z.literal('6key'),
  z.literal('8key'),
]);

export type KeyMode = z.infer<typeof keyModeSchema> | string;

export const keyMappingSchema = z.record(z.string(), z.array(keySlotSchema));
export type KeyMappings = Record<string, KeySlot[]>;

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
  // 요소 안정 신원. 백엔드가 발급·검증하는 UUID, 프론트는 보존과 신규 발급만 한다
  id: z.string().optional(),
  dx: z.number(),
  dy: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  // 요소 회전(도). 논리 상자는 축 정렬 그대로 두고 얼굴·트랙·외부 카운터가
  // 상자 중심 기준으로 돈다. 백엔드가 항상 직렬화하고 구형 문서·플러그인 입력은 0
  rotation: elementRotationSchema.default(DEFAULT_ELEMENT_ROTATION),
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
  // 글로우 페인트를 본체 페인트와 같게 유지 (저장 시 미러)
  noteGlowSyncPaint: z.boolean().optional().default(false),
  noteGlowSize: z.number().min(0).max(50).optional().default(10),
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
  // 테두리 그라데이션 형제 - 있으면 렌더 우선, noteBorderColor는 hex 대표색 폴백
  noteBorderGradient: gradientSpecSchema.optional(),
  // 본체·글로우 형제 - 있으면 신형 의미(배율 모델), 구형 필드는 다운그레이드 shadow (계약 §9)
  noteGradient: gradientSpecSchema.optional(),
  noteGlowGradient: gradientSpecSchema.optional(),
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
  shadow: elementShadowSpecSchema.optional(),
  activeShadow: elementShadowSpecSchema.optional(),
  fontSize: z.number().optional(),
  fontColor: z.string().optional(),
  activeFontColor: z.string().optional(),
  fontGradient: gradientSpecSchema.optional(),
  activeFontGradient: gradientSpecSchema.optional(),
  graphAnimationEnabled: z.boolean().optional(),
  // 폰트 패밀리 (커스텀 폰트 이름)
  fontFamily: z.string().optional(),
  // 이미지 맞춤(대기/입력 개별 설정). 없으면 imageFit을 fallback으로 사용.
  idleImageFit: imageFitSchema.optional(),
  activeImageFit: imageFitSchema.optional(),
  // 레거시(대기/입력 공통) 이미지 맞춤
  imageFit: imageFitSchema.optional(),
  // 이미지 레이어 모드(없으면 replace)와 상태별 변환(없으면 identity)
  imageMode: imageModeSchema.optional(),
  idleImageTransform: imageTransformSchema.optional(),
  activeImageTransform: imageTransformSchema.optional(),
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
  fontBold: z.boolean().optional(),
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
