import { stableStringify } from '@utils/core/stableStringify';
import {
  normalizeLayerGroupsForMode,
  projectLayerGroupRename,
  projectStableElementGroups,
} from '@utils/layerGroupUtils';
import { currentPluginGroupMembers } from './pluginGroupMembers';
import {
  inheritedPaintMaterialization,
  paintPropertyFields,
} from '@src/types/color';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  applyImageTransformLeaf,
  type ImageTransform,
} from '@src/types/key/imageLayer';
import {
  isNotePaintPropertyPatchV1,
  mirrorBodyPaintToGlow,
  projectNotePaintPatch,
} from '@src/types/key/notePaint';
import {
  isCounterFillPropertyPatchV1,
  projectCounterFillPatch,
} from '@src/types/key/counterFill';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { projectSpriteResize } from '@utils/sprite/resizeProjection';
import { isEditorShadowPropertyPatchV1 } from '@src/types/editor';

import {
  EDITOR_COMMIT_SCHEMA_VERSION,
  EDITOR_FIELDS,
  EDITOR_OPS_VERSION,
  EDITOR_SCHEMA_VERSION,
  EditorProtocolError,
  assertEditorCommitResult,
  assertEditorCommittedEvent,
  assertEditorDocument,
  assertCanonicalEditorDocument,
  assertEditorGetResult,
  assertEditorOpCommitResult,
  assertEditorOpsV1,
  assertEditorPatch,
  canonicalizeEditorGradients,
  isEditorCommitError,
  isRetryableEditorCommitError,
} from '@src/types/editor';

import type {
  EditorCommitError,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  CanonicalEditorDocumentV1,
  EditorDocumentV1,
  EditorElementTypeV1,
  EditorField,
  EditorGetResult,
  CanonicalEditorGetResult,
  EditorGestureCommitContext,
  EditorOpResultV1,
  EditorOpV1,
  EditorPatchV1,
  EditorEventPatchV1,
  EditorLegacyPatchV1,
} from '@src/types/editor';
import {
  implicitCounterFontBold,
  implicitElementFontBold,
} from '@utils/core/fontWeights';

export type EditorApplyReason =
  | 'initial'
  | 'localPatch'
  | 'event'
  | 'resync'
  | 'rebase'
  | 'rejected'
  | 'keepLocal'
  | 'acceptCanonical';

type EditorConflictReason = 'overlap' | 'rebaseLimit';
type EditorConflictResolution = 'keepLocal' | 'acceptCanonical';

interface EditorConflictState {
  lastAck: CanonicalEditorDocumentV1;
  pendingLocal: CanonicalEditorDocumentV1;
  canonical: CanonicalEditorDocumentV1;
  canonicalRevision: number;
  localFields: EditorField[];
  overlappingFields: EditorField[];
  reason: EditorConflictReason;
}

type EditorCoordinatorPhase =
  | 'idle'
  | 'initializing'
  | 'saving'
  | 'conflict'
  | 'error'
  | 'stopped';

export interface EditorCoordinatorState {
  phase: EditorCoordinatorPhase;
  revision: number | null;
  dirty: boolean;
  inFlightMutationId: string | null;
  lastAck: CanonicalEditorDocumentV1 | null;
  pendingLocal: CanonicalEditorDocumentV1 | null;
  conflict: EditorConflictState | null;
  error: unknown;
  failureKind: 'transient' | 'permanent' | null;
}

export type EditorReadyUnsubscribe = (() => void) & { ready: Promise<void> };

// 직렬 슬롯 안에서 최신 base로 patch를 재생성하는 게스처 커밋 입력.
// null = editorChanges 없음 (plugin transaction은 실행)
export type EditorPatchGenerator = (
  base: CanonicalEditorDocumentV1,
) => EditorPatchV1 | null;

export interface EditorGestureOpsMutation {
  opsVersion: typeof EDITOR_OPS_VERSION;
  ops: readonly EditorOpV1[];
}

type EditorGestureMutationGenerator = (
  base: CanonicalEditorDocumentV1,
) => EditorPatchV1 | EditorGestureOpsMutation | null;

type EditorGestureMutation =
  | EditorPatchV1
  | EditorGestureMutationGenerator
  | EditorGestureOpsMutation
  | undefined;

const isGestureOpsMutation = (
  mutation: EditorGestureMutation,
): mutation is EditorGestureOpsMutation =>
  typeof mutation === 'object' && mutation !== null && 'opsVersion' in mutation;

export interface EditorCoordinatorTransport {
  get(): Promise<EditorGetResult>;
  commit(request: EditorCommitRequest): Promise<EditorCommitResult>;
  onCommitted(
    listener: (event: EditorCommittedV1) => void,
  ): EditorReadyUnsubscribe;
}

interface EditorEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface EditorVisibilityTarget extends EditorEventTarget {
  visibilityState?: string;
}

export interface EditorCoordinatorOptions {
  transport: EditorCoordinatorTransport;
  readDocument(): CanonicalEditorDocumentV1;
  applyDocument(
    document: CanonicalEditorDocumentV1,
    reason: EditorApplyReason,
  ): void;
  createMutationId?: () => string;
  focusTarget?: EditorEventTarget | null;
  visibilityTarget?: EditorVisibilityTarget | null;
  readOnly?: boolean | (() => boolean);
  // committed 이벤트가 canonical에 반영된 직후 호출 (프리뷰 오버레이 정리용)
  onCommittedApplied?: (event: EditorCommittedV1) => void;
  onGestureIdsDiscarded?: (gestureIds: readonly string[]) => void;
  onStartSucceeded?: () => void | Promise<void>;
}

interface EditorSyncOptions {
  reapply?: boolean;
}

export interface EditorSemanticCommitOutcome {
  document: CanonicalEditorDocumentV1;
  opResults: EditorOpResultV1[];
}

export interface EditorSemanticCommitMeta {
  gestureId?: string;
  onEnrolled?: () => void;
  preflight?: () => void;
}

export type EditorSemanticOpsGenerator = (
  base: CanonicalEditorDocumentV1,
) => readonly EditorOpV1[] | null;

export class EditorReadOnlyError extends Error {
  constructor() {
    super('editor coordinator is read-only');
    this.name = 'EditorReadOnlyError';
  }
}

interface InFlightCommit {
  mutationId: string;
  baseRevision: number;
  baseDocument: CanonicalEditorDocumentV1;
  target: CanonicalEditorDocumentV1;
  localFields: EditorField[];
  requestFields: EditorField[];
  gestureIds: string[];
  // 낙관 적용 없이 전송되는 격리 플러그인 커밋. 승인 전 target을
  // 로컬 pending이나 커밋 base로 세면 안 된다
  isolated?: boolean;
  semanticOps?: boolean;
}

const MAX_AUTO_REBASE_ATTEMPTS = 2;
const MAX_TRACKED_MUTATIONS = 64;
// Rust state/editor.rs의 MAX_GESTURE_IDS와 동일한 IPC 상한
const MAX_PENDING_GESTURE_IDS = 32;

const clone = <T>(value: T): T => structuredClone(value);

const fieldsOverlap = (
  first: readonly EditorField[],
  second: readonly EditorField[],
): EditorField[] => {
  const secondSet = new Set(second);
  return first.filter((field) => secondSet.has(field));
};

const unresolvedLocalFields = (
  localFields: readonly EditorField[],
  pendingLocal: CanonicalEditorDocumentV1,
  canonical: CanonicalEditorDocumentV1,
): EditorField[] =>
  localFields.filter(
    (field) =>
      stableStringify(pendingLocal[field]) !==
      stableStringify(canonical[field]),
  );

// wire 버전은 전송 경로가 결정한다. 호출부 패치의 schemaVersion은 문서 적용
// 과정에서 소비되어 여기까지 오지 않으므로, 자사 전송 지점만 v2를 명시한다
const patchForFields = (
  document: EditorDocumentV1,
  fields: readonly EditorField[],
  schemaVersion: EditorPatchV1['schemaVersion'] = EDITOR_SCHEMA_VERSION,
): EditorPatchV1 => {
  const patch: EditorPatchV1 = { schemaVersion };
  fields.forEach((field) => {
    Object.assign(patch, { [field]: clone(document[field]) });
  });
  return patch;
};

const SEMANTIC_POSITION_FIELDS: Record<EditorElementTypeV1, EditorField> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
  sprite: 'spritePositions',
};

const fieldsForSemanticOp = (op: EditorOpV1): EditorField[] => {
  if (op.kind === 'insertFrozenElements') {
    const fields = new Set<EditorField>();
    op.elements.forEach((element) => {
      fields.add(SEMANTIC_POSITION_FIELDS[element.elementType]);
      if (element.elementType === 'key') fields.add('keys');
    });
    op.zUpdates.forEach((update) =>
      fields.add(SEMANTIC_POSITION_FIELDS[update.elementType]),
    );
    if (op.groups.length > 0) fields.add('layerGroups');
    return [...fields];
  }
  if (op.kind === 'reorderElements') {
    const fields = new Set<EditorField>();
    op.zUpdates.forEach((update) =>
      fields.add(SEMANTIC_POSITION_FIELDS[update.elementType]),
    );
    op.groupUpdates.forEach((update) =>
      fields.add(SEMANTIC_POSITION_FIELDS[update.elementType]),
    );
    if (op.completeModeOrder) fields.add('layerGroups');
    return [...fields];
  }
  if (op.kind === 'setElementGroups') {
    return [
      ...new Set([
        ...op.targets.map(
          (target) => SEMANTIC_POSITION_FIELDS[target.elementType],
        ),
        'layerGroups' as const,
      ]),
    ];
  }
  if (op.kind === 'renameLayerGroup') return ['layerGroups'];
  if (op.kind === 'patchElement') {
    return [SEMANTIC_POSITION_FIELDS[op.elementType]];
  }
  if (op.kind === 'setKeySlot') return ['keys'];
  if (op.kind === 'resizeSprite') return ['spritePositions'];
  const positionField = SEMANTIC_POSITION_FIELDS[op.elementType];
  if (op.kind === 'setBounds') return [positionField];
  return op.elementType === 'key' ? ['keys', 'keyPositions'] : [positionField];
};

// 그룹 normalize의 플러그인 멤버 소스는 plugin store가 등록한 제공자 -
// 백엔드가 store 인스턴스를 쓰는 것의 미러. 낙관 replay의 근사이며
// 드리프트는 커밋 이벤트의 canonical patch가 정정한다

