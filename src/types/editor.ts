import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import {
  keyPositionSchema,
  keySlotSchema,
  type KeyMappings,
  type KeyPosition,
  type KeyPositions,
  type KeySlot,
} from '@src/types/key/keys';
import type { KnobItemPosition, KnobItemPositions } from '@src/types/key/knobs';
import {
  STAT_ITEM_TYPES,
  type StatItemPosition,
  type StatItemPositions,
} from '@src/types/key/statItems';
import type { LayerGroupDef, LayerGroups } from '@src/types/layerGroups';
import type { ElementShadowValuePatch } from '@src/types/key/shadows';
import {
  isNotePaintPropertyPatchV1,
  type NoteBorderPaintValueV1,
  type NotePaintPropertyPatchV1,
  type NotePaintValuePatchV1,
} from '@src/types/key/notePaint';
import {
  isCounterFillPropertyPatchV1,
  type CounterFillDescriptorV1,
  type CounterFillPropertyPatchV1,
} from '@src/types/key/counterFill';
import {
  canonicalizePositionGradients,
  type PaintDescriptorV1,
} from '@src/types/color';

export const EDITOR_SCHEMA_VERSION = 1 as const;

// 쓰기(commit) 전용 버전. 문서(editor_get)와 이벤트(editor:committed)는 v1을
// 유지하고 id를 additive로 싣는다. v2 커밋은 포함된 모든 위치 항목에 유효 ID가
// 필수라 백엔드가 형식·전역 유일성을 강제한다. 구형 플러그인 gateway만 v1로 남는다
export const EDITOR_COMMIT_SCHEMA_VERSION = 2 as const;
export const EDITOR_OPS_VERSION = 1 as const;

export const EDITOR_FIELDS = [
  'keys',
  'keyPositions',
  'statPositions',
  'graphPositions',
  'knobPositions',
  'layerGroups',
] as const;

export type EditorField = (typeof EDITOR_FIELDS)[number];

export interface EditorDocumentV1 {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  keys: KeyMappings;
  keyPositions: KeyPositions;
  statPositions: StatItemPositions;
  graphPositions: GraphItemPositions;
  knobPositions: KnobItemPositions;
  layerGroups: LayerGroups;
}

export type EditorPatchV1 = {
  schemaVersion:
    | typeof EDITOR_SCHEMA_VERSION
    | typeof EDITOR_COMMIT_SCHEMA_VERSION;
} & Partial<Pick<EditorDocumentV1, EditorField>>;

// 플러그인 공개 표면 전용 패치. commit wire v2(ID 필수 검증)는 자사 내부
// 전용이라 플러그인 경계에는 v1만 노출한다 - durable plugin ID는 별도 릴리스
export type EditorLegacyPatchV1 = {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
} & Partial<Pick<EditorDocumentV1, EditorField>>;

interface EditorCommitRequestBase {
  baseRevision: number;
  mutationId: string;
  // 프리뷰 게스처 커밋 연동용, 성공 시 committed 이벤트로 echo
  gestureId?: string;
  // 한 요청으로 합쳐진 프리뷰 세션 전체
  gestureIds?: string[];
  // 멀티 키 슬롯 지원 선언. keys를 포함한 커밋에서 현재 매핑에 멀티 슬롯이
  // 존재하는데 이 선언이 없으면 백엔드가 MULTI_KEY_UNSUPPORTED로 거절
  multiKey?: boolean;
}

export interface EditorPatchCommitRequest extends EditorCommitRequestBase {
  changes: EditorPatchV1;
  opsVersion?: never;
  ops?: never;
}

export type EditorElementTypeV1 = 'key' | 'stat' | 'graph' | 'knob';

