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
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import type { ElementShadowValuePatch } from '@src/types/key/shadows';
import {
  isNoteBorderPaintValueV1,
  isNotePaintValuePatchV1,
  type NoteBorderPaintValueV1,
  type NotePaintPropertyPatchV1,
  type NotePaintValuePatchV1,
} from '@src/types/key/notePaint';
import {
  isCounterFillDescriptorV1,
  type CounterFillDescriptorV1,
  type CounterFillPropertyPatchV1,
} from '@src/types/key/counterFill';
import { type FontColorPropertyPatchV1 } from '@src/types/key/fontColor';
import {
  canonicalizePositionGradients,
  type PaintDescriptorV1,
} from '@src/types/color';

export const EDITOR_SCHEMA_VERSION = 1 as const;

// 쓰기(commit) 전용 버전. 문서(editor_get)와 이벤트(editor:committed)는 v1을
// 유지하고 id를 additive로 싣는다. v2 커밋은 포함된 모든 위치 항목에 유효 ID가
// 필수라 백엔드가 형식·전역 유일성을 강제한다. 구형 플러그인 gateway만 v1로 남는다
export const EDITOR_COMMIT_SCHEMA_VERSION = 2 as const;
export const EDITOR_OPS_VERSION = 2 as const;

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

export type CanonicalKeyPosition = KeyPosition & { id: string };
export type CanonicalStatItemPosition = StatItemPosition & { id: string };
export type CanonicalGraphItemPosition = GraphItemPosition & { id: string };
export type CanonicalKnobItemPosition = KnobItemPosition & { id: string };

