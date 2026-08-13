import { stableStringify } from '@utils/core/stableStringify';
import { normalizeLayerGroupsForMode } from '@utils/layerGroupUtils';
import {
  inheritedPaintMaterialization,
  paintPropertyFields,
} from '@src/types/color';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
  DEFAULT_ELEMENT_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { isEditorShadowPropertyPatchV1 } from '@src/types/editor';

import {
  EDITOR_COMMIT_SCHEMA_VERSION,
  EDITOR_FIELDS,
  EDITOR_SCHEMA_VERSION,
  EditorProtocolError,
  assertEditorCommitResult,
  assertEditorCommittedEvent,
  assertEditorDocument,
  assertEditorGetResult,
  assertEditorOpCommitResult,
  assertEditorOpsV1,
  assertEditorPatch,
  canonicalizeEditorGradients,
  isEditorCommitError,
} from '@src/types/editor';

import type {
  EditorCommitError,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorDocumentV1,
  EditorElementTypeV1,
  EditorField,
  EditorGetResult,
  EditorGestureCommitContext,
  EditorOpResultV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';

export type EditorApplyReason =
  | 'initial'
  | 'localPatch'
  | 'event'
  | 'resync'
  | 'rebase'
  | 'rejected'
  | 'keepLocal'
  | 'acceptCanonical';

export type EditorConflictReason = 'overlap' | 'rebaseLimit';
export type EditorConflictResolution = 'keepLocal' | 'acceptCanonical';

export interface EditorConflictState {
  lastAck: EditorDocumentV1;
  pendingLocal: EditorDocumentV1;
  canonical: EditorDocumentV1;
  canonicalRevision: number;
  localFields: EditorField[];
  overlappingFields: EditorField[];
  reason: EditorConflictReason;
}

export type EditorCoordinatorPhase =
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
  lastAck: EditorDocumentV1 | null;
  pendingLocal: EditorDocumentV1 | null;
  conflict: EditorConflictState | null;
  error: unknown;
  failureKind: 'transient' | 'permanent' | null;
}

export type EditorReadyUnsubscribe = (() => void) & { ready: Promise<void> };

// 직렬 슬롯 안에서 최신 base로 patch를 재생성하는 게스처 커밋 입력.
// null = editorChanges 없음 (plugin transaction은 실행)
export type EditorPatchGenerator = (
  base: EditorDocumentV1,
) => EditorPatchV1 | null;

export interface EditorGestureOpsMutation {
  opsVersion: 1;
  ops: readonly EditorOpV1[];
}

type EditorGestureMutationGenerator = (
  base: EditorDocumentV1,
) => EditorPatchV1 | EditorGestureOpsMutation | null;

export type EditorGestureMutation =
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
  readDocument(): EditorDocumentV1;
  applyDocument(document: EditorDocumentV1, reason: EditorApplyReason): void;
  createMutationId?: () => string;
  focusTarget?: EditorEventTarget | null;
  visibilityTarget?: EditorVisibilityTarget | null;
  readOnly?: boolean | (() => boolean);
  // committed 이벤트가 canonical에 반영된 직후 호출 (프리뷰 오버레이 정리용)
  onCommittedApplied?: (event: EditorCommittedV1) => void;
  onGestureIdsDiscarded?: (gestureIds: readonly string[]) => void;
  onStartSucceeded?: () => void | Promise<void>;
}

export interface EditorSyncOptions {
  reapply?: boolean;
}

export interface EditorSemanticCommitOutcome {
  document: EditorDocumentV1;
  opResults: EditorOpResultV1[];
}

export interface EditorSemanticCommitMeta {
  gestureId?: string;
  onEnrolled?: () => void;
  preflight?: () => void;
}

export type EditorSemanticOpsGenerator = (
  base: EditorDocumentV1,
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
  baseDocument: EditorDocumentV1;
  target: EditorDocumentV1;
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
  pendingLocal: EditorDocumentV1,
  canonical: EditorDocumentV1,
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
  if (op.kind === 'patchElement') {
    return [SEMANTIC_POSITION_FIELDS[op.elementType]];
  }
  if (op.kind === 'setKeySlot') return ['keys'];
  const positionField = SEMANTIC_POSITION_FIELDS[op.elementType];
  if (op.kind === 'setBounds') return [positionField];
  return op.elementType === 'key' ? ['keys', 'keyPositions'] : [positionField];
};