export interface EditorBoundsV1 {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

export interface EditorSetBoundsOpV1 {
  kind: 'setBounds';
  elementType: EditorElementTypeV1;
  id: string;
  bounds: EditorBoundsV1;
}

export interface EditorDeleteElementOpV1 {
  kind: 'deleteElement';
  elementType: EditorElementTypeV1;
  id: string;
}

export type EditorFrozenElementV1 =
  | { elementType: 'key'; slot: KeySlot; position: KeyPosition }
  | { elementType: 'stat'; position: StatItemPosition }
  | { elementType: 'graph'; position: GraphItemPosition }
  | { elementType: 'knob'; position: KnobItemPosition };

export interface EditorFrozenZUpdateV1 {
  elementType: EditorElementTypeV1;
  id: string;
  zIndex: number;
}

export interface EditorInsertFrozenElementsOpV1 {
  kind: 'insertFrozenElements';
  mode: string;
  elements: EditorFrozenElementV1[];
  groups: LayerGroupDef[];
  zUpdates: EditorFrozenZUpdateV1[];
}

export interface EditorReorderZUpdateV1 {
  elementType: EditorElementTypeV1;
  id: string;
  zIndex: number;
}

export interface EditorReorderGroupUpdateV1 {
  elementType: EditorElementTypeV1;
  id: string;
  groupId: string | null;
}

export interface EditorReorderElementsOpV1 {
  kind: 'reorderElements';
  mode: string;
  zUpdates: EditorReorderZUpdateV1[];
  groupUpdates: EditorReorderGroupUpdateV1[];
  completeModeOrder: boolean;
}

interface EditorElementPropertyValuesV1 {
  hidden: boolean;
  layerName: string | null;
  graphType: 'line' | 'bar';
  graphColor: string;
  showAvgLine: boolean;
  graphAnimationEnabled: boolean;
  graphSpeed: number;
  reverse: boolean;
  sensitivity: number;
  axisId: string;
  soundEnabled: boolean;
  soundPath: string;
  soundVolume: number;
  inactiveImage: string;
  activeImage: string;
  idleTransparent: boolean;
  activeTransparent: boolean;
  idleImageFit: 'cover' | 'contain' | 'fill' | 'none';
  activeImageFit: 'cover' | 'contain' | 'fill' | 'none';
  counterEnabled: boolean;
  counterAnimationEnabled: boolean;
  counterPlacement: 'inside' | 'outside';
  counterAlign: 'top' | 'bottom' | 'left' | 'right';
  counterAlignMode: 'center' | 'between';
  counterGap: number;
  counterFontSize: number;
  counterFontWeight: number;
  counterFontItalic: boolean;
  counterFontUnderline: boolean;
  counterFontStrikethrough: boolean;
  counterFontFamily: string;
  counterStrokeIdle: string;
  counterStrokeActive: string;
  counterFillIdle: CounterFillDescriptorV1;
  counterFillActive: CounterFillDescriptorV1;
  counterAnimationPreset: EditorCounterAnimationPresetIntentV1;
  useInlineStyles: boolean;
  fontWeight: number;
  fontItalic: boolean;
  fontUnderline: boolean;
  fontStrikethrough: boolean;
  fontFamily: string;
  displayText: string;
  className: string;
  borderWidth: number;
  borderRadius: number;
  fontSize: number;
  noteGlowSize: number;
  noteOffsetX: number | null;
  noteOffsetY: number | null;
  noteWidth: number | null;
  noteBorderWidth: number;
  noteBorderRadius: number;
  backgroundPaint: PaintDescriptorV1;
  activeBackgroundPaint: PaintDescriptorV1;
  borderPaint: PaintDescriptorV1;
  activeBorderPaint: PaintDescriptorV1;
  shadow: ElementShadowValuePatch;
  activeShadow: ElementShadowValuePatch;
  shadowEnabled: boolean;
  notePaint: NotePaintValuePatchV1;
  noteGlowPaint: NotePaintValuePatchV1;
  noteBorderPaint: NoteBorderPaintValueV1;
  noteEffectEnabled: boolean;
  noteAutoYCorrection: boolean;
  noteGlowEnabled: boolean;
  noteAlignment: 'left' | 'center' | 'right';
  noteBorderSide: 'all' | 'vertical' | 'horizontal';
  statType: 'kps' | 'kpsAvg' | 'kpsMax' | 'total';
}

type ExactEditorPropertyPatchV1<K extends keyof EditorElementPropertyValuesV1> =
  Pick<EditorElementPropertyValuesV1, K> &
    Partial<Record<Exclude<keyof EditorElementPropertyValuesV1, K>, never>>;

type EditorPropertyPatchUnionV1<K extends keyof EditorElementPropertyValuesV1> =
  { [P in K]: ExactEditorPropertyPatchV1<P> }[K];

export type EditorGraphRuntimePropertyPatchV1 = EditorPropertyPatchUnionV1<
  'showAvgLine' | 'graphAnimationEnabled' | 'graphSpeed'
>;

export type EditorKnobRuntimePropertyPatchV1 = EditorPropertyPatchUnionV1<
  'reverse' | 'sensitivity'
>;

export type EditorKnobAxisPropertyPatchV1 =
  EditorPropertyPatchUnionV1<'axisId'>;

export type EditorSoundPathPropertyPatchV1 =
  EditorPropertyPatchUnionV1<'soundPath'>;

export type EditorSoundEnabledPropertyPatchV1 =
  EditorPropertyPatchUnionV1<'soundEnabled'>;

export type EditorSoundVolumePropertyPatchV1 =
  EditorPropertyPatchUnionV1<'soundVolume'>;

export type EditorInactiveImagePropertyPatchV1 =
  EditorPropertyPatchUnionV1<'inactiveImage'>;

export type EditorActiveImagePropertyPatchV1 =
  EditorPropertyPatchUnionV1<'activeImage'>;

export type EditorImageTransparencyPropertyPatchV1 = EditorPropertyPatchUnionV1<
  'idleTransparent' | 'activeTransparent'
>;

export type EditorImageFitPropertyPatchV1 = EditorPropertyPatchUnionV1<
  'idleImageFit' | 'activeImageFit'
>;

export interface EditorCounterAnimationPresetIntentV1 {
  presetId: string;
  applyPresetId?: true;
  bezier?: [number, number, number, number];
  scale?: number;
  durationMs?: number;
}

export type EditorCounterAnimationPresetPropertyPatchV1 =
  EditorPropertyPatchUnionV1<'counterAnimationPreset'>;

export type EditorCounterBooleanPropertyPatchV1 = EditorPropertyPatchUnionV1<
  'counterEnabled' | 'counterAnimationEnabled'
>;

export type EditorCounterLayoutPropertyPatchV1 = EditorPropertyPatchUnionV1<
  'counterPlacement' | 'counterAlign' | 'counterAlignMode' | 'counterGap'
>;

export type EditorCounterTypographyPropertyPatchV1 = EditorPropertyPatchUnionV1<
  | 'counterFontSize'
  | 'counterFontWeight'
  | 'counterFontItalic'
  | 'counterFontUnderline'
  | 'counterFontStrikethrough'
  | 'counterFontFamily'
>;

export type EditorCounterStrokePropertyPatchV1 = EditorPropertyPatchUnionV1<
  'counterStrokeIdle' | 'counterStrokeActive'
>;
export type EditorCounterFillPropertyPatchV1 = CounterFillPropertyPatchV1;

export type EditorFontStylePropertyPatchV1 = EditorPropertyPatchUnionV1<
  'fontWeight' | 'fontItalic' | 'fontUnderline' | 'fontStrikethrough'
>;

export type EditorFontFamilyPropertyPatchV1 =
  EditorPropertyPatchUnionV1<'fontFamily'>;

export type EditorTextPropertyPatchV1 = EditorPropertyPatchUnionV1<
  'displayText' | 'className'
>;

export type EditorNumericStylePropertyPatchV1 = EditorPropertyPatchUnionV1<
  'borderWidth' | 'borderRadius' | 'fontSize'
>;

export type EditorPreviewStylePropertyPatchV1 =
  | EditorTextPropertyPatchV1
  | EditorNumericStylePropertyPatchV1
  | EditorPropertyPatchUnionV1<
      | 'noteGlowSize'
      | 'noteOffsetX'
      | 'noteOffsetY'
      | 'noteWidth'
      | 'noteBorderWidth'
      | 'noteBorderRadius'
    >;

export type EditorPaintPropertyPatchV1 = EditorPropertyPatchUnionV1<
  | 'backgroundPaint'
  | 'activeBackgroundPaint'
  | 'borderPaint'
  | 'activeBorderPaint'
>;

export type EditorShadowPropertyPatchV1 = EditorPropertyPatchUnionV1<
  'shadow' | 'activeShadow' | 'shadowEnabled'
>;

export type EditorNotePaintPropertyPatchV1 = NotePaintPropertyPatchV1;

export type EditorNotePropertyPatchV1 = EditorPropertyPatchUnionV1<
  | 'noteEffectEnabled'
  | 'noteAutoYCorrection'
  | 'noteGlowEnabled'
  | 'noteAlignment'
  | 'noteBorderSide'
>;

export type EditorStatTypePropertyPatchV1 =
  EditorPropertyPatchUnionV1<'statType'>;

export type EditorElementPropertyPatchV1 = EditorPropertyPatchUnionV1<
  keyof EditorElementPropertyValuesV1
>;

export interface EditorPatchElementOpV1 {
  kind: 'patchElement';
  elementType: EditorElementTypeV1;
  id: string;
  patch: EditorElementPropertyPatchV1;
}

export interface EditorSetKeySlotOpV1 {
  kind: 'setKeySlot';
  id: string;
  slot: KeySlot;
}

export type EditorOpV1 =
  | EditorSetBoundsOpV1
  | EditorDeleteElementOpV1
  | EditorInsertFrozenElementsOpV1
  | EditorReorderElementsOpV1
  | EditorPatchElementOpV1
  | EditorSetKeySlotOpV1;

export interface EditorOpsCommitRequest extends EditorCommitRequestBase {
  changes?: never;
  opsVersion: typeof EDITOR_OPS_VERSION;
  ops: EditorOpV1[];
}

export type EditorCommitRequest =
  | EditorPatchCommitRequest
  | EditorOpsCommitRequest;

// 플러그인 dmn.editor.commit 요청. changes만 v1으로 좁힌다
export interface PluginEditorCommitRequest extends EditorCommitRequestBase {
  changes: EditorLegacyPatchV1;
  opsVersion?: never;
  ops?: never;
}

export type EditorOpResultStatusV1 = 'applied' | 'noChange' | 'targetMissing';

export type EditorOpResultV1 =
  | {
      status: 'applied' | 'noChange';
      bounds: EditorBoundsV1;
    }
  | {
      status: 'applied' | 'noChange' | 'targetMissing';
      bounds?: never;
    };

export interface EditorCommitResult {
  revision: number;
  changedFields: EditorField[];
  opResults?: EditorOpResultV1[];
}

export type EditorPluginCommitResult = Omit<EditorCommitResult, 'opResults'>;

interface EditorGestureCommitContextBase {
  editorBaseRevision: number;
  mutationId: string;
}

export interface EditorGesturePatchCommitContext
  extends EditorGestureCommitContextBase {
  editorChanges?: EditorPatchV1;
  editorOpsVersion?: never;
  editorOps?: never;
}

export interface EditorGestureOpsCommitContext
  extends EditorGestureCommitContextBase {
  editorChanges?: never;
  editorOpsVersion: typeof EDITOR_OPS_VERSION;
  editorOps: EditorOpV1[];
}

export type EditorGestureCommitContext =
  | EditorGesturePatchCommitContext
  | EditorGestureOpsCommitContext;

export interface EditorGetResult {
  revision: number;
  document: EditorDocumentV1;
}

export interface EditorCommittedV1 {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  revision: number;
  mutationId: string;
  origin?: string;
  changedFields: EditorField[];
  patch: EditorPatchV1;
  // 커밋 요청의 gestureId echo, 수신 창의 프리뷰 오버레이 정리 신호
  gestureId?: string | null;
  // 합쳐진 커밋에 포함된 모든 프리뷰 세션 정리 신호
  gestureIds?: string[];
}

export type EditorCommitErrorCode =
  | 'REVISION_CONFLICT'
  | 'PLUGIN_REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'TOO_MANY_GESTURE_IDS'
  | 'INVALID_GESTURE_ID'
  | 'PAIRED_UPDATE_REQUIRED'
  | 'MUTATION_ID_REUSED'
  | 'IO_ERROR'
  // undo/redo barrier 진행 중, retryable
  | 'HISTORY_IN_PROGRESS'
  // observedHistoryEpoch가 낡음, retryable
  | 'HISTORY_EPOCH_CONFLICT'
  // 멀티 키 슬롯 존재 + multiKey 미선언 keys 쓰기, 비 retryable
  | 'MULTI_KEY_UNSUPPORTED';

export interface EditorCommitErrorDetails {
  currentRevision?: number;
  validationCode?: string;
  field?: string;
  currentHistoryEpoch?: number;
}

export interface EditorCommitError {
  errorCode: EditorCommitErrorCode;
  message: string;
  details?: EditorCommitErrorDetails;
  retryable: boolean;
}

const EDITOR_ERROR_CODES = new Set<EditorCommitErrorCode>([
  'REVISION_CONFLICT',
  'PLUGIN_REVISION_CONFLICT',
  'VALIDATION_FAILED',
  'TOO_MANY_GESTURE_IDS',
  'INVALID_GESTURE_ID',
  'PAIRED_UPDATE_REQUIRED',
  'MUTATION_ID_REUSED',
  'IO_ERROR',
  'HISTORY_IN_PROGRESS',
  'HISTORY_EPOCH_CONFLICT',
  'MULTI_KEY_UNSUPPORTED',
]);

const EDITOR_FIELD_SET = new Set<string>(EDITOR_FIELDS);
const EDITOR_PATCH_KEYS = new Set<string>(['schemaVersion', ...EDITOR_FIELDS]);
const STAT_TYPES = new Set<string>(STAT_ITEM_TYPES);
const GRAPH_TYPES = new Set(['line', 'bar']);
const KEY_POSITION_KEYS = new Set(Object.keys(keyPositionSchema.shape));

// Rust Option 필드는 IPC에서 null로 직렬화되므로 검증할 때 "값 없음"으로 취급
const NULLABLE_POSITION_FIELDS = new Set([
  'activeImage',
  'inactiveImage',
  'soundEnabled',
  'soundPath',
  'soundVolume',
  'noteOpacityTop',
  'noteOpacityBottom',
  'noteBorderRadius',
  'noteWidth',
  'noteGlowOpacityTop',
  'noteGlowOpacityBottom',
  'noteGlowColor',
  'noteOffsetX',
  'noteOffsetY',
  'noteBorderWidth',
  'noteBorderColor',
  'noteBorderSide',
  'className',
  'zIndex',
  'backgroundColor',
  'activeBackgroundColor',
  'borderColor',
  'activeBorderColor',
  'borderWidth',
  'borderRadius',
  'fontSize',
  'fontColor',
  'activeFontColor',
  'graphAnimationEnabled',
  'fontFamily',
  'imageFit',
  'idleImageFit',
  'activeImageFit',
  'useInlineStyles',
  'displayText',
  'fontWeight',
  'fontItalic',
  'fontUnderline',
  'fontStrikethrough',
  'layerName',
  'groupId',
]);

export class EditorProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditorProtocolError';
  }
}