const applySemanticOps = (
  base: CanonicalEditorDocumentV1,
  ops: readonly EditorOpV1[],
  results?: readonly EditorOpResultV1[],
): CanonicalEditorDocumentV1 => {
  const next = clone(base);
  ops.forEach((op, opIndex) => {
    const result = results?.[opIndex];
    if (result?.status === 'targetMissing') return;
    if (op.kind === 'insertFrozenElements') {
      if (result?.status === 'noChange') return;
      if (op.groups.length > 0) {
        const existingGroupIds = new Set(
          (next.layerGroups[op.mode] ?? []).map((group) => group.id),
        );
        next.layerGroups = {
          ...next.layerGroups,
          [op.mode]: [
            ...(next.layerGroups[op.mode] ?? []),
            ...op.groups
              .filter((group) => !existingGroupIds.has(group.id))
              .map((group) => ({ ...group })),
          ],
        };
      }
      for (const element of op.elements) {
        let existing:
          | { elementType: EditorElementTypeV1; mode: string; index: number }
          | undefined;
        for (const [elementType, field] of Object.entries(
          SEMANTIC_POSITION_FIELDS,
        ) as Array<[EditorElementTypeV1, EditorField]>) {
          for (const [mode, positions] of Object.entries(next[field])) {
            const index = positions.findIndex(
              (position) => position.id === element.position.id,
            );
            if (index >= 0) {
              existing = { elementType, mode, index };
              break;
            }
          }
          if (existing) break;
        }
        if (existing) {
          if (
            existing.elementType !== element.elementType ||
            existing.mode !== op.mode
          ) {
            continue;
          }
          const field = SEMANTIC_POSITION_FIELDS[element.elementType];
          const record = next[field] as Record<
            string,
            Array<Record<string, unknown>>
          >;
          next[field] = {
            ...record,
            [op.mode]: (record[op.mode] ?? []).map((position, index) =>
              index === existing!.index
                ? (clone(element.position) as Record<string, unknown>)
                : position,
            ),
          } as never;
          if (element.elementType === 'key') {
            next.keys = {
              ...next.keys,
              [op.mode]: (next.keys[op.mode] ?? []).map((slot, index) =>
                index === existing!.index ? clone(element.slot) : slot,
              ),
            };
          }
          continue;
        }
        if (element.elementType === 'key') {
          next.keys = {
            ...next.keys,
            [op.mode]: [...(next.keys[op.mode] ?? []), clone(element.slot)],
          };
          next.keyPositions = {
            ...next.keyPositions,
            [op.mode]: [
              ...(next.keyPositions[op.mode] ?? []),
              clone(element.position),
            ],
          };
        } else {
          const field = SEMANTIC_POSITION_FIELDS[element.elementType];
          const record = next[field] as Record<
            string,
            Array<Record<string, unknown>>
          >;
          next[field] = {
            ...record,
            [op.mode]: [
              ...(record[op.mode] ?? []),
              clone(element.position) as Record<string, unknown>,
            ],
          } as never;
        }
      }
      for (const update of op.zUpdates) {
        const field = SEMANTIC_POSITION_FIELDS[update.elementType];
        const record = next[field] as Record<
          string,
          Array<Record<string, unknown> & { id: string }>
        >;
        const positions = record[op.mode] ?? [];
        const index = positions.findIndex(
          (position) => position.id === update.id,
        );
        if (index < 0) continue;
        next[field] = {
          ...record,
          [op.mode]: positions.map((position, positionIndex) =>
            positionIndex === index
              ? (position.zIndex ?? 0) === update.zIndex
                ? position
                : { ...position, zIndex: update.zIndex }
              : position,
          ),
        } as never;
      }
      return;
    }
    if (op.kind === 'reorderElements') {
      if (result?.status === 'noChange') return;
      const zById = new Map(
        op.zUpdates.map((update) => [update.id, update] as const),
      );
      const groupById = new Map(
        op.groupUpdates.map((update) => [update.id, update] as const),
      );
      const touchedTypes = new Set([
        ...op.zUpdates.map((update) => update.elementType),
        ...op.groupUpdates.map((update) => update.elementType),
      ]);
      for (const elementType of touchedTypes) {
        const field = SEMANTIC_POSITION_FIELDS[elementType];
        const record = next[field] as Record<
          string,
          Array<Record<string, unknown> & { id: string }>
        >;
        next[field] = {
          ...record,
          [op.mode]: (record[op.mode] ?? []).map((position) => {
            const id = position.id;
            const zUpdate = zById.get(id);
            const groupUpdate = groupById.get(id);
            if (
              zUpdate?.elementType !== elementType &&
              groupUpdate?.elementType !== elementType
            ) {
              return position;
            }
            const updated = { ...position };
            if (zUpdate?.elementType === elementType) {
              updated.zIndex = zUpdate.zIndex;
            }
            if (groupUpdate?.elementType === elementType) {
              if (groupUpdate.groupId === null) delete updated.groupId;
              else updated.groupId = groupUpdate.groupId;
            }
            return updated;
          }),
        } as never;
      }
      if (op.completeModeOrder) {
        const normalized = normalizeLayerGroupsForMode({
          mode: op.mode,
          keyPositions: next.keyPositions,
          statPositions: next.statPositions,
          graphPositions: next.graphPositions,
          knobPositions: next.knobPositions,
          spritePositions: next.spritePositions,
          layerGroups: next.layerGroups,
          pluginElements: currentPluginGroupMembers(),
        });
        next.keyPositions = normalized.keyPositions;
        next.statPositions = normalized.statPositions;
        next.graphPositions = normalized.graphPositions;
        next.knobPositions = normalized.knobPositions;
        next.spritePositions = normalized.spritePositions;
        next.layerGroups = normalized.layerGroups;
      }
      return;
    }
    if (op.kind === 'setElementGroups') {
      if (result?.status === 'noChange') return;
      const projected = projectStableElementGroups({
        mode: op.mode,
        targets: op.targets,
        targetGroup: op.targetGroup,
        keyPositions: next.keyPositions,
        statPositions: next.statPositions,
        graphPositions: next.graphPositions,
        knobPositions: next.knobPositions,
        spritePositions: next.spritePositions,
        layerGroups: next.layerGroups,
        pluginElements: currentPluginGroupMembers(),
      });
      if (!projected) return;
      next.keyPositions = projected.keyPositions;
      next.statPositions = projected.statPositions;
      next.graphPositions = projected.graphPositions;
      next.knobPositions = projected.knobPositions;
      next.spritePositions = projected.spritePositions;
      next.layerGroups = projected.layerGroups;
      return;
    }
    if (op.kind === 'renameLayerGroup') {
      if (result?.status === 'noChange') return;
      const layerGroups = projectLayerGroupRename({
        mode: op.mode,
        groupId: op.groupId,
        name: op.name,
        layerGroups: next.layerGroups,
      });
      if (layerGroups) next.layerGroups = layerGroups;
      return;
    }
    if (op.kind === 'patchElement') {
      if (result?.status === 'noChange') return;
      const field = SEMANTIC_POSITION_FIELDS[op.elementType];
      const record = next[field] as Record<
        string,
        Array<Record<string, unknown> & { id: string }>
      >;
      for (const [mode, positions] of Object.entries(record)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        next[field] = {
          ...record,
          [mode]: positions.map((position, positionIndex) => {
            if (positionIndex !== index) return position;
            if (op.patch.property === 'layerName') {
              const updated = { ...position };
              if (op.patch.value === null) delete updated.layerName;
              else updated.layerName = op.patch.value;
              return updated;
            }
            if (op.patch.property === 'graphType') {
              return { ...position, graphType: op.patch.value };
            }
            if (op.patch.property === 'graphColor') {
              return { ...position, graphColor: op.patch.value };
            }
            if (op.patch.property === 'showAvgLine') {
              return { ...position, showAvgLine: op.patch.value };
            }
            if (op.patch.property === 'graphAnimationEnabled') {
              return {
                ...position,
                graphAnimationEnabled: op.patch.value,
              };
            }
            if (op.patch.property === 'graphSpeed') {
              return { ...position, graphSpeed: op.patch.value };
            }
            if (op.patch.property === 'reverse') {
              return { ...position, reverse: op.patch.value };
            }
            if (op.patch.property === 'sensitivity') {
              return { ...position, sensitivity: op.patch.value };
            }
            if (op.patch.property === 'axisId') {
              return { ...position, axisId: op.patch.value };
            }
            if (op.patch.property === 'soundEnabled') {
              return { ...position, soundEnabled: op.patch.value };
            }
            if (op.patch.property === 'soundVolume') {
              return { ...position, soundVolume: op.patch.value };
            }
            if (op.patch.property === 'soundPath') {
              return { ...position, soundPath: op.patch.value };
            }
            if (op.patch.property === 'inactiveImage') {
              return { ...position, inactiveImage: op.patch.value };
            }
            if (op.patch.property === 'activeImage') {
              return { ...position, activeImage: op.patch.value };
            }
            if (op.patch.property === 'idleTransparent') {
              return {
                ...position,
                idleTransparent: op.patch.value,
              };
            }
            if (op.patch.property === 'activeTransparent') {
              return {
                ...position,
                activeTransparent: op.patch.value,
              };
            }
            if (op.patch.property === 'idleImageFit') {
              return { ...position, idleImageFit: op.patch.value };
            }
            if (op.patch.property === 'activeImageFit') {
              return { ...position, activeImageFit: op.patch.value };
            }
            if (op.patch.property === 'imageMode') {
              // replace는 기본값이라 sparse 저장 - 백엔드와 동일
              const { imageMode: _imageMode, ...rest } = position;
              return op.patch.value === 'replace'
                ? rest
                : { ...position, imageMode: op.patch.value };
            }
            if (
              op.patch.property === 'idleImageTransform' ||
              op.patch.property === 'activeImageTransform'
            ) {
              const field = op.patch.property;
              if (op.patch.value === null) {
                const { [field]: _dropped, ...rest } = position;
                return rest;
              }
              return {
                ...position,
                [field]: applyImageTransformLeaf(
                  position[field] as ImageTransform | undefined,
                  op.patch.value,
                ),
              };
            }
            if (op.patch.property === 'counterEnabled') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, enabled: op.patch.value },
              };
            }
            if (op.patch.property === 'counterAnimationEnabled') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              const animation = (counter?.animation ?? {}) as Record<
                string,
                unknown
              >;
              return {
                ...position,
                counter: {
                  ...counter,
                  animation: {
                    ...animation,
                    enabled: op.patch.value,
                  },
                },
              };
            }
            if (op.patch.property === 'counterPlacement') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, placement: op.patch.value },
              };
            }
            if (op.patch.property === 'counterAlign') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, align: op.patch.value },
              };
            }
            if (op.patch.property === 'counterAlignMode') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, alignMode: op.patch.value },
              };
            }
            if (op.patch.property === 'counterGap') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, gap: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontSize') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontSize: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontWeight') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              // 백엔드와 같은 암묵 Bold 고정 (fontWeights.implicitCounterFontBold)
              return {
                ...position,
                counter: {
                  ...counter,
                  fontWeight: op.patch.value,
                  ...(typeof counter?.fontBold !== 'boolean'
                    ? { fontBold: implicitCounterFontBold(counter?.fontWeight) }
                    : {}),
                },
              };
            }
            if (op.patch.property === 'counterFontBold') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontBold: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontItalic') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontItalic: op.patch.value },
              };
            }
            if (op.patch.property === 'counterFontUnderline') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontUnderline: op.patch.value,
                },
              };
            }
            if (op.patch.property === 'counterFontStrikethrough') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontStrikethrough: op.patch.value,
                },
              };
            }
            if (op.patch.property === 'counterFontFamily') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontFamily: op.patch.value,
                },
              };
            }
            if (op.patch.property === 'counterAnimationPreset') {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              const animation = (counter?.animation ?? {}) as Record<
                string,
                unknown
              >;
              const intent = op.patch.value;
              return {
                ...position,
                counter: {
                  ...counter,
                  animation: {
                    ...animation,
                    ...('applyPresetId' in intent
                      ? { presetId: intent.presetId }
                      : {}),
                    ...('bezier' in intent
                      ? { bezier: [...intent.bezier] }
                      : {}),
                    ...('scale' in intent ? { scale: intent.scale } : {}),
                    ...('durationMs' in intent
                      ? { durationMs: intent.durationMs }
                      : {}),
                  },
                },
              };
            }
            if (op.patch.property === 'useInlineStyles') {
              return {
                ...position,
                useInlineStyles: op.patch.value,
              };
            }
            if (op.patch.property === 'fontWeight') {
              // 백엔드와 같은 암묵 Bold 고정 (fontWeights.implicitElementFontBold)
              return {
                ...position,
                fontWeight: op.patch.value,
                ...(position.fontBold == null
                  ? { fontBold: implicitElementFontBold(position.fontWeight) }
                  : {}),
              };
            }
            if (op.patch.property === 'fontBold') {
              return { ...position, fontBold: op.patch.value };
            }
            if (op.patch.property === 'fontItalic') {
              return { ...position, fontItalic: op.patch.value };
            }
            if (op.patch.property === 'fontUnderline') {
              return { ...position, fontUnderline: op.patch.value };
            }
            if (op.patch.property === 'fontStrikethrough') {
              return {
                ...position,
                fontStrikethrough: op.patch.value,
              };
            }
            if (op.patch.property === 'fontFamily') {
              return { ...position, fontFamily: op.patch.value };
            }
            if (
              op.patch.property === 'backgroundPaint' ||
              op.patch.property === 'activeBackgroundPaint' ||
              op.patch.property === 'borderPaint' ||
              op.patch.property === 'activeBorderPaint' ||
              op.patch.property === 'fontPaint' ||
              op.patch.property === 'activeFontPaint'
            ) {
              const field = op.patch.property;
              const paint = op.patch.value;
              const {
                active,
                surface,
                colorField,
                gradientField,
                activeColorField,
                activeGradientField,
              } = paintPropertyFields(field);
              // 물질화 대상 - active 쌍을 가진 요소 (font는 키만)
              const materializes =
                surface === 'font'
                  ? op.elementType === 'key'
                  : op.elementType === 'key' || op.elementType === 'knob';
              const preservation: Record<string, unknown> = {};
              if (!active && materializes) {
                const inherited = inheritedPaintMaterialization(
                  {
                    color:
                      typeof position[colorField] === 'string'
                        ? (position[colorField] as string)
                        : undefined,
                    gradient: position[gradientField] as never,
                  },
                  {
                    color:
                      typeof position[activeColorField] === 'string'
                        ? (position[activeColorField] as string)
                        : undefined,
                    gradient: position[activeGradientField] as never,
                  },
                );
                if (inherited) {
                  if (inherited.color != null) {
                    preservation[activeColorField] = inherited.color;
                  }
                  if (inherited.gradient) {
                    preservation[activeGradientField] = inherited.gradient;
                  }
                }
              }
              return {
                ...position,
                ...preservation,
                [colorField]: paint.color,
                [gradientField]: paint.gradient ?? undefined,
              };
            }
            if (isEditorShadowPropertyPatchV1(op.patch)) {
              return {
                ...position,
                ...projectElementShadowPatch({
                  position: position as never,
                  elementType: op.elementType as 'key' | 'stat' | 'knob',
                  patch: op.patch,
                  defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
                  defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
                }),
              };
            }
            if (isCounterFillPropertyPatchV1(op.patch)) {
              return {
                ...position,
                ...projectCounterFillPatch(position as never, op.patch),
              };
            }
            if (isNotePaintPropertyPatchV1(op.patch)) {
              // position 전달 - {opacity} 단독의 sibling shadow 재계산 (§9-5)
              return {
                ...position,
                ...projectNotePaintPatch(op.patch, position as never),
              };
            }
            if (op.patch.property === 'displayText') {
              return { ...position, displayText: op.patch.value };
            }
            if (op.patch.property === 'className') {
              return { ...position, className: op.patch.value };
            }
            if (op.patch.property === 'borderWidth') {
              return { ...position, borderWidth: op.patch.value };
            }
            if (op.patch.property === 'borderRadius') {
              return { ...position, borderRadius: op.patch.value };
            }
            if (op.patch.property === 'fontSize') {
              return { ...position, fontSize: op.patch.value };
            }
            if (op.patch.property === 'noteGlowSize') {
              return { ...position, noteGlowSize: op.patch.value };
            }
            if (op.patch.property === 'noteOffsetX') {
              // null 보존 - 백엔드가 이 필드를 null로 직렬화하므로 undefined로
              // 바꾸면 의미가 같은데도 getChangedEditorFields가 변경으로 잡는다
              return { ...position, noteOffsetX: op.patch.value };
            }
            if (op.patch.property === 'noteOffsetY') {
              // null 보존 - 백엔드가 이 필드를 null로 직렬화하므로 undefined로
              // 바꾸면 의미가 같은데도 getChangedEditorFields가 변경으로 잡는다
              return { ...position, noteOffsetY: op.patch.value };
            }
            if (op.patch.property === 'noteWidth') {
              // null 보존 - 백엔드가 이 필드를 null로 직렬화하므로 undefined로
              // 바꾸면 의미가 같은데도 getChangedEditorFields가 변경으로 잡는다
              return { ...position, noteWidth: op.patch.value };
            }
            if (op.patch.property === 'noteBorderWidth') {
              return {
                ...position,
                noteBorderWidth: op.patch.value,
              };
            }
            if (op.patch.property === 'noteBorderRadius') {
              return {
                ...position,
                noteBorderRadius: op.patch.value,
              };
            }
            if (op.patch.property === 'noteEffectEnabled') {
              return {
                ...position,
                noteEffectEnabled: op.patch.value,
              };
            }
            if (op.patch.property === 'noteAutoYCorrection') {
              return {
                ...position,
                noteAutoYCorrection: op.patch.value,
              };
            }
            if (op.patch.property === 'noteGlowEnabled') {
              return {
                ...position,
                noteGlowEnabled: op.patch.value,
              };
            }
            if (op.patch.property === 'noteGlowSyncPaint') {
              // 켜는 순간 본체 페인트를 글로우로 복사 (Rust 적용기와 동일)
              const next = { ...position, noteGlowSyncPaint: op.patch.value };
              return op.patch.value
                ? { ...next, ...mirrorBodyPaintToGlow(next as never) }
                : next;
            }
            if (op.patch.property === 'noteAlignment') {
              return { ...position, noteAlignment: op.patch.value };
            }
            if (op.patch.property === 'noteBorderSide') {
              return { ...position, noteBorderSide: op.patch.value };
            }
            if (op.patch.property === 'statType') {
              return { ...position, statType: op.patch.value };
            }
            if (op.patch.property === 'hidden') {
              return { ...position, hidden: op.patch.value };
            }
            // 속성 arm 누락을 컴파일 시점에 잡는다. Rust 적용부는 exhaustive
            // match라 누락이 컴파일 오류지만 이 체인은 폴백으로 흘렀다
            const unhandled: never = op.patch;
            void unhandled;
            return position;
          }),
        } as never;
        break;
      }
      return;
    }
    if (op.kind === 'setKeySlot') {
      if (result?.status === 'noChange') return;
      for (const [mode, positions] of Object.entries(next.keyPositions)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        next.keys = {
          ...next.keys,
          [mode]: (next.keys[mode] ?? []).map((slot, slotIndex) =>
            slotIndex === index ? clone(op.slot) : slot,
          ),
        };
        break;
      }
      return;
    }
    if (op.kind === 'resizeSprite') {
      if (result?.status === 'noChange') return;
      const positionsByMode = next.spritePositions;
      for (const [mode, positions] of Object.entries(positionsByMode)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        // 결과 bounds(서버 확정)가 있으면 그것으로 projection - 배율 수학은
        // resizeProjection 하나가 양측 계약을 소유한다
        const bounds = result?.bounds ?? op.bounds;
        positionsByMode[mode] = positions.map((position, positionIndex) =>
          positionIndex === index
            ? projectSpriteResize(position, bounds)
            : position,
        );
        break;
      }
      return;
    }
    const field = SEMANTIC_POSITION_FIELDS[op.elementType];
    const positionsByMode = next[field] as Record<
      string,
      Array<Record<string, unknown>>
    >;
    for (const [mode, positions] of Object.entries(positionsByMode)) {
      const index = positions.findIndex((position) => position.id === op.id);
      if (index < 0) continue;
      if (op.kind === 'setBounds') {
        const bounds = result?.bounds ?? op.bounds;
        positionsByMode[mode] = positions.map((position, positionIndex) =>
          positionIndex === index ? { ...position, ...bounds } : position,
        );
        break;
      }
      positionsByMode[mode] = positions.filter(
        (_, positionIndex) => positionIndex !== index,
      );
      if (op.elementType === 'key') {
        next.keys = {
          ...next.keys,
          [mode]: (next.keys[mode] ?? []).filter(
            (_, slotIndex) => slotIndex !== index,
          ),
        };
      }
      const normalized = normalizeLayerGroupsForMode({
        mode,
        keyPositions: next.keyPositions,
        statPositions: next.statPositions,
        graphPositions: next.graphPositions,
        knobPositions: next.knobPositions,
        spritePositions: next.spritePositions,
        layerGroups: next.layerGroups,
        pluginElements: currentPluginGroupMembers(),
      });
      next.keyPositions = normalized.keyPositions;
      next.statPositions = normalized.statPositions;
      next.graphPositions = normalized.graphPositions;
      next.knobPositions = normalized.knobPositions;
      next.spritePositions = normalized.spritePositions;
      next.layerGroups = normalized.layerGroups;
      break;
    }
  });
  return next;
};