const applySemanticOps = (
  base: EditorDocumentV1,
  ops: readonly EditorOpV1[],
  results?: readonly EditorOpResultV1[],
): EditorDocumentV1 => {
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
          Array<Record<string, unknown> & { id?: string }>
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
          Array<Record<string, unknown> & { id?: string }>
        >;
        next[field] = {
          ...record,
          [op.mode]: (record[op.mode] ?? []).map((position) => {
            const id = position.id;
            if (!id) return position;
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
          layerGroups: next.layerGroups,
        });
        next.keyPositions = normalized.keyPositions;
        next.statPositions = normalized.statPositions;
        next.graphPositions = normalized.graphPositions;
        next.knobPositions = normalized.knobPositions;
        next.layerGroups = normalized.layerGroups;
      }
      return;
    }
    if (op.kind === 'patchElement') {
      if (result?.status === 'noChange') return;
      const field = SEMANTIC_POSITION_FIELDS[op.elementType];
      const record = next[field] as Record<
        string,
        Array<Record<string, unknown> & { id?: string }>
      >;
      for (const [mode, positions] of Object.entries(record)) {
        const index = positions.findIndex((position) => position.id === op.id);
        if (index < 0) continue;
        next[field] = {
          ...record,
          [mode]: positions.map((position, positionIndex) => {
            if (positionIndex !== index) return position;
            if ('layerName' in op.patch) {
              const updated = { ...position };
              if (op.patch.layerName === null) delete updated.layerName;
              else updated.layerName = op.patch.layerName;
              return updated;
            }
            if ('graphType' in op.patch) {
              return { ...position, graphType: op.patch.graphType };
            }
            if ('graphColor' in op.patch) {
              return { ...position, graphColor: op.patch.graphColor };
            }
            if ('showAvgLine' in op.patch) {
              return { ...position, showAvgLine: op.patch.showAvgLine };
            }
            if ('graphAnimationEnabled' in op.patch) {
              return {
                ...position,
                graphAnimationEnabled: op.patch.graphAnimationEnabled,
              };
            }
            if ('graphSpeed' in op.patch) {
              return { ...position, graphSpeed: op.patch.graphSpeed };
            }
            if ('reverse' in op.patch) {
              return { ...position, reverse: op.patch.reverse };
            }
            if ('sensitivity' in op.patch) {
              return { ...position, sensitivity: op.patch.sensitivity };
            }
            if ('axisId' in op.patch) {
              return { ...position, axisId: op.patch.axisId };
            }
            if ('soundEnabled' in op.patch) {
              return { ...position, soundEnabled: op.patch.soundEnabled };
            }
            if ('soundVolume' in op.patch) {
              return { ...position, soundVolume: op.patch.soundVolume };
            }
            if ('soundPath' in op.patch) {
              return { ...position, soundPath: op.patch.soundPath };
            }
            if ('inactiveImage' in op.patch) {
              return { ...position, inactiveImage: op.patch.inactiveImage };
            }
            if ('activeImage' in op.patch) {
              return { ...position, activeImage: op.patch.activeImage };
            }
            if ('idleTransparent' in op.patch) {
              return {
                ...position,
                idleTransparent: op.patch.idleTransparent,
              };
            }
            if ('activeTransparent' in op.patch) {
              return {
                ...position,
                activeTransparent: op.patch.activeTransparent,
              };
            }
            if ('idleImageFit' in op.patch) {
              return { ...position, idleImageFit: op.patch.idleImageFit };
            }
            if ('activeImageFit' in op.patch) {
              return { ...position, activeImageFit: op.patch.activeImageFit };
            }
            if ('counterEnabled' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, enabled: op.patch.counterEnabled },
              };
            }
            if ('counterAnimationEnabled' in op.patch) {
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
                    enabled: op.patch.counterAnimationEnabled,
                  },
                },
              };
            }
            if ('counterPlacement' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, placement: op.patch.counterPlacement },
              };
            }
            if ('counterAlign' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, align: op.patch.counterAlign },
              };
            }
            if ('counterAlignMode' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, alignMode: op.patch.counterAlignMode },
              };
            }
            if ('counterGap' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, gap: op.patch.counterGap },
              };
            }
            if ('counterFontSize' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontSize: op.patch.counterFontSize },
              };
            }
            if ('counterFontWeight' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontWeight: op.patch.counterFontWeight },
              };
            }
            if ('counterFontItalic' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: { ...counter, fontItalic: op.patch.counterFontItalic },
              };
            }
            if ('counterFontUnderline' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontUnderline: op.patch.counterFontUnderline,
                },
              };
            }
            if ('counterFontStrikethrough' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontStrikethrough: op.patch.counterFontStrikethrough,
                },
              };
            }
            if ('counterFontFamily' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              return {
                ...position,
                counter: {
                  ...counter,
                  fontFamily: op.patch.counterFontFamily,
                },
              };
            }
            if (
              'counterStrokeIdle' in op.patch ||
              'counterStrokeActive' in op.patch
            ) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              const stroke = (counter?.stroke ?? {}) as Record<string, unknown>;
              return {
                ...position,
                counter: {
                  ...counter,
                  stroke:
                    'counterStrokeIdle' in op.patch
                      ? { ...stroke, idle: op.patch.counterStrokeIdle }
                      : { ...stroke, active: op.patch.counterStrokeActive },
                },
              };
            }
            if ('counterAnimationPreset' in op.patch) {
              const counter = position.counter as
                | Record<string, unknown>
                | undefined;
              const animation = (counter?.animation ?? {}) as Record<
                string,
                unknown
              >;
              const intent = op.patch.counterAnimationPreset;
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
            if ('useInlineStyles' in op.patch) {
              return {
                ...position,
                useInlineStyles: op.patch.useInlineStyles,
              };
            }
            if ('fontWeight' in op.patch) {
              return { ...position, fontWeight: op.patch.fontWeight };
            }
            if ('fontItalic' in op.patch) {
              return { ...position, fontItalic: op.patch.fontItalic };
            }
            if ('fontUnderline' in op.patch) {
              return { ...position, fontUnderline: op.patch.fontUnderline };
            }
            if ('fontStrikethrough' in op.patch) {
              return {
                ...position,
                fontStrikethrough: op.patch.fontStrikethrough,
              };
            }
            if ('fontFamily' in op.patch) {
              return { ...position, fontFamily: op.patch.fontFamily };
            }
            if (
              'backgroundPaint' in op.patch ||
              'activeBackgroundPaint' in op.patch ||
              'borderPaint' in op.patch ||
              'activeBorderPaint' in op.patch
            ) {
              const field = Object.keys(op.patch)[0] as
                | 'backgroundPaint'
                | 'activeBackgroundPaint'
                | 'borderPaint'
                | 'activeBorderPaint';
              const paint = op.patch[field]!;
              const {
                active,
                colorField,
                gradientField,
                activeColorField,
                activeGradientField,
              } = paintPropertyFields(field);
              const preservation: Record<string, unknown> = {};
              if (
                !active &&
                (op.elementType === 'key' || op.elementType === 'knob')
              ) {
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
                  preservation[activeColorField] = inherited.color;
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
            if ('displayText' in op.patch) {
              return { ...position, displayText: op.patch.displayText };
            }
            if ('className' in op.patch) {
              return { ...position, className: op.patch.className };
            }
            if ('borderWidth' in op.patch) {
              return { ...position, borderWidth: op.patch.borderWidth };
            }
            if ('borderRadius' in op.patch) {
              return { ...position, borderRadius: op.patch.borderRadius };
            }
            if ('fontSize' in op.patch) {
              return { ...position, fontSize: op.patch.fontSize };
            }
            if ('noteGlowSize' in op.patch) {
              return { ...position, noteGlowSize: op.patch.noteGlowSize };
            }
            if ('noteOffsetX' in op.patch) {
              return {
                ...position,
                noteOffsetX: op.patch.noteOffsetX ?? undefined,
              };
            }
            if ('noteOffsetY' in op.patch) {
              return {
                ...position,
                noteOffsetY: op.patch.noteOffsetY ?? undefined,
              };
            }
            if ('noteWidth' in op.patch) {
              return {
                ...position,
                noteWidth: op.patch.noteWidth ?? undefined,
              };
            }
            if ('noteBorderWidth' in op.patch) {
              return {
                ...position,
                noteBorderWidth: op.patch.noteBorderWidth,
              };
            }
            if ('noteBorderRadius' in op.patch) {
              return {
                ...position,
                noteBorderRadius: op.patch.noteBorderRadius,
              };
            }
            if ('noteEffectEnabled' in op.patch) {
              return {
                ...position,
                noteEffectEnabled: op.patch.noteEffectEnabled,
              };
            }
            if ('noteAutoYCorrection' in op.patch) {
              return {
                ...position,
                noteAutoYCorrection: op.patch.noteAutoYCorrection,
              };
            }
            if ('noteGlowEnabled' in op.patch) {
              return {
                ...position,
                noteGlowEnabled: op.patch.noteGlowEnabled,
              };
            }
            if ('noteAlignment' in op.patch) {
              return { ...position, noteAlignment: op.patch.noteAlignment };
            }
            if ('noteBorderSide' in op.patch) {
              return { ...position, noteBorderSide: op.patch.noteBorderSide };
            }
            if ('statType' in op.patch) {
              return { ...position, statType: op.patch.statType };
            }
            return { ...position, hidden: op.patch.hidden };
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
        layerGroups: next.layerGroups,
      });
      next.keyPositions = normalized.keyPositions;
      next.statPositions = normalized.statPositions;
      next.graphPositions = normalized.graphPositions;
      next.knobPositions = normalized.knobPositions;
      next.layerGroups = normalized.layerGroups;
      break;
    }
  });
  return next;
};