export function assertSafeEditorRevision(
  value: unknown,
  label = 'editor revision',
): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new EditorProtocolError(
      `${label} must be a non-negative safe integer`,
    );
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void => {
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !(key in value))
  ) {
    throw new EditorProtocolError(`${label} has unsupported fields`);
  }
};

export const isEditorPaintDescriptorV1 = (
  value: unknown,
): value is PaintDescriptorV1 => {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).length !== 2 ||
    !('color' in value) ||
    !('gradient' in value) ||
    typeof value.color !== 'string'
  ) {
    return false;
  }
  if (value.gradient === null) return true;
  if (!isRecord(value.gradient)) return false;
  const gradient = value.gradient;
  if (
    Object.keys(gradient).length !== 2 ||
    !('angle' in gradient) ||
    !('stops' in gradient) ||
    typeof gradient.angle !== 'number' ||
    !Number.isFinite(gradient.angle) ||
    Object.is(gradient.angle, -0) ||
    gradient.angle < 0 ||
    gradient.angle >= 360 ||
    !Array.isArray(gradient.stops) ||
    gradient.stops.length < 2 ||
    gradient.stops.length > 8
  ) {
    return false;
  }
  let previous = -Infinity;
  for (const stop of gradient.stops) {
    if (
      !isRecord(stop) ||
      Object.keys(stop).length !== 2 ||
      !('color' in stop) ||
      !('pos' in stop) ||
      typeof stop.color !== 'string' ||
      typeof stop.pos !== 'number' ||
      !Number.isFinite(stop.pos) ||
      Object.is(stop.pos, -0) ||
      stop.pos < 0 ||
      stop.pos > 1 ||
      stop.pos < previous
    ) {
      return false;
    }
    previous = stop.pos;
  }
  return gradient.stops[0]?.color === value.color;
};

export const isEditorPaintPropertyPatchV1 = (
  value: unknown,
): value is EditorPaintPropertyPatchV1 => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    [
      'backgroundPaint',
      'activeBackgroundPaint',
      'borderPaint',
      'activeBorderPaint',
    ].includes(keys[0]) &&
    isEditorPaintDescriptorV1(value[keys[0]])
  );
};

export const isEditorShadowValuePatchV1 = (
  value: unknown,
): value is ElementShadowValuePatch => {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if ('color' in value) {
    return typeof value.color === 'string' && value.color.length > 0;
  }
  if ('offsetX' in value || 'offsetY' in value) {
    const offset = 'offsetX' in value ? value.offsetX : value.offsetY;
    return (
      typeof offset === 'number' &&
      Number.isFinite(offset) &&
      offset >= -100 &&
      offset <= 100
    );
  }
  return (
    'blur' in value &&
    typeof value.blur === 'number' &&
    Number.isFinite(value.blur) &&
    value.blur >= 0 &&
    value.blur <= 100
  );
};

export const isEditorShadowPropertyPatchV1 = (
  value: unknown,
): value is EditorShadowPropertyPatchV1 => {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if ('shadowEnabled' in value) {
    return typeof value.shadowEnabled === 'boolean';
  }
  return (
    (('shadow' in value && !('activeShadow' in value)) ||
      ('activeShadow' in value && !('shadow' in value))) &&
    isEditorShadowValuePatchV1(
      'shadow' in value ? value.shadow : value.activeShadow,
    )
  );
};

function assertModeRecord(
  value: unknown,
  label: string,
  validateItem: (item: unknown, itemLabel: string) => void,
): asserts value is Record<string, unknown[]> {
  if (!isRecord(value)) {
    throw new EditorProtocolError(`${label} must be an object`);
  }
  Object.entries(value).forEach(([mode, items]) => {
    if (mode.length === 0 || !Array.isArray(items)) {
      throw new EditorProtocolError(`${label}.${mode} must be an array`);
    }
    items.forEach((item, index) =>
      validateItem(item, `${label}.${mode}[${index}]`),
    );
  });
}

const assertKeyMappings = (value: unknown, label: string): void => {
  assertModeRecord(value, label, (item, itemLabel) => {
    // 슬롯은 문자열 또는 멀티 키 객체 (KeySlot union)
    if (typeof item === 'string') return;
    if (!keySlotSchema.safeParse(item).success) {
      throw new EditorProtocolError(
        `${itemLabel} must be a string or a multi-key slot`,
      );
    }
  });
};

const normalizePositionForValidation = (value: unknown): unknown => {
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).filter(
      ([field, fieldValue]) =>
        fieldValue !== null || !NULLABLE_POSITION_FIELDS.has(field),
    ),
  );
};

const assertPosition = (value: unknown, label: string): void => {
  if (
    !keyPositionSchema.safeParse(normalizePositionForValidation(value)).success
  ) {
    throw new EditorProtocolError(`${label} is not a valid position`);
  }
};

