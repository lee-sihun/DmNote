import type { GraphItemPositions } from '@src/types/key/graphItems';
import {
  keyPositionSchema,
  keySlotSchema,
  type KeyMappings,
  type KeyPositions,
} from '@src/types/key/keys';
import type { KnobItemPositions } from '@src/types/key/knobs';
import {
  STAT_ITEM_TYPES,
  type StatItemPositions,
} from '@src/types/key/statItems';
import type { LayerGroups } from '@src/types/layerGroups';
import { canonicalizePositionGradients } from '@src/types/color';

export const EDITOR_SCHEMA_VERSION = 1 as const;

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
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
} & Partial<Pick<EditorDocumentV1, EditorField>>;

export interface EditorCommitRequest {
  baseRevision: number;
  mutationId: string;
  changes: EditorPatchV1;
  // 프리뷰 게스처 커밋 연동용, 성공 시 committed 이벤트로 echo
  gestureId?: string;
  // 한 요청으로 합쳐진 프리뷰 세션 전체
  gestureIds?: string[];
  // 멀티 키 슬롯 지원 선언. keys를 포함한 커밋에서 현재 매핑에 멀티 슬롯이
  // 존재하는데 이 선언이 없으면 백엔드가 MULTI_KEY_UNSUPPORTED로 거절
  multiKey?: boolean;
}

export interface EditorCommitResult {
  revision: number;
  changedFields: EditorField[];
}

export interface EditorGestureCommitContext {
  editorBaseRevision: number;
  mutationId: string;
  editorChanges?: EditorPatchV1;
}

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
  if (!isRecord(value) || value.schemaVersion !== EDITOR_SCHEMA_VERSION) {
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

export function assertEditorCommitResult(value: EditorCommitResult): void {
  if (!value) {
    throw new EditorProtocolError('editor_commit returned an empty result');
  }
  assertSafeEditorRevision(value.revision, 'editor_commit revision');
  assertEditorFields(value.changedFields, 'editor_commit changedFields');
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