export function getChangedEditorFields(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorField[] {
  assertEditorDocument(base, 'base editor document');
  assertEditorDocument(next, 'next editor document');

  return EDITOR_FIELDS.filter(
    (field) => stableStringify(base[field]) !== stableStringify(next[field]),
  );
}

export function createEditorPatch(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorPatchV1 {
  return patchForFields(next, getChangedEditorFields(base, next));
}

export function applyEditorPatch(
  base: EditorDocumentV1,
  patch: EditorPatchV1,
): EditorDocumentV1 {
  assertEditorDocument(base, 'base editor document');
  assertEditorPatch(patch);

  const next = clone(base);
  EDITOR_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      Object.assign(next, { [field]: clone(patch[field]) });
    }
  });
  assertEditorDocument(next, 'patched editor document');
  return next;
}

export function rebaseEditorDocument(
  canonical: EditorDocumentV1,
  pendingLocal: EditorDocumentV1,
  localFields: readonly EditorField[],
): EditorDocumentV1 {
  return applyEditorPatch(canonical, patchForFields(pendingLocal, localFields));
}

export class EditorSaveCoordinator {
  private readonly transport: EditorCoordinatorTransport;
  private readonly readDocument: () => EditorDocumentV1;
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
  private lastAck: EditorDocumentV1 | null = null;
  private pendingLocal: EditorDocumentV1 | null = null;
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