const assertExactPosition = (
  value: unknown,
  extraKeys: readonly string[],
  label: string,
): void => {
  if (!isRecord(value)) {
    throw new EditorProtocolError(`${label} is not a valid position`);
  }
  const allowed = new Set([...KEY_POSITION_KEYS, ...extraKeys]);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) {
    throw new EditorProtocolError(`${label}.${unknownKey} is not supported`);
  }
  const parsed = keyPositionSchema.safeParse(value);
  if (!parsed.success) return;
  const assertRawKeysPreserved = (
    raw: unknown,
    canonical: unknown,
    path: string,
  ): void => {
    if (Array.isArray(raw)) {
      if (!Array.isArray(canonical)) return;
      raw.forEach((item, index) =>
        assertRawKeysPreserved(item, canonical[index], `${path}[${index}]`),
      );
      return;
    }
    if (!isRecord(raw)) return;
    if (!isRecord(canonical)) {
      throw new EditorProtocolError(`${path} has unsupported fields`);
    }
    for (const [key, child] of Object.entries(raw)) {
      if (!(key in canonical)) {
        throw new EditorProtocolError(`${path}.${key} is not supported`);
      }
      assertRawKeysPreserved(child, canonical[key], `${path}.${key}`);
    }
  };
  for (const key of Object.keys(value)) {
    if (!KEY_POSITION_KEYS.has(key)) continue;
    assertRawKeysPreserved(value[key], parsed.data[key], `${label}.${key}`);
  }
};

const assertFrozenPositionZIndex = (value: unknown, label: string): void => {
  if (!isRecord(value)) return;
  if (
    value.zIndex !== undefined &&
    (!Number.isSafeInteger(value.zIndex) ||
      (value.zIndex as number) < -2_147_483_648 ||
      (value.zIndex as number) > 2_147_483_647)
  ) {
    throw new EditorProtocolError(`${label}.zIndex is invalid`);
  }
};

const assertStatPosition = (value: unknown, label: string): void => {
  assertPosition(value, label);
  if (
    !isRecord(value) ||
    typeof value.statType !== 'string' ||
    !STAT_TYPES.has(value.statType)
  ) {
    throw new EditorProtocolError(`${label}.statType is invalid`);
  }
};

const assertGraphPosition = (value: unknown, label: string): void => {
  assertStatPosition(value, label);
  if (
    !isRecord(value) ||
    typeof value.graphType !== 'string' ||
    !GRAPH_TYPES.has(value.graphType) ||
    typeof value.graphColor !== 'string' ||
    typeof value.graphSpeed !== 'number' ||
    !Number.isSafeInteger(value.graphSpeed) ||
    value.graphSpeed < 0 ||
    value.graphSpeed > 4_294_967_295
  ) {
    throw new EditorProtocolError(`${label} has invalid graph fields`);
  }
};

const assertKnobPosition = (value: unknown, label: string): void => {
  assertPosition(value, label);
  if (
    !isRecord(value) ||
    typeof value.axisId !== 'string' ||
    typeof value.reverse !== 'boolean' ||
    typeof value.sensitivity !== 'number' ||
    !Number.isFinite(value.sensitivity)
  ) {
    throw new EditorProtocolError(`${label} has invalid knob fields`);
  }
};

const assertLayerGroups = (value: unknown, label: string): void => {
  assertModeRecord(value, label, (item, itemLabel) => {
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id.length === 0 ||
      typeof item.name !== 'string'
    ) {
      throw new EditorProtocolError(`${itemLabel} is not a valid layer group`);
    }
  });
};

const assertEditorCollections = (
  value: Record<string, unknown>,
  label: string,
  partial: boolean,
): void => {
  const validators: Record<
    EditorField,
    (value: unknown, label: string) => void
  > = {
    keys: assertKeyMappings,
    keyPositions: (collection, collectionLabel) =>
      assertModeRecord(collection, collectionLabel, assertPosition),
    statPositions: (collection, collectionLabel) =>
      assertModeRecord(collection, collectionLabel, assertStatPosition),
    graphPositions: (collection, collectionLabel) =>
      assertModeRecord(collection, collectionLabel, assertGraphPosition),
    knobPositions: (collection, collectionLabel) =>
      assertModeRecord(collection, collectionLabel, assertKnobPosition),
    layerGroups: assertLayerGroups,
  };

  EDITOR_FIELDS.forEach((field) => {
    if (value[field] === undefined) {
      if (!partial) {
        throw new EditorProtocolError(`${label}.${field} is missing`);
      }
      return;
    }
    validators[field](value[field], `${label}.${field}`);
  });
};

const assertPairedCollections = (
  value: Record<string, unknown>,
  label: string,
): void => {
  const keys = value.keys as Record<string, unknown[]>;
  const positions = value.keyPositions as Record<string, unknown[]>;
  const keyModes = Object.keys(keys).sort();
  const positionModes = Object.keys(positions).sort();
  if (
    keyModes.length !== positionModes.length ||
    keyModes.some((mode, index) => mode !== positionModes[index])
  ) {
    throw new EditorProtocolError(
      `${label}.keys and ${label}.keyPositions must contain the same modes`,
    );
  }
  keyModes.forEach((mode) => {
    if (keys[mode].length !== positions[mode].length) {
      throw new EditorProtocolError(
        `${label}.keys.${mode} and ${label}.keyPositions.${mode} must have the same length`,
      );
    }
  });
};

const assertLayerGroupReferences = (
  value: Record<string, unknown>,
  label: string,
): void => {
  const groupIdsByMode = new Map<string, Set<string>>();
  Object.entries(value.layerGroups as Record<string, unknown[]>).forEach(
    ([mode, groups]) => {
      const ids = new Set<string>();
      groups.forEach((group) => {
        const id = (group as Record<string, unknown>).id as string;
        if (ids.has(id)) {
          throw new EditorProtocolError(
            `${label}.layerGroups.${mode} contains duplicate id '${id}'`,
          );
        }
        ids.add(id);
      });
      groupIdsByMode.set(mode, ids);
    },
  );

  (
    [
      'keyPositions',
      'statPositions',
      'graphPositions',
      'knobPositions',
    ] as const
  ).forEach((field) => {
    Object.entries(value[field] as Record<string, unknown[]>).forEach(
      ([mode, positions]) => {
        positions.forEach((position, index) => {
          const groupId = (position as Record<string, unknown>).groupId;
          if (groupId === undefined || groupId === null) return;
          if (
            typeof groupId !== 'string' ||
            groupId.length === 0 ||
            !groupIdsByMode.get(mode)?.has(groupId)
          ) {
            throw new EditorProtocolError(
              `${label}.${field}.${mode}[${index}] references an unknown layer group`,
            );
          }
        });
      },
    );
  });
};

const POSITION_COLLECTION_FIELDS = [
  'keyPositions',
  'statPositions',
  'graphPositions',
  'knobPositions',
] as const;

const canonicalizePositionCollection = (
  collection: Record<string, unknown[]>,
): Record<string, unknown[]> => {
  let changed = false;
  const next: Record<string, unknown[]> = {};
  for (const [mode, items] of Object.entries(collection)) {
    if (!Array.isArray(items)) {
      next[mode] = items;
      continue;
    }
    next[mode] = items.map((item) => {
      if (!isRecord(item)) return item;
      const canonical = canonicalizePositionGradients(item);
      if (canonical !== item) changed = true;
      return canonical;
    });
  }
  return changed ? next : collection;
};

/**
 * patch/document의 gradient 형제 필드를 canonical로 정규화 — Rust 경계와 동일
 * 규칙. 반환값을 optimistic 적용·diff·invoke에 공통 사용한다 (계약 v2.3).
 * 변경이 없으면 동일 참조 반환
 */
export function canonicalizeEditorGradients<
  T extends EditorPatchV1 | EditorDocumentV1,
>(value: T): T {
  if (!isRecord(value)) return value;
  let changed = false;
  const next = { ...(value as Record<string, unknown>) };
  for (const field of POSITION_COLLECTION_FIELDS) {
    const collection = (value as Record<string, unknown>)[field];
    if (!isRecord(collection)) continue;
    const canonical = canonicalizePositionCollection(
      collection as Record<string, unknown[]>,
    );
    if (canonical !== collection) {
      changed = true;
      next[field] = canonical;
    }
  }
  return changed ? (next as T) : value;
}

