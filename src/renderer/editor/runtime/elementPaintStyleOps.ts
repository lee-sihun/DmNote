import { isNativeElementId } from '../model/elementId';
import type { NativeElementType } from '../model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  type PropertyIntents,
} from './elementIntent';
import { commitSemanticOps } from './editorSemanticOps';
import { captureEditorDocument } from './editorStateCoordinator';
import type {
  EditorCounterFillPropertyPatchV1,
  EditorNotePaintPropertyPatchV1,
  EditorNotePropertyPatchV1,
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorShadowPropertyPatchV1,
} from '@src/types/editor';
import {
  isEditorPaintPropertyPatchV1,
  isEditorShadowPropertyPatchV1,
} from '@src/types/editor';
import type { KeyPosition } from '@src/types/key/keys';
import { paintPropertyFields, projectPaintDescriptor } from '@src/types/color';
import { projectElementShadowPatch } from '@src/types/key/shadows';
import {
  isNotePaintPropertyPatchV1,
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
import {
  idTargets,
  patchElementPropertyById,
  patchElementPropertyByTargets,
  type PropertyCommitOptions,
} from './elementPropertyCore';

type PaintTarget = { elementType: NativeElementType; id: string };

const paintPropertyIntents = (
  targets: readonly PaintTarget[],
  patch: EditorPaintPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const fieldName = patch.property;
  const descriptor = patch.value;
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const collection =
      elementType === 'key'
        ? document.keyPositions
        : elementType === 'stat'
        ? document.statPositions
        : elementType === 'graph'
        ? document.graphPositions
        : document.knobPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as
      | (Record<string, unknown> & { id: string })
      | undefined;
    if (!current) continue;
    const next = projectPaintDescriptor(
      current,
      elementType,
      fieldName,
      descriptor,
    );
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, next);
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchPaintByTargets = (
  targets: readonly PaintTarget[],
  patch: EditorPaintPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> => {
  const { active, surface } = paintPropertyFields(patch.property);
  // 표면별 허용 타깃 - font는 라벨 렌더러가 있는 키·스탯(active는 키만)
  const rejectsTarget = (elementType: NativeElementType): boolean =>
    surface === 'font'
      ? active
        ? elementType !== 'key'
        : elementType !== 'key' && elementType !== 'stat'
      : active && elementType !== 'key' && elementType !== 'knob';
  if (
    !isEditorPaintPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        id.length === 0 || !isNativeElementId(id) || rejectsTarget(elementType),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    paintPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchPaintById = (
  elementType: NativeElementType,
  id: string,
  patch: EditorPaintPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> =>
  patchPaintByTargets([{ elementType, id }], patch, options);

type CounterFillTarget = { elementType: 'key' | 'stat'; id: string };

const counterFillPropertyIntents = (
  targets: readonly CounterFillTarget[],
  patch: EditorCounterFillPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const collection =
      elementType === 'key' ? document.keyPositions : document.statPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as KeyPosition | undefined;
    if (!current) continue;
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, projectCounterFillPatch(current, patch));
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchCounterFillByTargets = (
  targets: readonly CounterFillTarget[],
  patch: EditorCounterFillPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  const active = patch.property === 'counterFillActive';
  if (
    !isCounterFillPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        !id ||
        !isNativeElementId(id) ||
        (elementType !== 'key' && elementType !== 'stat') ||
        (active && elementType !== 'key'),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterFillPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchCounterFillById = (
  elementType: 'key' | 'stat',
  id: string,
  patch: EditorCounterFillPropertyPatchV1,
  options: { preflight?: () => void } = {},
) => patchCounterFillByTargets([{ elementType, id }], patch, options);

type ShadowTarget = {
  elementType: NativeElementType;
  id: string;
};

const shadowPropertyIntents = (
  targets: readonly ShadowTarget[],
  patch: EditorShadowPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    if (elementType === 'graph') continue;
    const collection =
      elementType === 'key'
        ? document.keyPositions
        : elementType === 'stat'
        ? document.statPositions
        : document.knobPositions;
    const current = Object.values(collection)
      .flat()
      .find((position) => position.id === id) as
      | (Record<string, unknown> & { id: string })
      | undefined;
    if (!current) continue;
    const next = projectElementShadowPatch({
      position: current as never,
      elementType,
      patch,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
    });
    const byId =
      intents.get(elementType) ?? new Map<string, Record<string, unknown>>();
    byId.set(id, next);
    intents.set(elementType, byId);
  }
  return intents;
};

export const patchShadowByTargets = (
  targets: readonly ShadowTarget[],
  patch: EditorShadowPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !isEditorShadowPropertyPatchV1(patch) ||
    targets.length === 0 ||
    targets.some(
      ({ elementType, id }) =>
        id.length === 0 ||
        !isNativeElementId(id) ||
        elementType === 'graph' ||
        (patch.property === 'activeShadow' && elementType === 'stat'),
    ) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    shadowPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: structuredClone(patch),
    })),
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchShadowById = (
  elementType: 'key' | 'stat' | 'knob',
  id: string,
  patch: EditorShadowPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  patchShadowByTargets([{ elementType, id }], patch, options);

const notePaintPropertyIntents = (
  ids: readonly string[],
  patch: EditorNotePaintPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const byId = new Map<string, Record<string, unknown>>();
  for (const id of ids) {
    const current = Object.values(document.keyPositions)
      .flat()
      .find((position) => position.id === id);
    if (!current) continue;
    // position 전달 - {opacity} 단독의 sibling shadow 재계산이 백엔드와 일치 (§9-5)
    byId.set(
      id,
      projectNotePaintPatch(patch, current as unknown as KeyPosition) as Record<
        string,
        unknown
      >,
    );
  }
  return new Map([['key', byId]]);
};

export const patchNotePaintByIds = (
  ids: readonly string[],
  patch: EditorNotePaintPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    !isNotePaintPropertyPatchV1(patch) ||
    ids.length === 0 ||
    ids.some((id) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    notePaintPropertyIntents(ids, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    ids.map((id) => ({
      kind: 'patchElement' as const,
      elementType: 'key' as const,
      id,
      patch: structuredClone(patch),
    })),
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const patchNotePaintById = (
  id: string,
  patch: EditorNotePaintPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => patchNotePaintByIds([id], patch, options);

// note* 계열 수치 한계 검증, 대상에 key 외 타입이 있으면 즉시 무효
const invalidNoteStylePatch = (
  patch: EditorPreviewStylePropertyPatchV1,
  hasNonKeyTarget: boolean,
): boolean =>
  (patch.property === 'noteGlowSize' &&
    (hasNonKeyTarget ||
      !Number.isFinite(patch.value) ||
      patch.value < 0 ||
      patch.value > 50)) ||
  (patch.property === 'noteOffsetX' &&
    (hasNonKeyTarget ||
      (patch.value !== null &&
        (!Number.isFinite(patch.value) ||
          patch.value < -500 ||
          patch.value > 500)))) ||
  (patch.property === 'noteOffsetY' &&
    (hasNonKeyTarget ||
      (patch.value !== null &&
        (!Number.isFinite(patch.value) ||
          patch.value < -500 ||
          patch.value > 500)))) ||
  (patch.property === 'noteWidth' &&
    (hasNonKeyTarget ||
      (patch.value !== null &&
        (!Number.isFinite(patch.value) || patch.value <= 0)))) ||
  (patch.property === 'noteBorderWidth' &&
    (hasNonKeyTarget ||
      !Number.isFinite(patch.value) ||
      patch.value < 0 ||
      patch.value > 20)) ||
  (patch.property === 'noteBorderRadius' &&
    (hasNonKeyTarget ||
      !Number.isFinite(patch.value) ||
      patch.value < 0 ||
      patch.value > 100));

export const patchStylePropertyById = (
  type: NativeElementType,
  id: string,
  patch: EditorPreviewStylePropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  invalidNoteStylePatch(patch, type !== 'key')
    ? Promise.resolve(false)
    : patchElementPropertyById(type, id, patch, options);

export const patchStylePropertyByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorPreviewStylePropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  invalidNoteStylePatch(
    patch,
    targets.some((target) => target.elementType !== 'key'),
  )
    ? Promise.resolve(false)
    : patchElementPropertyByTargets(targets, patch, options);

export const patchNotePropertiesByIds = (
  ids: readonly string[],
  patch: EditorNotePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(idTargets('key', ids), patch, options);