  private startPromise: Promise<EditorGetResult> | null = null;
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

  start(): Promise<EditorGetResult> {
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
    document?: EditorDocumentV1,
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    // gradient canonical 정규화를 assert 앞에 — 이후 diff·invoke가 같은 값 사용
    const currentDocument = canonicalizeEditorGradients(
      document ?? this.readDocument(),
    );
    assertEditorDocument(currentDocument);
    const snapshot = clone(currentDocument);

    const projected = this.getLatestCommitBase();
    const newIntentFields = getChangedEditorFields(projected, snapshot);
    return this.queueSnapshot(snapshot, newIntentFields, []);
  }

  private async queueSnapshot(
    snapshot: EditorDocumentV1,
    newIntentFields: readonly EditorField[],
    requestFields: readonly EditorField[],
    gestureId?: string,
    onEnrolled?: () => void,
  ): Promise<EditorDocumentV1> {
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
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    await this.waitForGestureCommits();
    await this.start();
    return this.commitPatchSettled(changes, meta?.gestureId);
  }

  // 대기 이후 공통 본문. 슬롯 안에서 재사용하므로 여기서 tail을 다시
  // 기다리면 자기 슬롯 교착이 된다
  private commitPatchSettled(
    changes: EditorPatchV1,
    gestureId?: string,
    onEnrolled?: () => void,
  ): Promise<EditorDocumentV1> {
    // gradient canonical 정규화를 assert 앞에 — optimistic·diff·invoke가 같은 값 사용
    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges);