export function assertEditorDocument(
  value: unknown,
  label = 'editor document',
): asserts value is EditorDocumentV1 {
  if (!isRecord(value) || value.schemaVersion !== EDITOR_SCHEMA_VERSION) {
    throw new EditorProtocolError(`${label} has an unsupported schema version`);
  }
  assertEditorCollections(value, label, false);
  assertPairedCollections(value, label);
  assertLayerGroupReferences(value, label);
}

export function assertEditorPatch(
  value: unknown,
  label = 'editor patch',
): asserts value is EditorPatchV1 {
  if (
    !isRecord(value) ||
    (value.schemaVersion !== EDITOR_SCHEMA_VERSION &&
      value.schemaVersion !== EDITOR_COMMIT_SCHEMA_VERSION)
  ) {
    throw new EditorProtocolError(`${label} has an unsupported schema version`);
  }
  const unknownKey = Object.keys(value).find(
    (key) => !EDITOR_PATCH_KEYS.has(key),
  );
  if (unknownKey) {
    throw new EditorProtocolError(`${label}.${unknownKey} is not supported`);
  }
  assertEditorCollections(value, label, true);
}

export function assertEditorFields(
  value: unknown,
  label = 'changedFields',
): asserts value is EditorField[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (field) => typeof field !== 'string' || !EDITOR_FIELD_SET.has(field),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new EditorProtocolError(`${label} contains an unknown editor field`);
  }
}

export function assertEditorGetResult(value: EditorGetResult): void {
  if (!value) {
    throw new EditorProtocolError('editor_get returned an empty result');
  }
  assertSafeEditorRevision(value.revision, 'editor_get revision');
  assertEditorDocument(value.document, 'editor_get document');
}

function assertEditorBounds(
  value: unknown,
  label: string,
): asserts value is EditorBoundsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EditorProtocolError(`${label} is invalid`);
  }
  const bounds = value as Record<string, unknown>;
  if (
    Object.keys(bounds).length !== 4 ||
    !['dx', 'dy', 'width', 'height'].every((key) => key in bounds) ||
    !Number.isFinite(bounds.dx) ||
    !Number.isFinite(bounds.dy) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    (bounds.width as number) <= 0 ||
    (bounds.height as number) <= 0
  ) {
    throw new EditorProtocolError(`${label} is invalid`);
  }
}

function assertEditorFrozenElement(
  value: unknown,
  label: string,
): asserts value is EditorFrozenElementV1 {
  if (!isRecord(value)) {
    throw new EditorProtocolError(`${label} is invalid`);
  }
  if (value.elementType === 'key') {
    assertExactKeys(value, ['elementType', 'slot', 'position'], label);
    if (typeof value.slot !== 'string') {
      if (!isRecord(value.slot)) {
        throw new EditorProtocolError(`${label}.slot is invalid`);
      }
      assertExactKeys(value.slot, ['keys', 'match'], `${label}.slot`);
    }
    if (!keySlotSchema.safeParse(value.slot).success) {
      throw new EditorProtocolError(`${label}.slot is invalid`);
    }
    if (typeof value.slot !== 'string') {
      const members = value.slot.keys as string[];
      if (
        new Set(members).size !== members.length ||
        members.some((member) => member.includes('+') || member.includes('|'))
      ) {
        throw new EditorProtocolError(`${label}.slot is invalid`);
      }
    }
    assertExactPosition(value.position, [], `${label}.position`);
    assertPosition(value.position, `${label}.position`);
    assertFrozenPositionZIndex(value.position, `${label}.position`);
    return;
  }
  assertExactKeys(value, ['elementType', 'position'], label);
  if (value.elementType === 'stat') {
    assertExactPosition(value.position, ['statType'], `${label}.position`);
    assertStatPosition(value.position, `${label}.position`);
    assertFrozenPositionZIndex(value.position, `${label}.position`);
    return;
  }
  if (value.elementType === 'graph') {
    assertExactPosition(
      value.position,
      ['statType', 'graphType', 'graphSpeed', 'graphColor', 'showAvgLine'],
      `${label}.position`,
    );
    assertGraphPosition(value.position, `${label}.position`);
    assertFrozenPositionZIndex(value.position, `${label}.position`);
    return;
  }
  if (value.elementType === 'knob') {
    assertExactPosition(
      value.position,
      ['axisId', 'sensitivity', 'reverse'],
      `${label}.position`,
    );
    assertKnobPosition(value.position, `${label}.position`);
    assertFrozenPositionZIndex(value.position, `${label}.position`);
    return;
  }
  throw new EditorProtocolError(`${label}.elementType is invalid`);
}