export interface CanonicalEditorDocumentV1
  extends Omit<
    EditorDocumentV1,
    'keyPositions' | 'statPositions' | 'graphPositions' | 'knobPositions'
  > {
  keyPositions: Record<string, CanonicalKeyPosition[]>;
  statPositions: Record<string, CanonicalStatItemPosition[]>;
  graphPositions: Record<string, CanonicalGraphItemPosition[]>;
  knobPositions: Record<string, CanonicalKnobItemPosition[]>;
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
  | { elementType: 'key'; slot: KeySlot; position: CanonicalKeyPosition }
  | { elementType: 'stat'; position: CanonicalStatItemPosition }
  | { elementType: 'graph'; position: CanonicalGraphItemPosition }
  | { elementType: 'knob'; position: CanonicalKnobItemPosition };

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

export interface EditorElementGroupTargetV1 {
  elementType: EditorElementTypeV1;
  id: string;
}

export type EditorTargetLayerGroupV1 =
  | { kind: 'existing'; id: string }
  | { kind: 'create'; id: string; name: string };

export interface EditorSetElementGroupsOpV1 {
  kind: 'setElementGroups';
  mode: string;
  targets: EditorElementGroupTargetV1[];
  targetGroup: EditorTargetLayerGroupV1 | null;
}

export interface EditorRenameLayerGroupOpV1 {
  kind: 'renameLayerGroup';
  mode: string;
  groupId: string;
  name: string;
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
  fontColor: string;
  activeFontColor: string;
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

export type EditorElementPropertyKeyV1 = keyof EditorElementPropertyValuesV1;

// wire 판별 유니온: { property, value } adjacently tagged 형식 (Rust enum과 동일)
type EditorPropertyPatchUnionV1<K extends EditorElementPropertyKeyV1> = {
  [P in K]: { property: P; value: EditorElementPropertyValuesV1[P] };
}[K];

// canonical property 태그 목록, Rust enum 선언 순서와 동일하게 유지
// (tests/fixtures/editor-property-tags.json과 파리티 테스트로 대조)
export const EDITOR_ELEMENT_PROPERTY_KEYS = [
  'hidden',
  'layerName',
  'graphType',
  'graphColor',
  'showAvgLine',
  'graphAnimationEnabled',
  'graphSpeed',
  'reverse',
  'sensitivity',
  'axisId',
  'useInlineStyles',
  'fontWeight',
  'fontItalic',
  'fontUnderline',
  'fontStrikethrough',
  'fontFamily',
  'displayText',
  'className',
  'fontColor',
  'activeFontColor',
  'shadow',
  'activeShadow',
  'shadowEnabled',
  'backgroundPaint',
  'activeBackgroundPaint',
  'borderPaint',
  'activeBorderPaint',
  'borderWidth',
  'borderRadius',
  'fontSize',
  'inactiveImage',
  'activeImage',
  'idleTransparent',
  'activeTransparent',
  'idleImageFit',
  'activeImageFit',
  'soundPath',
  'soundEnabled',
  'soundVolume',
  'counterEnabled',
  'counterAnimationEnabled',
  'counterPlacement',
  'counterAlign',
  'counterAlignMode',
  'counterGap',
  'counterFontSize',
  'counterFontWeight',
  'counterFontItalic',
  'counterFontUnderline',
  'counterFontStrikethrough',
  'counterFontFamily',
  'counterFillIdle',
  'counterFillActive',
  'counterStrokeIdle',
  'counterStrokeActive',
  'counterAnimationPreset',
  'statType',
  'noteEffectEnabled',
  'noteGlowEnabled',
  'noteGlowSize',
  'notePaint',
  'noteGlowPaint',
  'noteBorderPaint',
  'noteOffsetX',
  'noteOffsetY',
  'noteWidth',
  'noteBorderWidth',
  'noteBorderRadius',
  'noteAutoYCorrection',
  'noteAlignment',
  'noteBorderSide',
] as const satisfies readonly EditorElementPropertyKeyV1[];

type AssertNever<T extends never> = T;
// canonical 배열에서 property가 하나라도 빠지면 컴파일 에러
export type EditorPropertyKeysCompleteness = AssertNever<
  Exclude<
    EditorElementPropertyKeyV1,
    (typeof EDITOR_ELEMENT_PROPERTY_KEYS)[number]
  >
>;

const EDITOR_ELEMENT_PROPERTY_KEY_SET = new Set<string>(
  EDITOR_ELEMENT_PROPERTY_KEYS,
);

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

export type EditorFontColorPropertyPatchV1 = FontColorPropertyPatchV1;

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
  | EditorSetElementGroupsOpV1
  | EditorRenameLayerGroupOpV1
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

export interface CanonicalEditorGetResult
  extends Omit<EditorGetResult, 'document'> {
  document: CanonicalEditorDocumentV1;
}

export interface EditorCommittedV1 {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  revision: number;
  mutationId: string;
  origin?: string;
  changedFields: EditorField[];
  // 이벤트는 v1 고정 - 커밋 요청 전용 v2를 타입에서 배제한다
  patch: EditorLegacyPatchV1;
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

export type EditorCommitErrorRetryPolicy = 'transient' | 'permanent' | 'rebase';

// 오류 코드별 재시도 정책 단일 테이블. 백엔드 errors.rs 생성자의 retryable
// 상수와 파리티 (tests/fixtures/editor-error-retry.json 대조 테스트로 고정).
// rebase는 base 재동기화 후 재시도 - 소비처에서는 transient와 같은 재시도군.
// 코드를 추가할 때는 여기에 정책과 함께 등록한다 (인식 집합도 이 키에서 파생)
export const EDITOR_COMMIT_ERROR_RETRY_POLICY = {
  REVISION_CONFLICT: 'rebase',
  PLUGIN_REVISION_CONFLICT: 'transient',
  VALIDATION_FAILED: 'permanent',
  TOO_MANY_GESTURE_IDS: 'permanent',
  INVALID_GESTURE_ID: 'permanent',
  PAIRED_UPDATE_REQUIRED: 'permanent',
  MUTATION_ID_REUSED: 'permanent',
  IO_ERROR: 'transient',
  HISTORY_IN_PROGRESS: 'transient',
  HISTORY_EPOCH_CONFLICT: 'transient',
  MULTI_KEY_UNSUPPORTED: 'permanent',
} as const satisfies Record<
  EditorCommitErrorCode,
  EditorCommitErrorRetryPolicy
>;

// 재시도 판단은 wire의 retryable 플래그가 아니라 이 테이블이 결정한다
export const isRetryableEditorCommitError = (
  error: EditorCommitError,
): boolean => EDITOR_COMMIT_ERROR_RETRY_POLICY[error.errorCode] !== 'permanent';

// 백엔드가 VALIDATION_FAILED의 details.validationCode로 싣는 코드 중 "저장 한도
// 초과" 계열. 목록에서 빠진 코드는 한도 안내 대신 일반 오류 안내로 새어 나가므로
// 오류 코드 동기화 규칙 대상이 되도록 여기에 둔다 (tests/fixtures 공유 fixture로 고정)
export const EDITOR_CAPACITY_VALIDATION_CODES: ReadonlySet<string> = new Set([
  'COLLECTION_TOO_LARGE',
  'TOO_MANY_RENDER_ITEMS',
  'TOO_MANY_LAYER_GROUPS',
  'TOO_MANY_SLOTS_PER_MEMBER',
  'REQUEST_TOO_LARGE',
  'HISTORY_ENTRY_TOO_LARGE',
  // validate_count_limit 계열인데 위 셋과 달리 빠져 있던 코드
  'TOO_MANY_MODES',
  'TOO_MANY_CUSTOM_TABS',
  // validate_saved_plugin_instances -> gesture 커밋에서 validationCode로 승격
  'TOO_MANY_PLUGIN_INSTANCES',
]);

export const isEditorCapacityFailure = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'errorCode' in error &&
  error.errorCode === 'VALIDATION_FAILED' &&
  'retryable' in error &&
  error.retryable === false &&
  'details' in error &&
  typeof error.details === 'object' &&
  error.details !== null &&
  'validationCode' in error.details &&
  typeof error.details.validationCode === 'string' &&
  EDITOR_CAPACITY_VALIDATION_CODES.has(error.details.validationCode);

const EDITOR_ERROR_CODES = new Set<EditorCommitErrorCode>(
  Object.keys(EDITOR_COMMIT_ERROR_RETRY_POLICY) as EditorCommitErrorCode[],
);

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

const isTaggedPatchRecord = (
  value: unknown,
): value is Record<string, unknown> & { property: unknown; value: unknown } =>
  isRecord(value) &&
  Object.keys(value).length === 2 &&
  'property' in value &&
  'value' in value;

export const isEditorPaintPropertyPatchV1 = (
  value: unknown,
): value is EditorPaintPropertyPatchV1 =>
  isTaggedPatchRecord(value) &&
  [
    'backgroundPaint',
    'activeBackgroundPaint',
    'borderPaint',
    'activeBorderPaint',
  ].includes(value.property as string) &&
  isEditorPaintDescriptorV1(value.value);

export const isEditorShadowValuePatchV1 = (
  value: unknown,
): value is ElementShadowValuePatch => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !('leaf' in value) ||
    !('value' in value)
  ) {
    return false;
  }
  if (value.leaf === 'color') {
    return typeof value.value === 'string' && value.value.length > 0;
  }
  if (value.leaf === 'offsetX' || value.leaf === 'offsetY') {
    return (
      typeof value.value === 'number' &&
      Number.isFinite(value.value) &&
      value.value >= -100 &&
      value.value <= 100
    );
  }
  return (
    value.leaf === 'blur' &&
    typeof value.value === 'number' &&
    Number.isFinite(value.value) &&
    value.value >= 0 &&
    value.value <= 100
  );
};

export const isEditorShadowPropertyPatchV1 = (
  value: unknown,
): value is EditorShadowPropertyPatchV1 => {
  if (!isTaggedPatchRecord(value)) return false;
  if (value.property === 'shadowEnabled') {
    return typeof value.value === 'boolean';
  }
  return (
    (value.property === 'shadow' || value.property === 'activeShadow') &&
    isEditorShadowValuePatchV1(value.value)
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

const assertPosition: (
  value: unknown,
  label: string,
) => asserts value is KeyPosition = (value: unknown, label: string) => {
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

const assertStatPosition: (
  value: unknown,
  label: string,
) => asserts value is StatItemPosition = (value: unknown, label: string) => {
  assertPosition(value, label);
  const raw = value as KeyPosition & Record<string, unknown>;
  if (typeof raw.statType !== 'string' || !STAT_TYPES.has(raw.statType)) {
    throw new EditorProtocolError(`${label}.statType is invalid`);
  }
};

const assertGraphPosition: (
  value: unknown,
  label: string,
) => asserts value is GraphItemPosition = (value: unknown, label: string) => {
  assertStatPosition(value, label);
  const raw = value as StatItemPosition & Record<string, unknown>;
  if (
    typeof raw.graphType !== 'string' ||
    !GRAPH_TYPES.has(raw.graphType) ||
    typeof raw.graphColor !== 'string' ||
    typeof raw.graphSpeed !== 'number' ||
    !Number.isSafeInteger(raw.graphSpeed) ||
    raw.graphSpeed < 0 ||
    raw.graphSpeed > 4_294_967_295
  ) {
    throw new EditorProtocolError(`${label} has invalid graph fields`);
  }
};

const assertKnobPosition: (
  value: unknown,
  label: string,
) => asserts value is KnobItemPosition = (value: unknown, label: string) => {
  assertPosition(value, label);
  const raw = value as KeyPosition & Record<string, unknown>;
  if (
    typeof raw.axisId !== 'string' ||
    typeof raw.reverse !== 'boolean' ||
    typeof raw.sensitivity !== 'number' ||
    !Number.isFinite(raw.sensitivity)
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

export function assertCanonicalEditorDocument(
  value: unknown,
  label = 'canonical editor document',
): asserts value is CanonicalEditorDocumentV1 {
  assertEditorDocument(value, label);
  const document = value as EditorDocumentV1;
  const seen = new Set<string>();
  const collections = [
    ['keyPositions', document.keyPositions],
    ['statPositions', document.statPositions],
    ['graphPositions', document.graphPositions],
    ['knobPositions', document.knobPositions],
  ] as const;
  for (const [field, collection] of collections) {
    for (const [mode, positions] of Object.entries(collection)) {
      for (const [index, position] of positions.entries()) {
        if (!isNativeElementId(position.id)) {
          throw new EditorProtocolError(
            `${label}.${field}.${mode}[${index}].id is invalid`,
          );
        }
        if (seen.has(position.id)) {
          throw new EditorProtocolError(
            `${label}.${field}.${mode}[${index}].id is not globally unique`,
          );
        }
        seen.add(position.id);
      }
    }
  }
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

export function assertEditorGetResult(
  value: EditorGetResult,
): asserts value is CanonicalEditorGetResult {
  if (!value) {
    throw new EditorProtocolError('editor_get returned an empty result');
  }
  assertSafeEditorRevision(value.revision, 'editor_get revision');
  assertCanonicalEditorDocument(value.document, 'editor_get document');
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
    if (!isNativeElementId(value.position.id)) {
      throw new EditorProtocolError(`${label}.position.id is invalid`);
    }
    assertFrozenPositionZIndex(value.position, `${label}.position`);
    return;
  }
  assertExactKeys(value, ['elementType', 'position'], label);
  if (value.elementType === 'stat') {
    assertExactPosition(value.position, ['statType'], `${label}.position`);
    assertStatPosition(value.position, `${label}.position`);
    if (!isNativeElementId(value.position.id)) {
      throw new EditorProtocolError(`${label}.position.id is invalid`);
    }
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
    if (!isNativeElementId(value.position.id)) {
      throw new EditorProtocolError(`${label}.position.id is invalid`);
    }
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
    if (!isNativeElementId(value.position.id)) {
      throw new EditorProtocolError(`${label}.position.id is invalid`);
    }
    assertFrozenPositionZIndex(value.position, `${label}.position`);
    return;
  }
  throw new EditorProtocolError(`${label}.elementType is invalid`);
}

export const isEditorCounterAnimationPresetIntentV1 = (
  value: unknown,
): value is EditorCounterAnimationPresetIntentV1 => {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
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
    typeof value.presetId !== 'string' ||
    value.presetId.length === 0
  ) {
    return false;
  }
  if ('applyPresetId' in value && value.applyPresetId !== true) {
    return false;
  }
  if (
    'bezier' in value &&
    (!Array.isArray(value.bezier) ||
      value.bezier.length !== 4 ||
      !value.bezier.every(
        (item, index) =>
          typeof item === 'number' &&
          Number.isFinite(item) &&
          (index === 0 || index === 2
            ? item >= 0 && item <= 1
            : item >= -2 && item <= 2),
      ))
  ) {
    return false;
  }
  if (
    'scale' in value &&
    (typeof value.scale !== 'number' || !Number.isFinite(value.scale))
  ) {
    return false;
  }
  if (
    'durationMs' in value &&
    (!Number.isSafeInteger(value.durationMs) ||
      (value.durationMs as number) < 1 ||
      (value.durationMs as number) > 5000)
  ) {
    return false;
  }
  return true;
};

// property별 value 형식과 대상 타입 제약. property 추가 시 여기 누락은 컴파일 에러
const isEditorElementPropertyValueValid = (
  property: EditorElementPropertyKeyV1,
  value: unknown,
  elementType: EditorElementTypeV1,
): boolean => {
  const keyOrKnob = elementType === 'key' || elementType === 'knob';
  const keyOrStat = elementType === 'key' || elementType === 'stat';
  switch (property) {
    case 'hidden':
    case 'useInlineStyles':
    case 'fontItalic':
    case 'fontUnderline':
    case 'fontStrikethrough':
    case 'idleTransparent':
      return typeof value === 'boolean';
    case 'layerName':
      return typeof value === 'string' || value === null;
    case 'graphType':
      return elementType === 'graph' && (value === 'line' || value === 'bar');
    case 'graphColor':
      return elementType === 'graph' && typeof value === 'string';
    case 'showAvgLine':
    case 'graphAnimationEnabled':
      return elementType === 'graph' && typeof value === 'boolean';
    case 'graphSpeed':
      return (
        elementType === 'graph' &&
        Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 4_294_967_295
      );
    case 'reverse':
      return elementType === 'knob' && typeof value === 'boolean';
    case 'sensitivity':
      return (
        elementType === 'knob' &&
        typeof value === 'number' &&
        Number.isFinite(value)
      );
    case 'axisId':
      return elementType === 'knob' && typeof value === 'string';
    case 'fontWeight':
      return (
        Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 4_294_967_295
      );
    case 'fontFamily':
    case 'displayText':
    case 'className':
    case 'fontColor':
    case 'inactiveImage':
      return typeof value === 'string';
    case 'activeFontColor':
    case 'activeImage':
      return keyOrKnob && typeof value === 'string';
    case 'shadow':
      return elementType !== 'graph' && isEditorShadowValuePatchV1(value);
    case 'activeShadow':
      return keyOrKnob && isEditorShadowValuePatchV1(value);
    case 'shadowEnabled':
      return elementType !== 'graph' && typeof value === 'boolean';
    case 'backgroundPaint':
    case 'borderPaint':
      return isEditorPaintDescriptorV1(value);
    case 'activeBackgroundPaint':
    case 'activeBorderPaint':
      return keyOrKnob && isEditorPaintDescriptorV1(value);
    case 'borderWidth':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 20
      );
    case 'borderRadius':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= (elementType === 'knob' ? 999 : 100)
      );
    case 'fontSize':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 8 &&
        value <= 72
      );
    case 'activeTransparent':
      return keyOrKnob && typeof value === 'boolean';
    case 'idleImageFit':
      return ['cover', 'contain', 'fill', 'none'].includes(value as string);
    case 'activeImageFit':
      return (
        keyOrKnob &&
        ['cover', 'contain', 'fill', 'none'].includes(value as string)
      );
    case 'soundPath':
      return elementType === 'key' && typeof value === 'string';
    case 'soundEnabled':
      return elementType === 'key' && typeof value === 'boolean';
    case 'soundVolume':
      return (
        elementType === 'key' &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 200
      );
    case 'counterEnabled':
    case 'counterAnimationEnabled':
    case 'counterFontItalic':
    case 'counterFontUnderline':
    case 'counterFontStrikethrough':
      return keyOrStat && typeof value === 'boolean';
    case 'counterPlacement':
      return keyOrStat && (value === 'inside' || value === 'outside');
    case 'counterAlign':
      return (
        keyOrStat &&
        ['top', 'bottom', 'left', 'right'].includes(value as string)
      );
    case 'counterAlignMode':
      return keyOrStat && (value === 'center' || value === 'between');
    case 'counterGap':
      return (
        keyOrStat &&
        Number.isSafeInteger(value) &&
        (value as number) >= 0 &&
        (value as number) <= 4_294_967_295
      );
    case 'counterFontSize':
      return (
        keyOrStat &&
        Number.isSafeInteger(value) &&
        (value as number) >= 8 &&
        (value as number) <= 72
      );
    case 'counterFontWeight':
      return (
        keyOrStat &&
        Number.isSafeInteger(value) &&
        (value as number) >= 100 &&
        (value as number) <= 900
      );
    case 'counterFontFamily':
    case 'counterStrokeIdle':
      return keyOrStat && typeof value === 'string';
    case 'counterStrokeActive':
      return elementType === 'key' && typeof value === 'string';
    case 'counterFillIdle':
      return keyOrStat && isCounterFillDescriptorV1(value);
    case 'counterFillActive':
      return elementType === 'key' && isCounterFillDescriptorV1(value);
    case 'counterAnimationPreset':
      return keyOrStat && isEditorCounterAnimationPresetIntentV1(value);
    case 'statType':
      return elementType === 'stat' && STAT_TYPES.has(value as string);
    case 'noteEffectEnabled':
    case 'noteAutoYCorrection':
    case 'noteGlowEnabled':
      return elementType === 'key' && typeof value === 'boolean';
    case 'noteGlowSize':
      return (
        elementType === 'key' &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 50
      );
    case 'notePaint':
    case 'noteGlowPaint':
      return elementType === 'key' && isNotePaintValuePatchV1(value);
    case 'noteBorderPaint':
      return elementType === 'key' && isNoteBorderPaintValueV1(value);
    case 'noteOffsetX':
    case 'noteOffsetY':
      return (
        elementType === 'key' &&
        (value === null ||
          (typeof value === 'number' &&
            Number.isFinite(value) &&
            value >= -500 &&
            value <= 500))
      );
    case 'noteWidth':
      return (
        elementType === 'key' &&
        (value === null ||
          (typeof value === 'number' && Number.isFinite(value) && value > 0))
      );
    case 'noteBorderWidth':
      return (
        elementType === 'key' &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 20
      );
    case 'noteBorderRadius':
      return (
        elementType === 'key' &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 1 &&
        value <= 100
      );
    case 'noteAlignment':
      return (
        elementType === 'key' &&
        ['left', 'center', 'right'].includes(value as string)
      );
    case 'noteBorderSide':
      return (
        elementType === 'key' &&
        ['all', 'vertical', 'horizontal'].includes(value as string)
      );
    default: {
      const exhaustive: never = property;
      return exhaustive;
    }
  }
};

// op wire의 { property, value } 판별 유니온 전체 검증 (구조 + 값 + 대상 타입)
export const isEditorElementPropertyPatchV1 = (
  value: unknown,
  elementType: EditorElementTypeV1,
): value is EditorElementPropertyPatchV1 => {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !('property' in value) ||
    !('value' in value) ||
    typeof value.property !== 'string' ||
    !EDITOR_ELEMENT_PROPERTY_KEY_SET.has(value.property)
  ) {
    return false;
  }
  return isEditorElementPropertyValueValid(
    value.property as EditorElementPropertyKeyV1,
    value.value,
    elementType,
  );
};

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
      (op.kind === 'insertFrozenElements' ||
        op.kind === 'reorderElements' ||
        op.kind === 'setElementGroups' ||
        op.kind === 'renameLayerGroup'),
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
        !isNativeElementId(op.id)
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
        !isNativeElementId(op.id)
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
        !isNativeElementId(op.id) ||
        !isRecord(op.patch)
      ) {
        throw new EditorProtocolError(`${opLabel} target is invalid`);
      }
      assertUniqueDirectTarget(op.id, opLabel);
      if (
        !isEditorElementPropertyPatchV1(
          op.patch,
          op.elementType as EditorElementTypeV1,
        )
      ) {
        throw new EditorProtocolError(`${opLabel}.patch is invalid`);
      }
      return;
    }
    if (op.kind === 'setElementGroups') {
      assertExactKeys(op, ['kind', 'mode', 'targets', 'targetGroup'], opLabel);
      // 빈 targets 허용 - plugin-only 그룹 편집은 native 대상 없이 그룹 def
      // 생성·정리를 op에 실어야 한다 (백엔드 validate_editor_op와 동일 계약).
      // 플러그인 소속 자체는 동반 plugin_changes가 운반한다
      if (
        typeof op.mode !== 'string' ||
        op.mode.length === 0 ||
        new TextEncoder().encode(op.mode).length > 128 ||
        !Array.isArray(op.targets) ||
        op.targets.length > 4096
      ) {
        throw new EditorProtocolError(`${opLabel} is invalid`);
      }
      const targetIds = new Set<string>();
      op.targets.forEach((target, targetIndex) => {
        const targetLabel = `${opLabel}.targets[${targetIndex}]`;
        if (!isRecord(target)) {
          throw new EditorProtocolError(`${targetLabel} is invalid`);
        }
        assertExactKeys(target, ['elementType', 'id'], targetLabel);
        if (
          !['key', 'stat', 'graph', 'knob'].includes(
            target.elementType as string,
          ) ||
          typeof target.id !== 'string' ||
          !isNativeElementId(target.id) ||
          targetIds.has(target.id)
        ) {
          throw new EditorProtocolError(`${targetLabel} is invalid`);
        }
        targetIds.add(target.id);
      });
      if (op.targetGroup !== null) {
        if (!isRecord(op.targetGroup)) {
          throw new EditorProtocolError(`${opLabel}.targetGroup is invalid`);
        }
        const targetGroup = op.targetGroup;
        const isExisting = targetGroup.kind === 'existing';
        const isCreate = targetGroup.kind === 'create';
        assertExactKeys(
          targetGroup,
          isCreate ? ['kind', 'id', 'name'] : ['kind', 'id'],
          `${opLabel}.targetGroup`,
        );
        if (
          (!isExisting && !isCreate) ||
          typeof targetGroup.id !== 'string' ||
          targetGroup.id.length === 0 ||
          new TextEncoder().encode(targetGroup.id).length > 256 ||
          (isCreate &&
            (typeof targetGroup.name !== 'string' ||
              targetGroup.name.length === 0 ||
              new TextEncoder().encode(targetGroup.name).length > 1024))
        ) {
          throw new EditorProtocolError(`${opLabel}.targetGroup is invalid`);
        }
      }
      return;
    }
    if (op.kind === 'renameLayerGroup') {
      assertExactKeys(op, ['kind', 'mode', 'groupId', 'name'], opLabel);
      if (
        typeof op.mode !== 'string' ||
        op.mode.length === 0 ||
        new TextEncoder().encode(op.mode).length > 128 ||
        typeof op.groupId !== 'string' ||
        op.groupId.length === 0 ||
        new TextEncoder().encode(op.groupId).length > 256 ||
        typeof op.name !== 'string' ||
        op.name.length === 0 ||
        new TextEncoder().encode(op.name).length > 1024
      ) {
        throw new EditorProtocolError(`${opLabel} is invalid`);
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
    if (op.kind === 'setElementGroups') {
      if ('bounds' in result && result.bounds !== undefined) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] is invalid for setElementGroups`,
        );
      }
      const touched = new Set<EditorField>(['layerGroups']);
      op.targets.forEach((target) =>
        touched.add(positionFields[target.elementType]),
      );
      touched.forEach((field) => allowedFields.add(field));
      if (result.status === 'applied') {
        if (value.changedFields.length === 0) {
          throw new EditorProtocolError(
            'editor ops changedFields does not match opResults',
          );
        }
      } else if (value.changedFields.length !== 0) {
        throw new EditorProtocolError(
          'editor ops changedFields does not match opResults',
        );
      }
      return;
    }
    if (op.kind === 'renameLayerGroup') {
      if ('bounds' in result && result.bounds !== undefined) {
        throw new EditorProtocolError(
          `editor_commit opResults[${index}] is invalid for renameLayerGroup`,
        );
      }
      allowedFields.add('layerGroups');
      if (result.status === 'applied') {
        requiredFields.add('layerGroups');
      } else if (value.changedFields.length !== 0) {
        throw new EditorProtocolError(
          'editor ops changedFields does not match opResults',
        );
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
  // 이벤트 patch는 v1 고정이다. 백엔드는 patch_for_fields로만 만들고 그것은
  // 항상 EDITOR_SCHEMA_VERSION이다. assertEditorPatch는 커밋 요청과 공용이라
  // v2를 통과시키므로, 이벤트 경계에서는 먼저 v1을 강제한다
  if (
    !isRecord(value.patch) ||
    value.patch.schemaVersion !== EDITOR_SCHEMA_VERSION
  ) {
    throw new EditorProtocolError(
      'editor:committed patch has an unsupported schema version',
    );
  }
  assertEditorPatch(value.patch, 'editor:committed patch');
  const suppliedIds = new Set<string>();
  for (const field of POSITION_COLLECTION_FIELDS) {
    const collection = value.patch[field];
    if (collection === undefined) continue;
    for (const [mode, positions] of Object.entries(collection)) {
      for (const [index, position] of positions.entries()) {
        if (!isNativeElementId(position.id)) {
          throw new EditorProtocolError(
            `editor:committed patch.${field}.${mode}[${index}].id is invalid`,
          );
        }
        if (suppliedIds.has(position.id)) {
          throw new EditorProtocolError(
            `editor:committed patch.${field}.${mode}[${index}].id is duplicated`,
          );
        }
        suppliedIds.add(position.id);
      }
    }
  }
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