// 위치 필드에서 id로 요소 항목 탐색
const findPositionEntryById = (
  document: CanonicalEditorDocumentV1,
  elementType: EditorElementTypeV1,
  id: string,
): Record<string, unknown> | null => {
  const record = document[SEMANTIC_POSITION_FIELDS[elementType]] as Record<
    string,
    Array<Record<string, unknown> & { id: string }>
  >;
  for (const positions of Object.values(record)) {
    const match = positions.find((position) => position.id === id);
    if (match) return match;
  }
  return null;
};

// CAS 판정을 건너뛰는 op 표식
const FROZEN_OP_CAS_EXEMPT = Symbol('frozenOpCasExempt');

// 동결 op가 낙관 재적용에서 되쓰는 대상 조각. setBounds는 기하 필드만,
// patchElement는 대상 항목, setKeySlot은 결합 인덱스의 슬롯. 값 되돌림
// 위험이 없는 구조 op(삽입·삭제·정렬 등)는 CAS 비대상으로 항상 재적용
const frozenOpCasUnit = (
  document: CanonicalEditorDocumentV1,
  op: EditorOpV1,
): unknown => {
  if (op.kind === 'setBounds') {
    const entry = findPositionEntryById(document, op.elementType, op.id);
    if (!entry) return null;
    return {
      dx: entry.dx,
      dy: entry.dy,
      width: entry.width,
      height: entry.height,
    };
  }
  if (op.kind === 'resizeSprite') {
    const entry = findPositionEntryById(document, 'sprite', op.id);
    if (!entry) return null;
    // resize가 소유하는 조각 전체 - bounds와 스케일 대상 콘텐츠
    return {
      dx: entry.dx,
      dy: entry.dy,
      width: entry.width,
      height: entry.height,
      imageRect: entry.imageRect,
      idleTransform: entry.idleTransform,
      poses: entry.poses,
    };
  }
  if (op.kind === 'patchElement') {
    return findPositionEntryById(document, op.elementType, op.id);
  }
  if (op.kind === 'setKeySlot') {
    for (const [mode, positions] of Object.entries(document.keyPositions)) {
      const index = positions.findIndex((position) => position.id === op.id);
      if (index < 0) continue;
      return document.keys[mode]?.[index] ?? null;
    }
    return null;
  }
  return FROZEN_OP_CAS_EXEMPT;
};

// 동결 op 재적용 소유 판정: 동결 시점 base와 현재 스토어의 대상 조각이
// 같을 때만 재적용. 다르면 슬롯 대기 중의 2차 편집이 소유한 값이라 보존
const canReapplyFrozenOp = (
  op: EditorOpV1,
  base: CanonicalEditorDocumentV1,
  current: CanonicalEditorDocumentV1,
): boolean => {
  const baseUnit = frozenOpCasUnit(base, op);
  if (baseUnit === FROZEN_OP_CAS_EXEMPT) return true;
  const currentUnit = frozenOpCasUnit(current, op);
  return stableStringify(currentUnit) === stableStringify(baseUnit);
};