export function assertEditorOpsV1(
  value: unknown,
  label = 'editor ops',
): asserts value is EditorOpV1[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EditorProtocolError(`${label} must be a non-empty array`);
  }
  const soleOps = value.filter(
    (op) =>
      isRecord(op) &&
      (op.kind === 'insertFrozenElements' || op.kind === 'reorderElements'),
  );
  if (soleOps.length > 0 && value.length !== 1) {
    throw new EditorProtocolError(
      `${label} batch operation must be the sole operation`,
    );
  }
  const directTargetIds = new Set<string>();
  const assertUniqueDirectTarget = (id: string, opLabel: string) => {
    if (directTargetIds.has(id)) {
      throw new EditorProtocolError(`${opLabel} target ID is duplicated`);
    }
    directTargetIds.add(id);
  };
  value.forEach((op, index) => {
    const opLabel = `${label}[${index}]`;
    if (!isRecord(op)) throw new EditorProtocolError(`${opLabel} is invalid`);
    if (op.kind === 'setBounds') {
      assertExactKeys(op, ['kind', 'elementType', 'id', 'bounds'], opLabel);
      if (
        !['key', 'stat', 'graph', 'knob'].includes(op.elementType as string) ||
        typeof op.id !== 'string' ||
        op.id.length === 0
      ) {
        throw new EditorProtocolError(`${opLabel} target is invalid`);
      }
      assertUniqueDirectTarget(op.id, opLabel);
      assertEditorBounds(op.bounds, `${opLabel}.bounds`);
      return;
    }
    if (op.kind === 'deleteElement') {
      assertExactKeys(op, ['kind', 'elementType', 'id'], opLabel);
      if (
        !['key', 'stat', 'graph', 'knob'].includes(op.elementType as string) ||
        typeof op.id !== 'string' ||
        op.id.length === 0
      ) {
        throw new EditorProtocolError(`${opLabel} target is invalid`);
      }
      assertUniqueDirectTarget(op.id, opLabel);
      return;
    }
    if (op.kind === 'patchElement') {
      assertExactKeys(op, ['kind', 'elementType', 'id', 'patch'], opLabel);
      if (
        !['key', 'stat', 'graph', 'knob'].includes(op.elementType as string) ||
        typeof op.id !== 'string' ||
        op.id.length === 0 ||
        !isRecord(op.patch)
      ) {
        throw new EditorProtocolError(`${opLabel} target is invalid`);
      }
      assertUniqueDirectTarget(op.id, opLabel);
      const patchKeys = Object.keys(op.patch);
      const notePaintPatchValid = (
        isNotePaintPropertyPatchV1 as (value: unknown) => boolean
      )(op.patch);
      const counterFillPatchValid = (
        isCounterFillPropertyPatchV1 as (value: unknown) => boolean
      )(op.patch);
      const counterAnimationPreset = op.patch.counterAnimationPreset;
      const counterAnimationPresetValid = (() => {
        if (!isRecord(counterAnimationPreset)) return false;
        const keys = Object.keys(counterAnimationPreset);
        if (
          !keys.includes('presetId') ||
          keys.some(
            (key) =>
              ![
                'presetId',
                'applyPresetId',
                'bezier',
                'scale',
                'durationMs',
              ].includes(key),
          ) ||
          typeof counterAnimationPreset.presetId !== 'string' ||
          counterAnimationPreset.presetId.length === 0
        ) {
          return false;
        }
        if (
          'applyPresetId' in counterAnimationPreset &&
          counterAnimationPreset.applyPresetId !== true
        ) {
          return false;
        }
        if (
          'bezier' in counterAnimationPreset &&
          (!Array.isArray(counterAnimationPreset.bezier) ||
            counterAnimationPreset.bezier.length !== 4 ||
            !counterAnimationPreset.bezier.every(
              (value, index) =>
                typeof value === 'number' &&
                Number.isFinite(value) &&
                (index === 0 || index === 2
                  ? value >= 0 && value <= 1
                  : value >= -2 && value <= 2),
            ))
        ) {
          return false;
        }
        if (
          'scale' in counterAnimationPreset &&
          (typeof counterAnimationPreset.scale !== 'number' ||
            !Number.isFinite(counterAnimationPreset.scale))
        ) {
          return false;
        }
        if (
          'durationMs' in counterAnimationPreset &&
          (!Number.isSafeInteger(counterAnimationPreset.durationMs) ||
            (counterAnimationPreset.durationMs as number) < 1 ||
            (counterAnimationPreset.durationMs as number) > 5000)
        ) {
          return false;
        }
        return true;
      })();
      const patchIsValid =
        (patchKeys.length === 1 &&
          patchKeys[0] === 'hidden' &&
          typeof op.patch.hidden === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'layerName' &&
          (typeof op.patch.layerName === 'string' ||
            op.patch.layerName === null)) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'graphType' &&
          op.elementType === 'graph' &&
          (op.patch.graphType === 'line' || op.patch.graphType === 'bar')) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'graphColor' &&
          op.elementType === 'graph' &&
          typeof op.patch.graphColor === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'showAvgLine' &&
          op.elementType === 'graph' &&
          typeof op.patch.showAvgLine === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'graphAnimationEnabled' &&
          op.elementType === 'graph' &&
          typeof op.patch.graphAnimationEnabled === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'graphSpeed' &&
          op.elementType === 'graph' &&
          Number.isSafeInteger(op.patch.graphSpeed) &&
          (op.patch.graphSpeed as number) >= 0 &&
          (op.patch.graphSpeed as number) <= 4_294_967_295) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'reverse' &&
          op.elementType === 'knob' &&
          typeof op.patch.reverse === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'sensitivity' &&
          op.elementType === 'knob' &&
          typeof op.patch.sensitivity === 'number' &&
          Number.isFinite(op.patch.sensitivity)) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'axisId' &&
          op.elementType === 'knob' &&
          typeof op.patch.axisId === 'string') ||
        (isEditorPaintPropertyPatchV1(op.patch) &&
          (!('activeBackgroundPaint' in op.patch) &&
          !('activeBorderPaint' in op.patch)
            ? true
            : op.elementType === 'key' || op.elementType === 'knob')) ||
        (isEditorShadowPropertyPatchV1(op.patch) &&
          op.elementType !== 'graph' &&
          (!('activeShadow' in op.patch) ||
            op.elementType === 'key' ||
            op.elementType === 'knob')) ||
        (notePaintPatchValid && op.elementType === 'key') ||
        (counterFillPatchValid &&
          (op.elementType === 'key' ||
            (!('counterFillActive' in op.patch) &&
              op.elementType === 'stat'))) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'displayText' &&
          typeof op.patch.displayText === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'className' &&
          typeof op.patch.className === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'borderWidth' &&
          typeof op.patch.borderWidth === 'number' &&
          Number.isFinite(op.patch.borderWidth) &&
          op.patch.borderWidth >= 0 &&
          op.patch.borderWidth <= 20) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'borderRadius' &&
          typeof op.patch.borderRadius === 'number' &&
          Number.isFinite(op.patch.borderRadius) &&
          op.patch.borderRadius >= 0 &&
          op.patch.borderRadius <= (op.elementType === 'knob' ? 999 : 100)) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'fontSize' &&
          typeof op.patch.fontSize === 'number' &&
          Number.isFinite(op.patch.fontSize) &&
          op.patch.fontSize >= 8 &&
          op.patch.fontSize <= 72) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteGlowSize' &&
          op.elementType === 'key' &&
          typeof op.patch.noteGlowSize === 'number' &&
          Number.isFinite(op.patch.noteGlowSize) &&
          op.patch.noteGlowSize >= 0 &&
          op.patch.noteGlowSize <= 50) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteOffsetX' &&
          op.elementType === 'key' &&
          (op.patch.noteOffsetX === null ||
            (typeof op.patch.noteOffsetX === 'number' &&
              Number.isFinite(op.patch.noteOffsetX) &&
              op.patch.noteOffsetX >= -500 &&
              op.patch.noteOffsetX <= 500))) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteOffsetY' &&
          op.elementType === 'key' &&
          (op.patch.noteOffsetY === null ||
            (typeof op.patch.noteOffsetY === 'number' &&
              Number.isFinite(op.patch.noteOffsetY) &&
              op.patch.noteOffsetY >= -500 &&
              op.patch.noteOffsetY <= 500))) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteWidth' &&
          op.elementType === 'key' &&
          (op.patch.noteWidth === null ||
            (typeof op.patch.noteWidth === 'number' &&
              Number.isFinite(op.patch.noteWidth) &&
              op.patch.noteWidth > 0))) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteBorderWidth' &&
          op.elementType === 'key' &&
          typeof op.patch.noteBorderWidth === 'number' &&
          Number.isFinite(op.patch.noteBorderWidth) &&
          op.patch.noteBorderWidth >= 0 &&
          op.patch.noteBorderWidth <= 20) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteBorderRadius' &&
          op.elementType === 'key' &&
          typeof op.patch.noteBorderRadius === 'number' &&
          Number.isFinite(op.patch.noteBorderRadius) &&
          op.patch.noteBorderRadius >= 1 &&
          op.patch.noteBorderRadius <= 100) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'soundEnabled' &&
          op.elementType === 'key' &&
          typeof op.patch.soundEnabled === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'soundPath' &&
          op.elementType === 'key' &&
          typeof op.patch.soundPath === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'soundVolume' &&
          op.elementType === 'key' &&
          typeof op.patch.soundVolume === 'number' &&
          Number.isFinite(op.patch.soundVolume) &&
          op.patch.soundVolume >= 0 &&
          op.patch.soundVolume <= 200) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'inactiveImage' &&
          typeof op.patch.inactiveImage === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'activeImage' &&
          (op.elementType === 'key' || op.elementType === 'knob') &&
          typeof op.patch.activeImage === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'idleTransparent' &&
          typeof op.patch.idleTransparent === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'activeTransparent' &&
          (op.elementType === 'key' || op.elementType === 'knob') &&
          typeof op.patch.activeTransparent === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'idleImageFit' &&
          ['cover', 'contain', 'fill', 'none'].includes(
            op.patch.idleImageFit as string,
          )) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'activeImageFit' &&
          (op.elementType === 'key' || op.elementType === 'knob') &&
          ['cover', 'contain', 'fill', 'none'].includes(
            op.patch.activeImageFit as string,
          )) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterEnabled' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterEnabled === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterAnimationEnabled' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterAnimationEnabled === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterPlacement' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          (op.patch.counterPlacement === 'inside' ||
            op.patch.counterPlacement === 'outside')) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterAlign' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          ['top', 'bottom', 'left', 'right'].includes(
            op.patch.counterAlign as string,
          )) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterAlignMode' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          (op.patch.counterAlignMode === 'center' ||
            op.patch.counterAlignMode === 'between')) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterGap' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          Number.isSafeInteger(op.patch.counterGap) &&
          (op.patch.counterGap as number) >= 0 &&
          (op.patch.counterGap as number) <= 4_294_967_295) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterFontSize' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          Number.isSafeInteger(op.patch.counterFontSize) &&
          (op.patch.counterFontSize as number) >= 8 &&
          (op.patch.counterFontSize as number) <= 72) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterFontWeight' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          Number.isSafeInteger(op.patch.counterFontWeight) &&
          (op.patch.counterFontWeight as number) >= 100 &&
          (op.patch.counterFontWeight as number) <= 900) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterFontItalic' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterFontItalic === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterFontUnderline' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterFontUnderline === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterFontStrikethrough' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterFontStrikethrough === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterFontFamily' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterFontFamily === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterStrokeIdle' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          typeof op.patch.counterStrokeIdle === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterStrokeActive' &&
          op.elementType === 'key' &&
          typeof op.patch.counterStrokeActive === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'counterAnimationPreset' &&
          (op.elementType === 'key' || op.elementType === 'stat') &&
          counterAnimationPresetValid) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'useInlineStyles' &&
          typeof op.patch.useInlineStyles === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'fontWeight' &&
          Number.isSafeInteger(op.patch.fontWeight) &&
          (op.patch.fontWeight as number) >= 0 &&
          (op.patch.fontWeight as number) <= 4_294_967_295) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'fontItalic' &&
          typeof op.patch.fontItalic === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'fontUnderline' &&
          typeof op.patch.fontUnderline === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'fontStrikethrough' &&
          typeof op.patch.fontStrikethrough === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'fontFamily' &&
          typeof op.patch.fontFamily === 'string') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteEffectEnabled' &&
          op.elementType === 'key' &&
          typeof op.patch.noteEffectEnabled === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteAutoYCorrection' &&
          op.elementType === 'key' &&
          typeof op.patch.noteAutoYCorrection === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteGlowEnabled' &&
          op.elementType === 'key' &&
          typeof op.patch.noteGlowEnabled === 'boolean') ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteAlignment' &&
          op.elementType === 'key' &&
          ['left', 'center', 'right'].includes(
            op.patch.noteAlignment as string,
          )) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'noteBorderSide' &&
          op.elementType === 'key' &&
          ['all', 'vertical', 'horizontal'].includes(
            op.patch.noteBorderSide as string,
          )) ||
        (patchKeys.length === 1 &&
          patchKeys[0] === 'statType' &&
          op.elementType === 'stat' &&
          STAT_TYPES.has(op.patch.statType as string));
      if (!patchIsValid) {
        throw new EditorProtocolError(`${opLabel}.patch is invalid`);
      }
      return;
    }
    if (op.kind === 'setKeySlot') {
      assertExactKeys(op, ['kind', 'id', 'slot'], opLabel);
      if (typeof op.slot !== 'string') {
        if (!isRecord(op.slot)) {
          throw new EditorProtocolError(`${opLabel}.slot is invalid`);
        }
        assertExactKeys(op.slot, ['keys', 'match'], `${opLabel}.slot`);
      }
      const parsedSlot = keySlotSchema.safeParse(op.slot);
      if (
        typeof op.id !== 'string' ||
        op.id.length === 0 ||
        !parsedSlot.success
      ) {
        throw new EditorProtocolError(`${opLabel} is invalid`);
      }
      if (typeof parsedSlot.data !== 'string') {
        const uniqueMembers = new Set(parsedSlot.data.keys);
        if (
          uniqueMembers.size !== parsedSlot.data.keys.length ||
          parsedSlot.data.keys.some(
            (member) => member.includes('+') || member.includes('|'),
          )
        ) {
          throw new EditorProtocolError(`${opLabel}.slot is not canonical`);
        }
      }
      assertUniqueDirectTarget(op.id, opLabel);
      return;
    }
    if (op.kind === 'reorderElements') {
      assertExactKeys(
        op,
        ['kind', 'mode', 'zUpdates', 'groupUpdates', 'completeModeOrder'],
        opLabel,
      );
      if (
        typeof op.mode !== 'string' ||
        op.mode.length === 0 ||
        new TextEncoder().encode(op.mode).length > 128 ||
        !Array.isArray(op.zUpdates) ||
        !Array.isArray(op.groupUpdates) ||
        typeof op.completeModeOrder !== 'boolean' ||
        op.zUpdates.length === 0 ||
        op.zUpdates.length > 4096 ||
        op.groupUpdates.length > 4096 ||
        (!op.completeModeOrder && op.groupUpdates.length > 0)
      ) {
        throw new EditorProtocolError(`${opLabel} is invalid`);
      }
      const assertTarget = (
        target: Record<string, unknown>,
        targetLabel: string,
      ) => {
        if (
          !['key', 'stat', 'graph', 'knob'].includes(
            target.elementType as string,
          ) ||
          typeof target.id !== 'string' ||
          target.id.length === 0
        ) {
          throw new EditorProtocolError(`${targetLabel} target is invalid`);
        }
      };
      const zTypesById = new Map<string, EditorElementTypeV1>();
      op.zUpdates.forEach((update, updateIndex) => {
        const updateLabel = `${opLabel}.zUpdates[${updateIndex}]`;
        if (!isRecord(update)) {
          throw new EditorProtocolError(`${updateLabel} is invalid`);
        }
        assertExactKeys(update, ['elementType', 'id', 'zIndex'], updateLabel);
        assertTarget(update, updateLabel);
        if (
          !Number.isSafeInteger(update.zIndex) ||
          (update.zIndex as number) < -2_147_483_648 ||
          (update.zIndex as number) > 2_147_483_647 ||
          zTypesById.has(update.id as string)
        ) {
          throw new EditorProtocolError(`${updateLabel} is invalid`);
        }
        zTypesById.set(
          update.id as string,
          update.elementType as EditorElementTypeV1,
        );
      });
      const groupIds = new Set<string>();
      op.groupUpdates.forEach((update, updateIndex) => {
        const updateLabel = `${opLabel}.groupUpdates[${updateIndex}]`;
        if (!isRecord(update)) {
          throw new EditorProtocolError(`${updateLabel} is invalid`);
        }
        assertExactKeys(update, ['elementType', 'id', 'groupId'], updateLabel);
        assertTarget(update, updateLabel);
        if (
          (update.groupId !== null &&
            (typeof update.groupId !== 'string' ||
              update.groupId.length === 0 ||
              update.groupId.length > 256)) ||
          zTypesById.get(update.id as string) !== update.elementType ||
          groupIds.has(update.id as string)
        ) {
          throw new EditorProtocolError(`${updateLabel} is invalid`);
        }
        groupIds.add(update.id as string);
      });
      return;
    }
    if (op.kind !== 'insertFrozenElements') {
      throw new EditorProtocolError(`${opLabel}.kind is invalid`);
    }
    assertExactKeys(
      op,
      ['kind', 'mode', 'elements', 'groups', 'zUpdates'],
      opLabel,
    );
    if (
      typeof op.mode !== 'string' ||
      op.mode.length === 0 ||
      !Array.isArray(op.elements) ||
      !Array.isArray(op.groups) ||
      !Array.isArray(op.zUpdates) ||
      (op.elements.length === 0 && op.zUpdates.length === 0)
    ) {
      throw new EditorProtocolError(`${opLabel} is invalid`);
    }
    const insertedIds = new Set<string>();
    op.elements.forEach((element, elementIndex) => {
      assertEditorFrozenElement(
        element,
        `${opLabel}.elements[${elementIndex}]`,
      );
      const id = element.position.id;
      if (typeof id !== 'string' || id.length === 0 || insertedIds.has(id)) {
        throw new EditorProtocolError(
          `${opLabel}.elements contains an invalid or duplicate ID`,
        );
      }
      insertedIds.add(id);
    });
    const groupIds = new Set<string>();
    op.groups.forEach((group, groupIndex) => {
      const groupLabel = `${opLabel}.groups[${groupIndex}]`;
      if (!isRecord(group)) {
        throw new EditorProtocolError(`${groupLabel} is invalid`);
      }
      assertExactKeys(group, ['id', 'name'], groupLabel);
      if (
        typeof group.id !== 'string' ||
        group.id.length === 0 ||
        typeof group.name !== 'string' ||
        groupIds.has(group.id)
      ) {
        throw new EditorProtocolError(`${groupLabel} is invalid`);
      }
      groupIds.add(group.id);
    });
    const updateIds = new Set<string>();
    op.zUpdates.forEach((update, updateIndex) => {
      const updateLabel = `${opLabel}.zUpdates[${updateIndex}]`;
      if (!isRecord(update)) {
        throw new EditorProtocolError(`${updateLabel} is invalid`);
      }
      assertExactKeys(update, ['elementType', 'id', 'zIndex'], updateLabel);
      if (
        !['key', 'stat', 'graph', 'knob'].includes(
          update.elementType as string,
        ) ||
        typeof update.id !== 'string' ||
        update.id.length === 0 ||
        !Number.isSafeInteger(update.zIndex) ||
        (update.zIndex as number) < -2_147_483_648 ||
        (update.zIndex as number) > 2_147_483_647 ||
        updateIds.has(update.id) ||
        insertedIds.has(update.id)
      ) {
        throw new EditorProtocolError(`${updateLabel} is invalid`);
      }
      updateIds.add(update.id);
    });
  });
}