    const projected = this.getLatestCommitBase();
    const target = applyEditorPatch(projected, canonicalChanges);
    const newIntentFields = getChangedEditorFields(projected, target);
    const requestFields = EDITOR_FIELDS.filter(
      (field) => canonicalChanges[field] !== undefined,
    );
    const currentDocument = this.readDocument();
    assertEditorDocument(currentDocument);
    const optimisticDocument = applyEditorPatch(
      currentDocument,
      canonicalChanges,
    );
    if (
      getChangedEditorFields(currentDocument, optimisticDocument).length > 0
    ) {
      this.applyDocument(clone(optimisticDocument), 'localPatch');
    }
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
    generate: (base: EditorDocumentV1) => EditorPatchV1 | null,
    meta?: { gestureId?: string; onEnrolled?: () => void },
  ): Promise<EditorDocumentV1> {
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
    return this.enqueueSerialized(async () => {
      assertEditorOpsV1(frozenOps);
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
        opsVersion: 1,
        ops,
        ...(meta.gestureId ? { gestureId: meta.gestureId } : {}),
      };
      const target = applySemanticOps(baseDocument, ops);
      const currentDocument = this.readDocument();
      assertEditorDocument(currentDocument);
      const optimisticDocument = applySemanticOps(currentDocument, ops);
      if (
        getChangedEditorFields(currentDocument, optimisticDocument).length > 0
      ) {
        this.applyDocument(clone(optimisticDocument), 'localPatch');
      }
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

      let ioRetryCount = 0;
      try {
        let result: EditorCommitResult;
        while (true) {
          try {
            result = await this.transport.commit(request);
            break;
          } catch (error) {
            const outcomeUnknown =
              (!isEditorCommitError(error) &&
                !(error instanceof EditorProtocolError)) ||
              (isEditorCommitError(error) && error.errorCode === 'IO_ERROR');
            if (!outcomeUnknown || ioRetryCount >= 1) throw error;
            ioRetryCount += 1;
            totalRetryCount += 1;
          }
        }

        assertEditorOpCommitResult(result, ops);
        const opResults = clone(result.opResults!);
        this.assertSemanticChangedFields(baseDocument, ops, opResults, result);
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
        try {
          await this.syncSemanticCanonical();
        } catch {
          // 원래 커밋 오류를 유지
          this.applyDocument(clone(this.requireLastAck()), 'rejected');
        }
        const retryable =
          !(error instanceof EditorProtocolError) &&
          (!isEditorCommitError(error) || error.retryable === true);
        if (inFlight.gestureIds.length > 0) {
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

  private async syncSemanticCanonical(): Promise<EditorGetResult> {
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
    changes: EditorPatchV1,
    options: { multiKey: boolean },
  ): Promise<EditorDocumentV1> {
    this.assertWritable();
    return this.enqueueSerialized(() =>
      this.commitIsolatedPluginPatchInner(changes, options),
    );
  }

  private async commitIsolatedPluginPatchInner(
    changes: EditorPatchV1,
    options: { multiKey: boolean },
  ): Promise<EditorDocumentV1> {
    await this.start();
    await this.drainUntilSettled();
    await this.eventQueue;
    if (this.conflict) {
      throw this.error ?? new Error('editor conflict pending');
    }

    const canonicalChanges = canonicalizeEditorGradients(changes);
    assertEditorPatch(canonicalChanges);
    const baseDocument = clone(this.requireLastAck());
    const target = applyEditorPatch(baseDocument, canonicalChanges);
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
      target: clone(target),
      localFields: getChangedEditorFields(baseDocument, target),
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
  ): Promise<EditorDocumentV1> {
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

  async retryPending(): Promise<EditorDocumentV1> {
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
  ): Promise<EditorDocumentV1> {
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

  async flush(): Promise<EditorDocumentV1> {
    await this.waitForGestureCommits();
    if (this.isReadOnly()) {
      await this.start();
      await this.eventQueue;
      return clone(this.requireLastAck());
    }
    await this.commitEditorState(this.readDocument());
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

  private async initialize(): Promise<EditorGetResult> {
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
      await this.processCommittedEvent(event);
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
        } else if (isEditorCommitError(error) && error.retryable) {
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
  ): Promise<EditorDocumentV1> {
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
    const requestFields = ops
      ? [...new Set(ops.flatMap(fieldsForSemanticOp))]
      : canonicalChanges
      ? EDITOR_FIELDS.filter((field) => canonicalChanges[field] !== undefined)
      : [];
    const localFields = getChangedEditorFields(baseDocument, target);
    // 슬롯 내 로컬 낙관 재적용 - 선행 커밋(격리 plugin 쓰기 등)이 호출
    // 시점의 eager 값을 canonical 적용으로 지웠을 수 있다. wire만 고치면
    // 백엔드는 맞고 UI 스토어는 옛 값에 남는다
    if (ops || canonicalChanges) {
      const currentDocument = this.readDocument();
      assertEditorDocument(currentDocument);
      const optimisticDocument = ops
        ? applySemanticOps(currentDocument, ops)
        : applyEditorPatch(currentDocument, canonicalChanges!);
      if (
        getChangedEditorFields(currentDocument, optimisticDocument).length > 0
      ) {
        this.applyDocument(clone(optimisticDocument), 'localPatch');
      }
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
          ? { editorOpsVersion: 1 as const, editorOps: ops }
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
      const retryable = isEditorCommitError(error) && error.retryable;
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
    base: EditorDocumentV1,
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
      this.processCommittedEvent(event),
    );
    this.eventQueue = queued.catch(() => undefined);
    return queued;
  }

  private async processCommittedEvent(event: EditorCommittedV1): Promise<void> {
    assertEditorCommittedEvent(event);
    if (this.stopped || this.revision === null || !this.lastAck) return;

    if (event.revision <= this.revision) {
      this.ownMutations.delete(event.mutationId);
      this.isolatedMutations.delete(event.mutationId);
      this.onCommittedApplied?.(event);
      return;
    }
    if (event.revision > this.revision + 1) {
      try {
        await this.fetchAndApplyCanonical('resync');
      } finally {
        // 프리뷰 정리는 canonical 재동기화 성공 여부와 독립
        this.onCommittedApplied?.(event);
      }
      return;
    }

    const previousCanonical = this.lastAck;
    const canonical = applyEditorPatch(previousCanonical, event.patch);
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
      this.onCommittedApplied?.(event);
      return;
    }

    this.applyExternalCanonical(
      canonical,
      event.changedFields,
      event.revision,
      'event',
      previousCanonical,
    );
    this.onCommittedApplied?.(event);
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
    canonical: EditorDocumentV1,
    changedFields: readonly EditorField[],
    canonicalRevision: number,
    reason: Extract<EditorApplyReason, 'event' | 'resync'>,
    previousCanonical?: EditorDocumentV1,
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

  private getLatestCommitBase(): EditorDocumentV1 {
    if (this.conflict) return clone(this.conflict.pendingLocal);
    if (this.pendingLocal) return clone(this.pendingLocal);
    const optimistic = this.optimisticInFlight();
    if (optimistic) return clone(optimistic.target);
    return clone(this.requireLastAck());
  }

  private getLatestPendingDocument(): EditorDocumentV1 | null {
    return (
      this.conflict?.pendingLocal ??
      this.pendingLocal ??
      this.optimisticInFlight()?.target ??
      null
    );
  }

  private getLatestPendingFields(
    comparisonBase: EditorDocumentV1,
    pending: EditorDocumentV1,
  ): EditorField[] {
    if (this.conflict) return [...this.conflict.localFields];
    if (this.pendingLocal) return [...this.pendingFields];
    const optimistic = this.optimisticInFlight();
    if (optimistic) return [...optimistic.localFields];
    return getChangedEditorFields(comparisonBase, pending);
  }

  private preservePending(
    document: EditorDocumentV1,
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

  private requireLastAck(): EditorDocumentV1 {
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