// patch 재적용은 필드 통째 교체라 필드 단위 CAS: 현재 스토어 필드가 동결
// 시점 base와 같을 때만(소유 증명) 동결 필드를 되쓴다. 다르면 슬롯 대기
// 중의 2차 편집이 소유한 필드라 보존. wire 커밋 내용에는 영향 없음
const frozenPatchOwnedFields = (
  changes: EditorPatchV1,
  base: CanonicalEditorDocumentV1,
  current: CanonicalEditorDocumentV1,
): EditorPatchV1 => {
  const owned: EditorPatchV1 = { schemaVersion: changes.schemaVersion };
  EDITOR_FIELDS.forEach((field) => {
    if (changes[field] === undefined) return;
    if (stableStringify(current[field]) !== stableStringify(base[field])) {
      return;
    }
    Object.assign(owned, { [field]: changes[field] });
  });
  return owned;
};

export function getChangedEditorFields(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
  // 플러그인 격리 커밋의 next는 poseId 미발급 상태일 수 있어 방향을 받는다
  nextSpriteMode: 'canonical' | 'input' = 'canonical',
): EditorField[] {
  assertEditorDocument(base, 'base editor document');
  assertEditorDocument(next, 'next editor document', nextSpriteMode);

  return EDITOR_FIELDS.filter(
    (field) => stableStringify(base[field]) !== stableStringify(next[field]),
  );
}

// 버전 인자 없이 patchForFields를 부르므로 항상 v1이다. 이벤트 patch 타입과
// 맞도록 반환도 v1로 좁힌다
export function createEditorPatch(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorEventPatchV1 {
  return patchForFields(
    next,
    getChangedEditorFields(base, next),
  ) as EditorEventPatchV1;
}

export function applyEditorPatch(
  base: CanonicalEditorDocumentV1,
  patch: EditorPatchV1,
): CanonicalEditorDocumentV1 {
  assertCanonicalEditorDocument(base, 'base editor document');
  assertEditorPatch(patch);

  const next = clone(base);
  EDITOR_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      Object.assign(next, { [field]: clone(patch[field]) });
    }
  });
  assertCanonicalEditorDocument(next, 'patched editor document');
  return next;
}

const applyIsolatedPluginPatch = (
  base: CanonicalEditorDocumentV1,
  patch: EditorPatchV1 | EditorLegacyPatchV1,
): EditorDocumentV1 => {
  assertCanonicalEditorDocument(base, 'isolated plugin base document');
  // 플러그인 patch는 input 방향 - poseId 생략(백엔드 발급)을 허용한다
  assertEditorPatch(patch, 'editor patch', 'input');
  const next: EditorDocumentV1 = clone(base);
  EDITOR_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      Object.assign(next, { [field]: clone(patch[field]) });
    }
  });
  assertEditorDocument(next, 'isolated plugin target document', 'input');
  return next;
};

function rebaseEditorDocument(
  canonical: CanonicalEditorDocumentV1,
  pendingLocal: CanonicalEditorDocumentV1,
  localFields: readonly EditorField[],
): CanonicalEditorDocumentV1 {
  return applyEditorPatch(canonical, patchForFields(pendingLocal, localFields));
}

class EditorSaveCoordinator {
  private readonly transport: EditorCoordinatorTransport;
  private readonly readDocument: () => CanonicalEditorDocumentV1;
  private readonly applyDocument: EditorCoordinatorOptions['applyDocument'];
  private readonly createMutationId: () => string;
  private readonly focusTarget: EditorEventTarget | null;
  private readonly visibilityTarget: EditorVisibilityTarget | null;
  private readonly isReadOnly: () => boolean;
  private readonly onCommittedApplied:
    | ((event: EditorCommittedV1) => void)
    | null;
  private readonly onGestureIdsDiscarded:
    | ((gestureIds: readonly string[]) => void)
    | null;
  private readonly onStartSucceeded: (() => void | Promise<void>) | null;

  private phase: EditorCoordinatorPhase = 'idle';
  private revision: number | null = null;
  private lastAck: CanonicalEditorDocumentV1 | null = null;
  private pendingLocal: CanonicalEditorDocumentV1 | null = null;
  private pendingFields: EditorField[] = [];
  private pendingRequestFields: EditorField[] = [];
  private inFlight: InFlightCommit | null = null;
  // 커밋 의도 시점에 캡처된 게스처 ID 집합
  private pendingGestureIds: string[] = [];
  private conflict: EditorConflictState | null = null;
  private error: unknown = null;
  private failureKind: 'transient' | 'permanent' | null = null;
  private stopped = false;
  private initializing = false;

  private startPromise: Promise<CanonicalEditorGetResult> | null = null;
  private drainPromise: Promise<void> | null = null;
  private syncPromise: Promise<void> | null = null;
  private eventQueue: Promise<void> = Promise.resolve();
  private gestureCommitTail: Promise<unknown> = Promise.resolve();
  private unsubscribeCommitted: EditorReadyUnsubscribe | null = null;
  private bufferedEvents: EditorCommittedV1[] = [];
  private ownMutations = new Set<string>();
  // 낙관 적용 없이 커밋되는 격리 플러그인 mutation. own 이벤트가 도착하면
  // store 적용까지 필요하다는 표시
  private isolatedMutations = new Set<string>();
  private listeners = new Set<(state: EditorCoordinatorState) => void>();

  private readonly handleFocus = () => {
    void this.sync().catch((error) => this.recordBackgroundError(error));
  };

  private readonly handleVisibilityChange = () => {
    if (this.visibilityTarget?.visibilityState !== 'hidden') {
      void this.sync().catch((error) => this.recordBackgroundError(error));
    }
  };

  constructor(options: EditorCoordinatorOptions) {
    this.transport = options.transport;
    this.readDocument = options.readDocument;
    this.applyDocument = options.applyDocument;
    this.onCommittedApplied = options.onCommittedApplied ?? null;
    this.onGestureIdsDiscarded = options.onGestureIdsDiscarded ?? null;
    this.onStartSucceeded = options.onStartSucceeded ?? null;
    this.createMutationId =
      options.createMutationId ?? (() => crypto.randomUUID());
    this.focusTarget =
      options.focusTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.focusTarget;
    this.visibilityTarget =
      options.visibilityTarget === undefined
        ? typeof document === 'undefined'
          ? null
          : document
        : options.visibilityTarget;
    const readOnly = options.readOnly;
    this.isReadOnly =
      typeof readOnly === 'function' ? readOnly : () => readOnly ?? false;
  }

  getState(): EditorCoordinatorState {
    const latestPending = this.getLatestPendingDocument();
    return {
      phase: this.phase,
      revision: this.revision,
      dirty: latestPending !== null,
      inFlightMutationId: this.inFlight?.mutationId ?? null,
      lastAck: this.lastAck ? clone(this.lastAck) : null,
      pendingLocal: latestPending ? clone(latestPending) : null,
      conflict: this.conflict ? clone(this.conflict) : null,
      error: this.error,
      failureKind: this.failureKind,
    };
  }