export function assertEditorCommitResult(
  value: EditorCommitResult,
  expectedOpCount?: number,
): void {
  if (!value) {
    throw new EditorProtocolError('editor_commit returned an empty result');
  }
  assertSafeEditorRevision(value.revision, 'editor_commit revision');
  assertEditorFields(value.changedFields, 'editor_commit changedFields');
  if (expectedOpCount === undefined) {
    if (value.opResults !== undefined) {
      throw new EditorProtocolError(
        'editor_commit patch result contains opResults',
      );
    }
    return;
  }
  if (
    !Array.isArray(value.opResults) ||
    value.opResults.length !== expectedOpCount
  ) {
    throw new EditorProtocolError(
      'editor_commit opResults does not match requested ops',
    );
  }
  value.opResults.forEach((result, index) => {
    if (!result || typeof result !== 'object') {
      throw new EditorProtocolError(
        `editor_commit opResults[${index}] is invalid`,
      );
    }
    if (result.status === 'targetMissing') {
      if ('bounds' in result && result.bounds !== undefined) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] targetMissing contains bounds`,
        );
      }
      return;
    }
    if (result.status !== 'applied' && result.status !== 'noChange') {
      throw new EditorProtocolError(
        `editor_commit opResults[${index}] has an unknown status`,
      );
    }
    if (result.bounds !== undefined) {
      assertEditorBounds(
        result.bounds,
        `editor_commit opResults[${index}].bounds`,
      );
    }
  });
}

export function assertEditorOpCommitResult(
  value: EditorCommitResult,
  ops: readonly EditorOpV1[],
): void {
  assertEditorCommitResult(value, ops.length);
  const opResults = value.opResults!;
  const positionFields: Record<EditorElementTypeV1, EditorField> = {
    key: 'keyPositions',
    stat: 'statPositions',
    graph: 'graphPositions',
    knob: 'knobPositions',
  };
  const requiredFields = new Set<EditorField>();
  const allowedFields = new Set<EditorField>();
  ops.forEach((op, index) => {
    const result = opResults[index];
    if (op.kind === 'setBounds') {
      if (
        result.status !== 'targetMissing' &&
        ((result.status !== 'applied' && result.status !== 'noChange') ||
          result.bounds === undefined)
      ) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] is invalid for setBounds`,
        );
      }
      if (result.status === 'applied') {
        requiredFields.add(positionFields[op.elementType]);
        allowedFields.add(positionFields[op.elementType]);
      }
      return;
    }
    if (op.kind === 'deleteElement') {
      if (
        result.status === 'noChange' ||
        ('bounds' in result && result.bounds !== undefined)
      ) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] is invalid for deleteElement`,
        );
      }
      if (result.status !== 'applied') return;
      requiredFields.add(positionFields[op.elementType]);
      allowedFields.add(positionFields[op.elementType]);
      allowedFields.add('layerGroups');
      if (op.elementType === 'key') {
        requiredFields.add('keys');
        allowedFields.add('keys');
      }
      return;
    }
    if (op.kind === 'patchElement' || op.kind === 'setKeySlot') {
      if ('bounds' in result && result.bounds !== undefined) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] is invalid for ${op.kind}`,
        );
      }
      if (result.status === 'applied') {
        const field =
          op.kind === 'setKeySlot' ? 'keys' : positionFields[op.elementType];
        requiredFields.add(field);
        allowedFields.add(field);
      }
      return;
    }
    if (op.kind === 'reorderElements') {
      if (
        result.status === 'targetMissing' ||
        ('bounds' in result && result.bounds !== undefined)
      ) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] is invalid for reorderElements`,
        );
      }
      const touched = new Set<EditorField>();
      op.zUpdates.forEach((update) =>
        touched.add(positionFields[update.elementType]),
      );
      op.groupUpdates.forEach((update) =>
        touched.add(positionFields[update.elementType]),
      );
      if (op.completeModeOrder) touched.add('layerGroups');
      touched.forEach((field) => allowedFields.add(field));
      if (result.status === 'noChange') {
        if (value.changedFields.length !== 0) {
          throw new EditorProtocolError(
            'editor ops changedFields does not match opResults',
          );
        }
        return;
      }
      if (value.changedFields.length === 0) {
        throw new EditorProtocolError(
          'editor ops changedFields does not match opResults',
        );
      }
      return;
    }
    if (
      result.status === 'targetMissing' ||
      ('bounds' in result && result.bounds !== undefined)
    ) {
      throw new EditorProtocolError(
        `editor_commit opResults[${index}] is invalid for insertFrozenElements`,
      );
    }
    const touched = new Set<EditorField>();
    op.elements.forEach((element) => {
      touched.add(positionFields[element.elementType]);
      if (element.elementType === 'key') touched.add('keys');
    });
    op.zUpdates.forEach((update) =>
      touched.add(positionFields[update.elementType]),
    );
    if (op.groups.length > 0) touched.add('layerGroups');
    touched.forEach((field) => allowedFields.add(field));
    if (result.status === 'noChange') {
      if (value.changedFields.length !== 0) {
        throw new EditorProtocolError(
          'editor ops changedFields does not match opResults',
        );
      }
      return;
    }
    op.elements.forEach((element) => {
      requiredFields.add(positionFields[element.elementType]);
      if (element.elementType === 'key') requiredFields.add('keys');
    });
    if (op.groups.length > 0) requiredFields.add('layerGroups');
    if (value.changedFields.length === 0) {
      throw new EditorProtocolError(
        'editor ops changedFields does not match opResults',
      );
    }
  });
  if (
    [...requiredFields].some((field) => !value.changedFields.includes(field)) ||
    new Set(value.changedFields).size !== value.changedFields.length ||
    value.changedFields.some((field) => !allowedFields.has(field))
  ) {
    throw new EditorProtocolError(
      'editor ops changedFields does not match opResults',
    );
  }
}

export function assertEditorCommittedEvent(value: EditorCommittedV1): void {
  if (!value || value.schemaVersion !== EDITOR_SCHEMA_VERSION) {
    throw new EditorProtocolError(
      'editor:committed has an unsupported schema version',
    );
  }
  assertSafeEditorRevision(value.revision, 'editor:committed revision');
  if (typeof value.mutationId !== 'string' || value.mutationId.length === 0) {
    throw new EditorProtocolError('editor:committed mutationId is invalid');
  }
  if (
    value.gestureIds !== undefined &&
    (!Array.isArray(value.gestureIds) ||
      value.gestureIds.some((gestureId) => typeof gestureId !== 'string') ||
      new Set(value.gestureIds).size !== value.gestureIds.length)
  ) {
    throw new EditorProtocolError('editor:committed gestureIds is invalid');
  }
  assertEditorFields(value.changedFields, 'editor:committed changedFields');
  assertEditorPatch(value.patch, 'editor:committed patch');
  const patchFields = EDITOR_FIELDS.filter(
    (field) => value.patch[field] !== undefined,
  );
  if (
    patchFields.length !== value.changedFields.length ||
    patchFields.some((field) => !value.changedFields.includes(field))
  ) {
    throw new EditorProtocolError(
      'editor:committed patch does not match changedFields',
    );
  }
}

export function isEditorCommitError(
  value: unknown,
): value is EditorCommitError {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<EditorCommitError>;
  return (
    typeof candidate.errorCode === 'string' &&
    EDITOR_ERROR_CODES.has(candidate.errorCode as EditorCommitErrorCode) &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  );
}