  subscribe(listener: (state: EditorCoordinatorState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Promise<CanonicalEditorGetResult> {
    if (this.stopped) {
      return Promise.reject(new Error('editor coordinator is stopped'));
    }
    if (!this.startPromise) {
      this.startPromise = this.initialize().catch((error) => {
        this.startPromise = null;
        this.initializing = false;
        this.phase = 'error';
        this.error = error;
        this.detachLifecycle();
        this.unsubscribeCommitted?.();
        this.unsubscribeCommitted = null;
        this.notify();
        throw error;
      });
    }
    return this.startPromise.then(async (result) => {
      await this.onStartSucceeded?.();
      return result;
    });
  }

  async commitEditorState(
    document?: CanonicalEditorDocumentV1,
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    // gradient canonical 정규화를 assert 앞에 — 이후 diff·invoke가 같은 값 사용
    const currentDocument = canonicalizeEditorGradients(
      document ?? this.readDocument(),
    );
    assertCanonicalEditorDocument(currentDocument);
    const snapshot = clone(currentDocument);

    const projected = this.getLatestCommitBase();
    const newIntentFields = getChangedEditorFields(projected, snapshot);
    return this.queueSnapshot(snapshot, newIntentFields, []);
  }

  private async queueSnapshot(
    snapshot: CanonicalEditorDocumentV1,
    newIntentFields: readonly EditorField[],
    requestFields: readonly EditorField[],
    gestureId?: string,
    onEnrolled?: () => void,
  ): Promise<CanonicalEditorDocumentV1> {
    if (gestureId) {
      this.replacePendingGestureIds([...this.pendingGestureIds, gestureId]);
    }
    if (this.conflict) {
      const conflict = this.conflict;
      const newlyChangedFields = getChangedEditorFields(
        conflict.pendingLocal,
        snapshot,
      );
      conflict.pendingLocal = snapshot;
      conflict.localFields = EDITOR_FIELDS.filter(
        (field) =>
          conflict.localFields.includes(field) ||
          newlyChangedFields.includes(field),
      );
      // conflict pendingLocal에 실제 편입 완료 - keepLocal 해소가 소유
      onEnrolled?.();
      this.notify();
      return Promise.reject(this.error ?? new Error('editor conflict pending'));
    }

    const outstandingFields = new Set<EditorField>([
      ...(this.optimisticInFlight()?.localFields ?? []),
      ...this.pendingFields,
      ...newIntentFields,
    ]);
    this.pendingLocal = snapshot;
    this.pendingFields = EDITOR_FIELDS.filter((field) =>
      outstandingFields.has(field),
    );
    const requested = new Set<EditorField>([
      ...this.pendingRequestFields,
      ...requestFields,
    ]);
    this.pendingRequestFields = EDITOR_FIELDS.filter((field) =>
      requested.has(field),
    );
    // pending에 실제 편입 완료 - 이후 실패는 재시도·거절 경로가 소유
    onEnrolled?.();
    this.error = null;
    this.failureKind = null;
    this.notify();
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async commitPatch(
    changes: EditorPatchV1,
    meta?: { gestureId?: string },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    return this.commitPatchSettled(changes, meta?.gestureId);
  }

  // 정산 착지 시 동결 의도의 낙관 재적용. 선행 커밋(격리 plugin 쓰기 등)의
  // canonical 적용이 호출 시점의 eager 값을 지운 경우 스토어를 복구하는
  // 경로다. 다만 슬롯 대기 중 시작된 2차 eager 편집이 같은 대상을 이미
  // 덮었을 수 있어 무조건 되쓰면 진행 중 편집이 동결값으로 되돌아간다.
  // gestureTransaction의 PERSISTED_FIELDS CAS와 같은 규약으로, 현재 값이
  // 동결 시점 base와 같아 소유가 증명된 조각만 되쓴다
  // (ops는 대상 요소 조각 단위, patch는 필드 단위)
  private reapplyFrozenIntent(
    base: CanonicalEditorDocumentV1,
    mutation: { ops?: readonly EditorOpV1[]; changes?: EditorPatchV1 },
  ): void {
    const currentDocument = this.readDocument();
    assertCanonicalEditorDocument(currentDocument, 'current editor document');
    const optimisticDocument = mutation.ops
      ? applySemanticOps(
          currentDocument,
          mutation.ops.filter((op) =>
            canReapplyFrozenOp(op, base, currentDocument),
          ),
        )
      : applyEditorPatch(
          currentDocument,
          frozenPatchOwnedFields(mutation.changes!, base, currentDocument),
        );
    if (
      getChangedEditorFields(currentDocument, optimisticDocument).length > 0
    ) {
      this.applyDocument(clone(optimisticDocument), 'localPatch');
    }
  }

  // 대기 이후 공통 본문. 슬롯 안에서 재사용하므로 여기서 tail을 다시
  // 기다리면 자기 슬롯 교착이 된다
  private commitPatchSettled(
    changes: EditorPatchV1,
    gestureId?: string,
    onEnrolled?: () => void,
  ): Promise<CanonicalEditorDocumentV1> {
    // gradient canonical 정규화를 assert 앞에 — optimistic·diff·invoke가 같은 값 사용
    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges);

    const projected = this.getLatestCommitBase();
    const target = applyEditorPatch(projected, canonicalChanges);
    assertCanonicalEditorDocument(target, 'projected editor document');
    const newIntentFields = getChangedEditorFields(projected, target);
    const requestFields = EDITOR_FIELDS.filter(
      (field) => canonicalChanges[field] !== undefined,
    );
    this.reapplyFrozenIntent(projected, { changes: canonicalChanges });
    return this.queueSnapshot(
      target,
      newIntentFields,
      requestFields,
      gestureId,
      onEnrolled,
    );
  }

  // 호출 시점 캡처 patch는 대기 중 정산된 다른 커밋의 같은 컬렉션 값을
  // 통째로 되돌린다. 컬렉션 전체 레코드를 보내야 하는 호출자는 이 경로로
  // 직렬 슬롯 안에서 최신 base를 받아 patch를 생성한다. null 반환은 무커밋
  // (mutation·낙관 적용·revision 전진 전부 없음)
  commitGeneratedPatch(
    generate: (base: CanonicalEditorDocumentV1) => EditorPatchV1 | null,
    meta?: { gestureId?: string; onEnrolled?: () => void },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(async () => {
      await this.start();
      await this.drainUntilSettled();
      await this.eventQueue;
      const changes = generate(this.getLatestCommitBase());
      if (!changes) return clone(this.requireLastAck());
      // onEnrolled는 pending/conflict에 실제 편입된 직후 발화 - 호출자의
      // 롤백 판별 기준. 편입 전 종료(사전 실패·생성 예외·검증 실패)는
      // 어떤 기존 복원 경로도 이 intent를 소유하지 않는다
      return this.commitPatchSettled(
        changes,
        meta?.gestureId,
        meta?.onEnrolled,
      );
    });
  }

  commitSemanticOpsInternal(
    ops: readonly EditorOpV1[],
    meta: EditorSemanticCommitMeta = {},
  ): Promise<EditorSemanticCommitOutcome> {
    this.assertWritable();
    const frozenOps = clone([...ops]);
    try {
      assertEditorOpsV1(frozenOps);
      assertCanonicalEditorDocument(
        this.readDocument(),
        'current editor document',
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return this.enqueueSerialized(async () => {
      const result = await this.commitGeneratedSemanticOpsInSlot(
        () => frozenOps,
        meta,
      );
      if (!result) {
        throw new EditorProtocolError(
          'fixed semantic ops generated no request',
        );
      }
      return result;
    });
  }

  commitGeneratedSemanticOpsInternal(
    generate: EditorSemanticOpsGenerator,
    meta: EditorSemanticCommitMeta = {},
  ): Promise<EditorSemanticCommitOutcome | null> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitGeneratedSemanticOpsInSlot(generate, meta),
    );
  }

  discardSemanticGesture(gestureId: string): void {
    this.onGestureIdsDiscarded?.([gestureId]);
  }

  private async commitGeneratedSemanticOpsInSlot(
    generate: EditorSemanticOpsGenerator,
    meta: EditorSemanticCommitMeta,
  ): Promise<EditorSemanticCommitOutcome | null> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue;
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }

    let baseDocument = clone(this.requireLastAck());
    let baseRevision = this.requireRevision();
    let mutationId = this.createMutationId();
    let conflictRetryCount = 0;
    let totalRetryCount = 0;
    let enrolled = false;

    while (true) {
      let ops: EditorOpV1[];
      try {
        meta.preflight?.();
        const generated = generate(clone(baseDocument));
        if (!generated) {
          if (enrolled) {
            this.applyDocument(clone(this.requireLastAck()), 'rejected');
            if (meta.gestureId) {
              this.onGestureIdsDiscarded?.([meta.gestureId]);
            }
            this.error = null;
            this.failureKind = null;
            this.phase = 'idle';
            this.notify();
          }
          return null;
        }
        assertEditorOpsV1(generated);
        ops = clone([...generated]);
      } catch (error) {
        if (enrolled) {
          this.applyDocument(clone(this.requireLastAck()), 'rejected');
          if (meta.gestureId) {
            this.onGestureIdsDiscarded?.([meta.gestureId]);
          }
          this.error = null;
          this.failureKind = null;
          this.phase = 'idle';
          this.notify();
        }
        throw error;
      }
      const request: EditorCommitRequest = {
        baseRevision,
        mutationId,
        opsVersion: EDITOR_OPS_VERSION,
        ops,
        ...(meta.gestureId ? { gestureId: meta.gestureId } : {}),
      };
      const target = applySemanticOps(baseDocument, ops);
      assertCanonicalEditorDocument(target, 'semantic target document');
      this.reapplyFrozenIntent(baseDocument, { ops });
      const requestFields = [...new Set(ops.flatMap(fieldsForSemanticOp))];
      const inFlight: InFlightCommit = {
        mutationId,
        baseRevision,
        baseDocument: clone(baseDocument),
        target,
        localFields: getChangedEditorFields(baseDocument, target),
        requestFields,
        gestureIds: meta.gestureId ? [meta.gestureId] : [],
        semanticOps: true,
      };
      this.inFlight = inFlight;
      this.rememberOwnMutation(inFlight);
      this.phase = 'saving';
      this.error = null;
      this.failureKind = null;
      this.notify();
      if (!enrolled) {
        enrolled = true;
        try {
          meta.onEnrolled?.();
        } catch (error) {
          console.error('onEnrolled callback failed', error);
        }
      }

      let outcomeUnknownRetryCount = 0;
      try {
        let result: EditorCommitResult;
        let opResults: EditorOpResultV1[];
        while (true) {
          try {
            result = await this.transport.commit(request);
            assertEditorOpCommitResult(result, ops);
            opResults = clone(result.opResults!);
            this.assertSemanticChangedFields(
              baseDocument,
              ops,
              opResults,
              result,
            );
            break;
          } catch (error) {
            const outcomeUnknown =
              !isEditorCommitError(error) || error.errorCode === 'IO_ERROR';
            if (!outcomeUnknown || outcomeUnknownRetryCount >= 1) throw error;
            outcomeUnknownRetryCount += 1;
            totalRetryCount += 1;
          }
        }

        const hasMissing = opResults.some(
          (opResult) => opResult.status === 'targetMissing',
        );
        const currentRevision = this.requireRevision();
        if (hasMissing || result.revision > currentRevision + 1) {
          await this.syncSemanticCanonical();
        } else if (result.revision >= currentRevision) {
          const acknowledged = applySemanticOps(
            this.requireLastAck(),
            ops,
            opResults,
          );
          this.revision = result.revision;
          this.lastAck = clone(acknowledged);
        }
        this.error = null;
        this.failureKind = null;
        this.phase = 'idle';
        this.notify();
        this.logSemanticCommit(result, opResults, totalRetryCount);
        return {
          document: clone(this.requireLastAck()),
          opResults,
        };
      } catch (error) {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;

        if (
          isEditorCommitError(error) &&
          error.errorCode === 'REVISION_CONFLICT' &&
          conflictRetryCount < MAX_AUTO_REBASE_ATTEMPTS
        ) {
          this.ownMutations.delete(mutationId);
          try {
            const canonical = await this.syncSemanticCanonical();
            baseDocument = canonical.document;
            baseRevision = canonical.revision;
            mutationId = this.createMutationId();
            conflictRetryCount += 1;
            totalRetryCount += 1;
            continue;
          } catch (syncError) {
            this.applyDocument(clone(this.requireLastAck()), 'rejected');
            if (inFlight.gestureIds.length > 0) {
              this.onGestureIdsDiscarded?.(inFlight.gestureIds);
            }
            this.error = syncError;
            this.failureKind = 'transient';
            this.phase = 'error';
            this.notify();
            throw syncError;
          }
        }

        if (!isEditorCommitError(error) || error.errorCode !== 'IO_ERROR') {
          this.ownMutations.delete(mutationId);
        }
        let canonical: CanonicalEditorGetResult | null = null;
        try {
          canonical = await this.syncSemanticCanonical();
        } catch {
          // 원래 커밋 오류를 유지
          if (!(error instanceof EditorProtocolError)) {
            this.applyDocument(clone(this.requireLastAck()), 'rejected');
          }
        }
        const protocolOutcomeReflected =
          error instanceof EditorProtocolError &&
          canonical !== null &&
          getChangedEditorFields(
            canonical.document,
            applySemanticOps(canonical.document, ops),
          ).length === 0;
        if (protocolOutcomeReflected) {
          if (inFlight.gestureIds.length > 0) {
            this.onGestureIdsDiscarded?.(inFlight.gestureIds);
          }
          this.error = null;
          this.failureKind = null;
          this.phase = 'idle';
          this.notify();
          throw error;
        }
        const retryable =
          error instanceof EditorProtocolError ||
          !isEditorCommitError(error) ||
          isRetryableEditorCommitError(error);
        if (
          !(error instanceof EditorProtocolError) &&
          inFlight.gestureIds.length > 0
        ) {
          this.onGestureIdsDiscarded?.(inFlight.gestureIds);
        }
        this.error = error;
        this.failureKind = retryable ? 'transient' : 'permanent';
        this.phase = 'error';
        this.notify();
        throw error;
      } finally {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
      }
    }
  }

  private async syncSemanticCanonical(): Promise<CanonicalEditorGetResult> {
    const result = await this.transport.get();
    assertEditorGetResult(result);
    if (result.revision >= this.requireRevision()) {
      this.revision = result.revision;
      this.lastAck = clone(result.document);
      this.applyDocument(clone(result.document), 'resync');
      this.notify();
      return clone(result);
    }
    return {
      revision: this.requireRevision(),
      document: clone(this.requireLastAck()),
    };
  }

  private logSemanticCommit(
    result: EditorCommitResult,
    opResults: readonly EditorOpResultV1[],
    retryCount: number,
  ): void {
    const statusCounts = {
      applied: 0,
      noChange: 0,
      targetMissing: 0,
    };
    opResults.forEach(({ status }) => {
      statusCounts[status] += 1;
    });
    // semantic op 진단 지표
    // eslint-disable-next-line no-console
    console.info('[Editor] Commit completed', {
      mutationKind: 'ops',
      opCount: opResults.length,
      retryCount,
      revision: result.revision,
      ...statusCounts,
    });
  }

  // 백엔드가 문서를 직접 바꾸는 legacy 커맨드(프리셋 로드, 리셋 등) 전용
  // 배타 실행. 직렬 tail을 점유해 대기 중 stale full-record가 mutation
  // 결과를 되돌리는 순서를 차단하고, 슬롯 안에서 canonical을 재동기화한다.
  // public sync()는 tail을 기다리므로 슬롯 안에서 부르면 자기 교착
  runExclusiveLegacyMutation<T>(mutation: () => Promise<T>): Promise<T> {
    this.assertWritable();
    return this.enqueueSerialized(async () => {
      await this.start();
      await this.drainUntilSettled();
      await this.eventQueue;
      const result = await mutation();
      try {
        await this.fetchAndApplyCanonical('resync');
      } catch (error) {
        // 명령 성공을 재동기화 실패로 뒤집지 않음 - committed 이벤트가 보정
        console.error('배타 legacy mutation 재동기화 실패', error);
      }
      return result;
    });
  }

  // 플러그인 발신 커밋을 gesture 커밋과 같은 단일 직렬 큐에 태운다.
  // 별도 게이트를 두면 gesture 큐와 상호 대기 교착이 생기므로 큐는 하나만 유지
  private enqueueSerialized<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.gestureCommitTail;
    // 앞선 작업 실패가 다음 작업으로 전파되지 않게 양쪽 경로 모두 실행
    const run = previous.then(task, task);
    this.gestureCommitTail = run;
    return run;
  }

  // 플러그인 발신 keys 쓰기 전용 격리 커밋 (계약 §10)
  // 공유 snapshot 병합(queueSnapshot/drain)에 합류시키지 않고, 현재 드레인이
  // 끝난 뒤 독점 요청 1건으로 직렬화한다. 자사 커밋 진입점들은
  // waitForGestureCommits로 같은 큐를 기다리므로 multiKey provenance가
  // false → true로 승격되는 병합 경로가 구조적으로 없다
  commitIsolatedPluginPatch(
    changes: EditorPatchV1 | EditorLegacyPatchV1,
    options: { multiKey: boolean },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitIsolatedPluginPatchInner(changes, options),
    );
  }

  private async commitIsolatedPluginPatchInner(
    changes: EditorPatchV1 | EditorLegacyPatchV1,
    options: { multiKey: boolean },
  ): Promise<CanonicalEditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue;
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }

    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges, 'editor patch', 'input');
    const baseDocument = clone(this.requireLastAck());
    const target = applyIsolatedPluginPatch(baseDocument, canonicalChanges);
    const requestFields = EDITOR_FIELDS.filter(
      (field) => canonicalChanges[field] !== undefined,
    );
    if (requestFields.length === 0) return clone(this.requireLastAck());

    const baseRevision = this.requireRevision();
    const mutationId = this.createMutationId();
    const inFlight: InFlightCommit = {
      mutationId,
      baseRevision,
      baseDocument,
      target: clone(baseDocument),
      localFields: getChangedEditorFields(baseDocument, target, 'input'),
      requestFields,
      gestureIds: [],
      isolated: true,
    };
    this.inFlight = inFlight;
    this.rememberOwnMutation(inFlight, true);
    this.phase = 'saving';
    this.notify();

    try {
      const result = await this.transport.commit({
        baseRevision,
        mutationId,
        // 플러그인 격리 커밋은 v1 유지 - ID 없는 레거시 패치를 백엔드
        // adapter가 수용한다 (계약 §10)
        changes: patchForFields(target, requestFields),
        // provenance 명시 전달 - 기본값 승격 경로 없음
        multiKey: options.multiKey === true,
      });
      assertEditorCommitResult(result);
      // v1 adapter가 무ID 요소에 ID를 채우므로 canonical은 요청 target과
      // 다를 수 있고, 결과 envelope에는 adapted 값이 없다. target을 lastAck로
      // 승인하지 않고 canonical을 직접 읽어 성공했을 때만 전진한다 - 읽기가
      // 실패하면 revision을 이전 값에 묶어 두어 own committed 이벤트가
      // 선점 없이 patch를 적용해 자가 복구한다 (no-op이면 canonical이
      // 이전과 같아 복구할 것이 없다)
      const canonical = await this.transport.get();
      assertEditorGetResult(canonical);
      if (canonical.revision >= this.requireRevision()) {
        this.revision = canonical.revision;
        this.lastAck = clone(canonical.document);
      }
      // 실행 창의 로컬 문서도 canonical로 갱신 - 격리 커밋은 낙관 적용을
      // 거치지 않으므로 여기서 반영하지 않으면 이후 flush가 낡은 로컬을
      // 새 편집으로 계산해 방금 성공한 변경을 되돌린다
      this.applyDocument(clone(this.requireLastAck()), 'localPatch');
      this.error = null;
      this.failureKind = null;
      this.phase = 'idle';
      this.notify();
      return clone(this.requireLastAck());
    } catch (error) {
      // 거절돼도 코디네이터는 건강한 상태 유지 - 오류는 플러그인 호출자에게만
      // 전파하고 pending은 보존하지 않음 (conflict resync 성공 시에만 로컬이
      // canonical로 전진)
      if (
        isEditorCommitError(error) &&
        error.errorCode === 'REVISION_CONFLICT'
      ) {
        // 플러그인 호출자는 sync()에 접근할 수 없다. revision이 뒤처져
        // 거절됐다면 canonical만 재동기화해 다음 재시도가 성공하게 한다.
        // patch 자동 재적용은 하지 않는다 - concurrent writer를 덮을 수 있다
        try {
          await this.fetchAndApplyCanonical('resync');
        } catch {
          // 재동기화 실패 시 원래 conflict 오류를 유지
        }
      }
      if (!this.conflict && !this.stopped) this.phase = 'idle';
      this.notify();
      throw error;
    } finally {
      if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
    }
  }

  // 플러그인이 자체 envelope로 직접 editor_commit을 수행할 때도 같은 큐로
  // 직렬화 (계약 §10: coordinator에 예약된 변경보다 먼저 lock을 잡는 경합 차단)
  runSerializedPluginCommit<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueueSerialized(async () => {
      await this.start();
      await this.drainUntilSettled();
      await this.eventQueue;
      return task();
    });
  }

  commitGesture(
    changes: EditorGestureMutation,
    gestureId: string,
    commit: (
      context: EditorGestureCommitContext,
    ) => Promise<EditorCommitResult>,
    meta?: {
      onEnrolled?: () => void;
      prepare?: () => Promise<void>;
      reconcileRetryableEditorIntent?: () => boolean;
    },
  ): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    const previous = this.gestureCommitTail;
    // 앞선 gesture 실패가 다음 gesture로 전파되지 않게 양쪽 경로 모두 실행
    const runInner = () =>
      this.commitGestureInner(changes, gestureId, commit, meta);
    const run = previous.then(runInner, runInner);
    this.gestureCommitTail = run;
    void run.then(
      () => {
        if (this.gestureCommitTail === run) {
          this.gestureCommitTail = Promise.resolve();
        }
      },
      () => {
        if (this.gestureCommitTail === run) {
          this.gestureCommitTail = Promise.resolve();
        }
      },
    );
    return run;
  }

  async retryPending(): Promise<CanonicalEditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }
    if (!this.pendingLocal && this.pendingRequestFields.length === 0) {
      return clone(this.requireLastAck());
    }

    this.error = null;
    this.failureKind = null;
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async resolveConflict(
    resolution: EditorConflictResolution,
  ): Promise<CanonicalEditorDocumentV1> {
    if (resolution === 'keepLocal') this.assertWritable();
    await this.waitForGestureCommits();
    if (this.drainPromise) {
      await this.drainPromise.catch(() => undefined);
    }

    const conflict = this.conflict;
    if (!conflict) return clone(this.requireLastAck());

    this.conflict = null;
    this.error = null;
    this.failureKind = null;
    this.revision = conflict.canonicalRevision;
    this.lastAck = clone(conflict.canonical);

    if (resolution === 'acceptCanonical') {
      const discardedGestureIds = [...this.pendingGestureIds];
      this.pendingLocal = null;
      this.pendingFields = [];
      this.pendingRequestFields = [];
      this.pendingGestureIds = [];
      if (discardedGestureIds.length > 0) {
        this.onGestureIdsDiscarded?.(discardedGestureIds);
      }
      this.phase = 'idle';
      this.applyDocument(clone(conflict.canonical), 'acceptCanonical');
      this.notify();
      return clone(conflict.canonical);
    }

    const rebased = rebaseEditorDocument(
      conflict.canonical,
      conflict.pendingLocal,
      conflict.localFields,
    );
    this.pendingLocal = rebased;
    this.pendingFields = [...conflict.localFields];
    this.applyDocument(clone(rebased), 'keepLocal');
    this.notify();
    await this.drainUntilSettled();
    return clone(this.requireLastAck());
  }

  async sync(options: EditorSyncOptions = {}): Promise<void> {
    await this.waitForGestureCommits();
    await this.start();
    if (this.syncPromise) {
      await this.syncPromise;
    } else {
      this.syncPromise = this.fetchAndApplyCanonical('resync').finally(() => {
        this.syncPromise = null;
      });
      await this.syncPromise;
    }

    if (options.reapply) {
      const displayDocument =
        this.getLatestPendingDocument() ?? this.requireLastAck();
      this.applyDocument(clone(displayDocument), 'resync');
      this.notify();
    }
  }

  async flush(): Promise<CanonicalEditorDocumentV1> {
    await this.waitForGestureCommits();
    if (this.isReadOnly()) {
      await this.start();
      await this.eventQueue;
      return clone(this.requireLastAck());
    }
    // 인자 없이 호출해 내부 대기 후 캡처 - 대기 사이 착지한 병행 커밋 보존
    await this.commitEditorState();
    if (this.drainPromise) await this.drainPromise;
    await this.eventQueue;
    return clone(this.requireLastAck());
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribeCommitted?.();
    this.unsubscribeCommitted = null;
    this.detachLifecycle();
    this.phase = 'stopped';
    this.notify();
  }

  private async initialize(): Promise<CanonicalEditorGetResult> {
    this.phase = 'initializing';
    this.error = null;
    this.failureKind = null;
    this.initializing = true;
    this.notify();

    this.unsubscribeCommitted = this.transport.onCommitted((event) => {
      if (this.stopped) return;
      if (this.initializing) {
        this.bufferedEvents.push(clone(event));
        return;
      }
      void this.enqueueEvent(event).catch((error) =>
        this.recordBackgroundError(error),
      );
    });
    await this.unsubscribeCommitted.ready;
    this.attachLifecycle();

    const result = await this.transport.get();
    assertEditorGetResult(result);
    this.revision = result.revision;
    this.lastAck = clone(result.document);
    this.applyDocument(clone(result.document), 'initial');
    this.initializing = false;

    const buffered = this.bufferedEvents;
    this.bufferedEvents = [];
    for (const event of buffered) {
      await this.processCommittedEventWithRecovery(event);
    }

    if (!this.conflict) this.phase = 'idle';
    this.notify();
    return clone(result);
  }

  private ensureDrain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;

    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (!this.conflict && !this.error && !this.stopped) {
        this.phase = 'idle';
      }
      this.notify();
    });
    return this.drainPromise;
  }

  private async drainUntilSettled(): Promise<void> {
    do {
      await this.ensureDrain();
    } while (
      (this.pendingLocal || this.pendingRequestFields.length > 0) &&
      !this.conflict &&
      !this.stopped
    );
  }

  private async drain(): Promise<void> {
    let rebaseAttempts = 0;

    while (
      (this.pendingLocal || this.pendingRequestFields.length > 0) &&
      !this.conflict &&
      !this.stopped
    ) {
      const target = this.pendingLocal ?? clone(this.requireLastAck());
      const actualChangedFields = getChangedEditorFields(
        this.requireLastAck(),
        target,
      );
      const localFields = this.pendingFields.filter((field) =>
        actualChangedFields.includes(field),
      );
      const requested = new Set<EditorField>([
        ...localFields,
        ...this.pendingRequestFields,
      ]);
      const requestFields = EDITOR_FIELDS.filter((field) =>
        requested.has(field),
      );
      this.pendingLocal = null;
      this.pendingFields = [];
      this.pendingRequestFields = [];

      if (requestFields.length === 0) {
        continue;
      }

      const baseDocument = clone(this.requireLastAck());
      const baseRevision = this.requireRevision();
      const mutationId = this.createMutationId();
      const gestureIds = this.pendingGestureIds;
      this.pendingGestureIds = [];
      const gestureId = gestureIds.at(-1);
      const inFlight: InFlightCommit = {
        mutationId,
        baseRevision,
        baseDocument,
        target: clone(target),
        localFields,
        requestFields,
        gestureIds,
      };
      this.inFlight = inFlight;
      this.rememberOwnMutation(inFlight);
      this.phase = 'saving';
      this.notify();

      try {
        const result = await this.transport.commit({
          baseRevision,
          mutationId,
          // 자사 커밋은 v2 - 백엔드가 ID 필수와 merged 유일성을 검증한다
          changes: patchForFields(
            target,
            requestFields,
            EDITOR_COMMIT_SCHEMA_VERSION,
          ),
          ...(gestureId ? { gestureId } : {}),
          ...(gestureIds.length > 0 ? { gestureIds } : {}),
        });
        assertEditorCommitResult(result);
        await this.applyCommitResult(inFlight, result);
        rebaseAttempts = 0;
      } catch (error) {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;

        if (
          isEditorCommitError(error) &&
          error.errorCode === 'REVISION_CONFLICT'
        ) {
          this.restorePendingGestureIds(inFlight.gestureIds);
          let didRebase: boolean;
          try {
            didRebase = await this.handleRevisionConflict(
              inFlight,
              error,
              rebaseAttempts,
            );
          } catch (syncError) {
            this.preservePending(
              inFlight.target,
              inFlight.localFields,
              inFlight.requestFields,
            );
            this.phase = 'error';
            this.error = syncError;
            this.failureKind = 'transient';
            this.notify();
            throw syncError;
          }
          if (didRebase) {
            rebaseAttempts += 1;
            continue;
          }
        } else if (
          isEditorCommitError(error) &&
          isRetryableEditorCommitError(error)
        ) {
          this.preservePending(
            inFlight.target,
            inFlight.localFields,
            inFlight.requestFields,
          );
          this.restorePendingGestureIds(inFlight.gestureIds);
          this.phase = 'error';
          this.error = error;
          this.failureKind = 'transient';
          this.notify();
        } else {
          this.discardRejectedPending(error, mutationId, inFlight.gestureIds);
        }
        throw error;
      } finally {
        if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
      }
    }
  }

  private async commitGestureInner(
    changes: EditorGestureMutation,
    gestureId: string,
    commit: (
      context: EditorGestureCommitContext,
    ) => Promise<EditorCommitResult>,
    meta?: {
      onEnrolled?: () => void;
      prepare?: () => Promise<void>;
      reconcileRetryableEditorIntent?: () => boolean;
    },
  ): Promise<CanonicalEditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue;
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }
    if (meta?.prepare) {
      // 슬롯 안 준비 단계(plugin 큐 drain·projection 봉인 등) - 대기 중
      // 들어온 이벤트를 반영한 뒤 base를 동결해야 projection과 정렬된다
      await meta.prepare();
      await this.eventQueue;
      if (this.conflict) {
        throw this.error ?? new Error('editor conflict pending');
      }
    }

    const baseDocument = clone(this.requireLastAck());
    // generator는 직렬 슬롯 안에서 최신 base로 평가한다 - 호출 시점 캡처
    // full-record는 대기 중 정산된 다른 커밋의 컬렉션 값을 되돌린다.
    // null 반환은 editorChanges 없음일 뿐 transaction callback은 실행된다
    // (plugin 변경만 커밋하는 혼합 게스처)
    const resolvedMutation =
      typeof changes === 'function' ? changes(clone(baseDocument)) : changes;
    let ops: EditorOpV1[] | undefined;
    let resolvedChanges: EditorPatchV1 | null | undefined;
    if (isGestureOpsMutation(resolvedMutation)) {
      ops = clone([...resolvedMutation.ops]);
      assertEditorOpsV1(ops);
    } else {
      resolvedChanges = resolvedMutation;
    }
    const canonicalChanges = resolvedChanges
      ? canonicalizeEditorGradients(resolvedChanges)
      : undefined;
    if (canonicalChanges) assertEditorPatch(canonicalChanges);
    const target = ops
      ? applySemanticOps(baseDocument, ops)
      : canonicalChanges
      ? applyEditorPatch(baseDocument, canonicalChanges)
      : baseDocument;
    assertCanonicalEditorDocument(target, 'gesture target document');
    const requestFields = ops
      ? [...new Set(ops.flatMap(fieldsForSemanticOp))]
      : canonicalChanges
      ? EDITOR_FIELDS.filter((field) => canonicalChanges[field] !== undefined)
      : [];
    const localFields = getChangedEditorFields(baseDocument, target);
    // 슬롯 내 로컬 낙관 재적용 - wire만 고치면 백엔드는 맞고 UI 스토어는
    // 옛 값에 남는 경우가 있어 CAS 통과분만 되쓴다
    if (ops) {
      this.reapplyFrozenIntent(baseDocument, { ops });
    } else if (canonicalChanges) {
      this.reapplyFrozenIntent(baseDocument, { changes: canonicalChanges });
    }
    const mutationId = this.createMutationId();
    const inFlight: InFlightCommit = {
      mutationId,
      baseRevision: this.requireRevision(),
      baseDocument,
      target: clone(target),
      localFields,
      requestFields,
      gestureIds: [gestureId],
      semanticOps: ops !== undefined,
    };
    this.inFlight = inFlight;
    this.rememberOwnMutation(inFlight);
    this.phase = 'saving';
    this.notify();
    try {
      // 편입 관측점 - 이후 실패는 gesture 실패 경로(pending·conflict)가
      // 소유한다. no-throw 계약이지만 방어적으로 격리
      meta?.onEnrolled?.();
    } catch (error) {
      console.error('onEnrolled callback failed', error);
    }

    try {
      const result = await commit({
        editorBaseRevision: inFlight.baseRevision,
        mutationId,
        // 게스처 커밋도 자사 전용 경로라 v2
        ...(ops
          ? { editorOpsVersion: EDITOR_OPS_VERSION, editorOps: ops }
          : requestFields.length > 0
          ? {
              editorChanges: patchForFields(
                target,
                requestFields,
                EDITOR_COMMIT_SCHEMA_VERSION,
              ),
            }
          : {}),
      });
      if (ops) {
        assertEditorOpCommitResult(result, ops);
        this.assertSemanticChangedFields(
          inFlight.baseDocument,
          ops,
          result.opResults!,
          result,
        );
        await this.applySemanticGestureCommitResult(ops, result);
        this.logSemanticCommit(result, result.opResults!, 0);
      } else {
        assertEditorCommitResult(result);
        await this.applyCommitResult(inFlight, result);
      }
      this.error = null;
      this.failureKind = null;
      this.phase = 'idle';
      this.notify();
      return clone(this.requireLastAck());
    } catch (error) {
      this.ownMutations.delete(mutationId);
      const retryable =
        isEditorCommitError(error) && isRetryableEditorCommitError(error);
      const reconcileEditorIntent =
        retryable && meta?.reconcileRetryableEditorIntent?.() === true;
      if (reconcileEditorIntent) {
        this.restorePendingGestureIds(inFlight.gestureIds);
        let didRebase: boolean;
        try {
          didRebase = await this.handleRevisionConflict(inFlight, error, 0);
        } catch (syncError) {
          this.preservePending(
            inFlight.target,
            inFlight.localFields,
            inFlight.requestFields,
          );
          this.phase = 'error';
          this.error = syncError;
          this.failureKind = 'transient';
          this.notify();
          throw syncError;
        }
        if (!didRebase) throw error;

        await this.drainUntilSettled();
        this.error = null;
        this.failureKind = null;
        this.phase = 'idle';
        this.notify();
        return clone(this.requireLastAck());
      }
      if (retryable) {
        try {
          const canonical = await this.transport.get();
          assertEditorGetResult(canonical);
          if (canonical.revision >= this.requireRevision()) {
            this.revision = canonical.revision;
            this.lastAck = clone(canonical.document);
          }
        } catch {
          // 원래 transaction 오류를 유지
        }
      }
      if (!retryable && inFlight.gestureIds.length > 0) {
        this.onGestureIdsDiscarded?.(inFlight.gestureIds);
      }
      this.applyRejectedGestureProjection(inFlight);
      this.error = error;
      this.failureKind = retryable ? 'transient' : 'permanent';
      this.phase = 'error';
      this.notify();
      throw error;
    } finally {
      if (this.inFlight?.mutationId === mutationId) this.inFlight = null;
    }
  }

  private applyRejectedGestureProjection(inFlight: InFlightCommit): void {
    const local = this.readDocument();
    const changedAfterTarget = new Set(
      getChangedEditorFields(inFlight.target, local),
    );
    const changedAfterBase = new Set(
      getChangedEditorFields(inFlight.baseDocument, local),
    );
    const rollbackFields = inFlight.localFields.filter(
      (field) => !changedAfterTarget.has(field) || !changedAfterBase.has(field),
    );
    if (rollbackFields.length === 0) return;

    // 실패한 transaction 이후의 낙관 편집은 rollback 소유 범위 밖
    const rejected = applyEditorPatch(
      local,
      patchForFields(this.requireLastAck(), rollbackFields),
    );
    this.applyDocument(clone(rejected), 'rejected');
  }

  private async waitForGestureCommits(): Promise<void> {
    await this.gestureCommitTail.catch(() => undefined);
  }

  private async applyCommitResult(
    inFlight: InFlightCommit,
    result: EditorCommitResult,
  ): Promise<void> {
    const currentRevision = this.requireRevision();
    if (result.revision > currentRevision + 1) {
      await this.fetchAndApplyCanonical('resync');
      return;
    }

    if (result.revision >= currentRevision) {
      this.revision = result.revision;
      if (
        result.revision > currentRevision ||
        result.changedFields.length === 0
      ) {
        this.lastAck = clone(inFlight.target);
      }
    }
    this.error = null;
    this.failureKind = null;
  }

  private async applySemanticGestureCommitResult(
    ops: readonly EditorOpV1[],
    result: EditorCommitResult,
  ): Promise<void> {
    const opResults = result.opResults!;
    const currentRevision = this.requireRevision();
    if (
      opResults.some(({ status }) => status === 'targetMissing') ||
      result.revision > currentRevision + 1
    ) {
      await this.syncSemanticCanonical();
      return;
    }
    if (result.revision >= currentRevision) {
      this.revision = result.revision;
      this.lastAck = applySemanticOps(this.requireLastAck(), ops, opResults);
    }
    this.error = null;
    this.failureKind = null;
  }

  private assertSemanticChangedFields(
    base: CanonicalEditorDocumentV1,
    ops: readonly EditorOpV1[],
    opResults: readonly EditorOpResultV1[],
    result: EditorCommitResult,
  ): void {
    const expected = getChangedEditorFields(
      base,
      applySemanticOps(base, ops, opResults),
    );
    if (
      expected.length !== result.changedFields.length ||
      expected.some((field) => !result.changedFields.includes(field))
    ) {
      throw new EditorProtocolError(
        'editor ops changedFields does not match canonical projection',
      );
    }
  }

  private async handleRevisionConflict(
    inFlight: InFlightCommit,
    error: EditorCommitError,
    rebaseAttempts: number,
  ): Promise<boolean> {
    const requested = new Set<EditorField>([
      ...this.pendingRequestFields,
      ...inFlight.requestFields,
    ]);
    this.pendingRequestFields = EDITOR_FIELDS.filter((field) =>
      requested.has(field),
    );

    if (this.conflict) {
      this.error = error;
      this.failureKind = null;
      this.phase = 'conflict';
      this.notify();
      return false;
    }

    const result = await this.transport.get();
    assertEditorGetResult(result);

    const pending = this.pendingLocal ?? inFlight.target;
    const localFields =
      this.pendingLocal !== null
        ? [...this.pendingFields]
        : inFlight.localFields;
    const remainingLocalFields = unresolvedLocalFields(
      localFields,
      pending,
      result.document,
    );
    const remoteFields = getChangedEditorFields(
      inFlight.baseDocument,
      result.document,
    );
    const overlappingFields = fieldsOverlap(remainingLocalFields, remoteFields);
    const rebased = rebaseEditorDocument(
      result.document,
      pending,
      remainingLocalFields,
    );

    this.revision = result.revision;
    this.lastAck = clone(result.document);
    this.applyDocument(clone(rebased), 'rebase');

    if (
      overlappingFields.length > 0 ||
      (remainingLocalFields.length > 0 &&
        rebaseAttempts >= MAX_AUTO_REBASE_ATTEMPTS)
    ) {
      this.pendingLocal = null;
      this.pendingFields = [];
      this.conflict = {
        lastAck: clone(inFlight.baseDocument),
        pendingLocal: clone(pending),
        canonical: clone(result.document),
        canonicalRevision: result.revision,
        localFields: [...remainingLocalFields],
        overlappingFields,
        reason: overlappingFields.length > 0 ? 'overlap' : 'rebaseLimit',
      };
      this.error = error;
      this.failureKind = null;
      this.phase = 'conflict';
      this.notify();
      return false;
    }

    this.pendingLocal = remainingLocalFields.length > 0 ? rebased : null;
    this.pendingFields = [...remainingLocalFields];
    this.error = null;
    this.failureKind = null;
    this.notify();
    return true;
  }

  private enqueueEvent(event: EditorCommittedV1): Promise<void> {
    const queued = this.eventQueue.then(() =>
      this.processCommittedEventWithRecovery(event),
    );
    this.eventQueue = queued.catch(() => undefined);
    return queued;
  }

  private async processCommittedEventWithRecovery(
    event: EditorCommittedV1,
  ): Promise<void> {
    let previewSettled = false;
    const settlePreview = () => {
      if (previewSettled) return;
      previewSettled = true;
      this.onCommittedApplied?.(event);
    };
    try {
      await this.processCommittedEvent(event, settlePreview);
    } catch (error) {
      if (!(error instanceof EditorProtocolError)) throw error;
      this.ownMutations.delete(event.mutationId);
      this.isolatedMutations.delete(event.mutationId);
      try {
        await this.fetchAndApplyCanonical('resync');
      } finally {
        // 잘못된 이벤트도 프리뷰 세션 정리를 막지 않는다
        settlePreview();
      }
    }
  }

  private async processCommittedEvent(
    event: EditorCommittedV1,
    settlePreview: () => void = () => this.onCommittedApplied?.(event),
  ): Promise<void> {
    assertEditorCommittedEvent(event);
    if (this.stopped || this.revision === null || !this.lastAck) return;

    if (event.revision <= this.revision) {
      this.ownMutations.delete(event.mutationId);
      this.isolatedMutations.delete(event.mutationId);
      settlePreview();
      return;
    }
    if (event.revision > this.revision + 1) {
      try {
        await this.fetchAndApplyCanonical('resync');
      } finally {
        // 프리뷰 정리는 canonical 재동기화 성공 여부와 독립
        settlePreview();
      }
      return;
    }

    const previousCanonical = this.lastAck;
    const canonical = applyEditorPatch(previousCanonical, event.patch);
    assertCanonicalEditorDocument(
      canonical,
      'editor:committed canonical document',
    );
    const isOwnMutation = this.ownMutations.has(event.mutationId);
    if (isOwnMutation) this.ownMutations.delete(event.mutationId);
    this.revision = event.revision;
    this.lastAck = clone(canonical);

    if (isOwnMutation) {
      this.error = null;
      // 격리 커밋은 낙관 적용이 없다. 커밋 경로의 canonical 재동기화가
      // 실패했을 때만 이 분기까지 오므로 store에도 적용해야 다음 flush가
      // 성공한 플러그인 변경을 낡은 로컬로 되돌리지 않는다
      if (this.isolatedMutations.delete(event.mutationId)) {
        this.applyExternalCanonical(
          canonical,
          event.changedFields,
          event.revision,
          'event',
          previousCanonical,
        );
      } else {
        this.notify();
      }
      settlePreview();
      return;
    }

    this.applyExternalCanonical(
      canonical,
      event.changedFields,
      event.revision,
      'event',
      previousCanonical,
    );
    settlePreview();
  }

  private async fetchAndApplyCanonical(
    reason: Extract<EditorApplyReason, 'resync'>,
  ): Promise<void> {
    const result = await this.transport.get();
    assertEditorGetResult(result);

    if (this.revision !== null && result.revision < this.revision) return;
    if (this.revision === result.revision && this.lastAck) return;

    const previous = this.lastAck;
    this.revision = result.revision;
    this.lastAck = clone(result.document);

    if (!previous) {
      this.applyDocument(clone(result.document), reason);
      this.notify();
      return;
    }

    const remoteFields = getChangedEditorFields(previous, result.document);
    this.applyExternalCanonical(
      result.document,
      remoteFields,
      result.revision,
      reason,
      previous,
    );
  }

  private applyExternalCanonical(
    canonical: CanonicalEditorDocumentV1,
    changedFields: readonly EditorField[],
    canonicalRevision: number,
    reason: Extract<EditorApplyReason, 'event' | 'resync'>,
    previousCanonical?: CanonicalEditorDocumentV1,
  ): void {
    const comparisonBase = this.conflict?.lastAck ?? previousCanonical;
    const pending = this.getLatestPendingDocument();

    if (!pending || !comparisonBase) {
      this.applyDocument(clone(canonical), reason);
      this.error = null;
      this.failureKind = null;
      this.notify();
      return;
    }

    const localFields = this.getLatestPendingFields(comparisonBase, pending);
    const remainingLocalFields = unresolvedLocalFields(
      localFields,
      pending,
      canonical,
    );
    const remoteFields = this.conflict
      ? getChangedEditorFields(comparisonBase, canonical)
      : [...changedFields];
    const overlappingFields = fieldsOverlap(remainingLocalFields, remoteFields);
    const rebased = rebaseEditorDocument(
      canonical,
      pending,
      remainingLocalFields,
    );

    this.applyDocument(clone(rebased), 'rebase');
    if (
      overlappingFields.length > 0 ||
      (this.conflict?.reason === 'rebaseLimit' &&
        remainingLocalFields.length > 0)
    ) {
      this.pendingLocal = null;
      this.pendingFields = [];
      this.conflict = {
        lastAck: clone(comparisonBase),
        pendingLocal: clone(pending),
        canonical: clone(canonical),
        canonicalRevision,
        localFields: [...remainingLocalFields],
        overlappingFields,
        reason:
          overlappingFields.length > 0
            ? 'overlap'
            : this.conflict?.reason ?? 'rebaseLimit',
      };
      this.phase = 'conflict';
    } else {
      this.conflict = null;
      this.pendingLocal = remainingLocalFields.length > 0 ? rebased : null;
      this.pendingFields = [...remainingLocalFields];
    }
    this.notify();
  }

  // 격리 커밋은 낙관 편집이 아니고 semantic op는 자체 재시도 의도를 가진다.
  // 둘의 full-record target을 일반 pending으로 세면 외부 이벤트와 겹칠 때
  // 이미 별도로 재시도할 op가 conflict 문서로도 한 번 더 남는다
  private optimisticInFlight(): InFlightCommit | null {
    if (!this.inFlight || this.inFlight.isolated || this.inFlight.semanticOps) {
      return null;
    }
    return this.inFlight;
  }

  private getLatestCommitBase(): CanonicalEditorDocumentV1 {
    if (this.conflict) return clone(this.conflict.pendingLocal);
    if (this.pendingLocal) return clone(this.pendingLocal);
    const optimistic = this.optimisticInFlight();
    if (optimistic) return clone(optimistic.target);
    return clone(this.requireLastAck());
  }

  private getLatestPendingDocument(): CanonicalEditorDocumentV1 | null {
    return (
      this.conflict?.pendingLocal ??
      this.pendingLocal ??
      this.optimisticInFlight()?.target ??
      null
    );
  }

  private getLatestPendingFields(
    comparisonBase: CanonicalEditorDocumentV1,
    pending: CanonicalEditorDocumentV1,
  ): EditorField[] {
    if (this.conflict) return [...this.conflict.localFields];
    if (this.pendingLocal) return [...this.pendingFields];
    const optimistic = this.optimisticInFlight();
    if (optimistic) return [...optimistic.localFields];
    return getChangedEditorFields(comparisonBase, pending);
  }

  private preservePending(
    document: CanonicalEditorDocumentV1,
    localFields: readonly EditorField[],
    requestFields: readonly EditorField[] = [],
  ): void {
    if (!this.pendingLocal) {
      this.pendingLocal = clone(document);
      this.pendingFields = [...localFields];
    }
    const requested = new Set<EditorField>([
      ...this.pendingRequestFields,
      ...requestFields,
    ]);
    this.pendingRequestFields = EDITOR_FIELDS.filter((field) =>
      requested.has(field),
    );
  }

  private restorePendingGestureIds(gestureIds: readonly string[]): void {
    this.replacePendingGestureIds([...gestureIds, ...this.pendingGestureIds]);
  }

  private replacePendingGestureIds(gestureIds: readonly string[]): void {
    const seen = new Set<string>();
    const retainedNewestFirst: string[] = [];
    const discardedNewestFirst: string[] = [];

    for (let index = gestureIds.length - 1; index >= 0; index -= 1) {
      const gestureId = gestureIds[index];
      if (seen.has(gestureId)) continue;
      seen.add(gestureId);
      if (retainedNewestFirst.length < MAX_PENDING_GESTURE_IDS) {
        retainedNewestFirst.push(gestureId);
      } else {
        discardedNewestFirst.push(gestureId);
      }
    }

    this.pendingGestureIds = retainedNewestFirst.reverse();
    if (discardedNewestFirst.length > 0) {
      this.onGestureIdsDiscarded?.(discardedNewestFirst.reverse());
    }
  }

  private discardRejectedPending(
    error: unknown,
    mutationId: string,
    rejectedGestureIds: readonly string[] = [],
  ): void {
    this.ownMutations.delete(mutationId);
    const discardedGestureIds = [
      ...new Set([...rejectedGestureIds, ...this.pendingGestureIds]),
    ];
    this.pendingLocal = null;
    this.pendingFields = [];
    this.pendingRequestFields = [];
    this.pendingGestureIds = [];
    if (discardedGestureIds.length > 0) {
      this.onGestureIdsDiscarded?.(discardedGestureIds);
    }
    this.phase = 'error';
    this.error = error;
    this.failureKind = 'permanent';
    this.applyDocument(clone(this.requireLastAck()), 'rejected');
    this.notify();
  }

  private rememberOwnMutation(
    inFlight: InFlightCommit,
    isolated = false,
  ): void {
    this.ownMutations.add(inFlight.mutationId);
    if (isolated) this.isolatedMutations.add(inFlight.mutationId);
    while (this.ownMutations.size > MAX_TRACKED_MUTATIONS) {
      const oldest = this.ownMutations.values().next().value;
      if (oldest === undefined) break;
      this.ownMutations.delete(oldest);
      this.isolatedMutations.delete(oldest);
    }
  }

  private attachLifecycle(): void {
    this.focusTarget?.addEventListener('focus', this.handleFocus);
    this.visibilityTarget?.addEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
  }

  private detachLifecycle(): void {
    this.focusTarget?.removeEventListener('focus', this.handleFocus);
    this.visibilityTarget?.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
  }

  private recordBackgroundError(error: unknown): void {
    this.error = error;
    this.failureKind = null;
    if (!this.inFlight && !this.conflict) this.phase = 'error';
    this.notify();
  }

  private requireRevision(): number {
    if (this.revision === null) {
      throw new Error('editor coordinator has not initialized a revision');
    }
    return this.revision;
  }

  private requireLastAck(): CanonicalEditorDocumentV1 {
    if (!this.lastAck) {
      throw new Error('editor coordinator has not initialized a document');
    }
    return this.lastAck;
  }

  private assertWritable(): void {
    if (this.isReadOnly()) throw new EditorReadOnlyError();
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const state = this.getState();
    this.listeners.forEach((listener) => {
      try {
        listener(state);
      } catch (error) {
        console.error('[Editor] Coordinator state listener failed', error);
      }
    });
  }
}

export const createEditorCoordinator = (
  options: EditorCoordinatorOptions,
): EditorSaveCoordinator => new EditorSaveCoordinator(options);
