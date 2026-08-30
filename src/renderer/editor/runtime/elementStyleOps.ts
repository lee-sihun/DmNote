import { isNativeElementId } from '../model/elementId';
import type { NativeElementType } from '../model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  type PropertyIntents,
} from './elementIntent';
import { commitSemanticOps } from './editorSemanticOps';
import { captureEditorDocument } from './editorStateCoordinator';
import type {
  EditorCounterAnimationPresetIntentV1,
  EditorCounterBooleanPropertyPatchV1,
  EditorCounterFillPropertyPatchV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorFontFamilyPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
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
import { implicitCounterFontBold } from '@utils/core/fontWeights';
import {
  idTargets,
  patchElementPropertyById,
  patchElementPropertyByTargets,
  type PropertyCommitOptions,
} from './elementPropertyCore';

export * from './elementRuntimePropertyOps';
export * from './elementImageOps';

type CounterAnimationTarget = {
  elementType: 'key' | 'stat';
  id: string;
};

const counterBooleanPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterBooleanPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (
      !current ||
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    const nextCounter =
      patch.property === 'counterEnabled'
        ? { ...counter, enabled: patch.value }
        : counter.animation !== null &&
          typeof counter.animation === 'object' &&
          !Array.isArray(counter.animation)
        ? {
            ...counter,
            animation: {
              ...(counter.animation as Record<string, unknown>),
              enabled: patch.value,
            },
          }
        : null;
    if (!nextCounter) continue;
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, { counter: nextCounter });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

const patchCounterBooleanByTargets = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterBooleanPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterBooleanPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
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

const counterLayoutPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterLayoutPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (
      !current ||
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    const nextCounter =
      patch.property === 'counterPlacement'
        ? { ...counter, placement: patch.value }
        : patch.property === 'counterAlign'
        ? { ...counter, align: patch.value }
        : patch.property === 'counterAlignMode'
        ? { ...counter, alignMode: patch.value }
        : { ...counter, gap: patch.value };
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, { counter: nextCounter });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

export const patchCounterLayoutByTargets = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterLayoutPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterLayoutPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
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

export const patchCounterLayoutById = (
  elementType: 'key' | 'stat',
  id: string,
  patch: EditorCounterLayoutPropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterLayoutByTargets([{ elementType, id }], patch, options);

const counterTypographyPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterTypographyPropertyPatchV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (
      !current ||
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    const nextCounter =
      patch.property === 'counterFontSize'
        ? { ...counter, fontSize: patch.value }
        : patch.property === 'counterFontWeight'
        ? {
            ...counter,
            fontWeight: patch.value,
            ...(typeof counter.fontBold !== 'boolean'
              ? { fontBold: implicitCounterFontBold(counter.fontWeight) }
              : {}),
          }
        : patch.property === 'counterFontBold'
        ? { ...counter, fontBold: patch.value }
        : patch.property === 'counterFontItalic'
        ? { ...counter, fontItalic: patch.value }
        : patch.property === 'counterFontUnderline'
        ? { ...counter, fontUnderline: patch.value }
        : patch.property === 'counterFontStrikethrough'
        ? { ...counter, fontStrikethrough: patch.value }
        : { ...counter, fontFamily: patch.value };
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, { counter: nextCounter });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

const isCounterTypographyPatch = (
  patch: EditorCounterTypographyPropertyPatchV1,
): boolean => {
  if (patch.property === 'counterFontSize') {
    return (
      Number.isSafeInteger(patch.value) && patch.value >= 8 && patch.value <= 72
    );
  }
  if (patch.property === 'counterFontWeight') {
    return (
      Number.isSafeInteger(patch.value) &&
      patch.value >= 100 &&
      patch.value <= 900
    );
  }
  if (patch.property === 'counterFontBold') {
    return typeof patch.value === 'boolean';
  }
  if (patch.property === 'counterFontItalic') {
    return typeof patch.value === 'boolean';
  }
  if (patch.property === 'counterFontUnderline') {
    return typeof patch.value === 'boolean';
  }
  if (patch.property === 'counterFontStrikethrough') {
    return typeof patch.value === 'boolean';
  }
  return (
    patch.property === 'counterFontFamily' && typeof patch.value === 'string'
  );
};

export const patchCounterTypographyByTargets = (
  targets: readonly CounterAnimationTarget[],
  patch: EditorCounterTypographyPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> => {
  if (
    !isCounterTypographyPatch(patch) ||
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterTypographyPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
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

export const patchCounterTypographyById = (
  elementType: 'key' | 'stat',
  id: string,
  patch: EditorCounterTypographyPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> =>
  patchCounterTypographyByTargets([{ elementType, id }], patch, options);

export const patchCounterEnabledByTargets = (
  targets: readonly CounterAnimationTarget[],
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterBooleanByTargets(
    targets,
    { property: 'counterEnabled', value: enabled },
    options,
  );

export const patchCounterEnabledById = (
  elementType: 'key' | 'stat',
  id: string,
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterEnabledByTargets([{ elementType, id }], enabled, options);

export const patchCounterAnimationEnabledByTargets = (
  targets: readonly CounterAnimationTarget[],
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterBooleanByTargets(
    targets,
    { property: 'counterAnimationEnabled', value: enabled },
    options,
  );

export const patchCounterAnimationEnabledById = (
  elementType: 'key' | 'stat',
  id: string,
  enabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterAnimationEnabledByTargets(
    [{ elementType, id }],
    enabled,
    options,
  );

const counterAnimationPropertyIntents = (
  targets: readonly CounterAnimationTarget[],
  intent: EditorCounterAnimationPresetIntentV1,
): PropertyIntents => {
  const document = captureEditorDocument();
  const propertyIntents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { elementType, id } of targets) {
    const field = elementType === 'key' ? 'keyPositions' : 'statPositions';
    const record = document[field] as Record<
      string,
      Array<Record<string, unknown> & { id: string }>
    >;
    const current = Object.values(record)
      .flat()
      .find((position) => position.id === id);
    if (!current) continue;
    if (
      current.counter === null ||
      typeof current.counter !== 'object' ||
      Array.isArray(current.counter)
    ) {
      continue;
    }
    const counter = current.counter as Record<string, unknown>;
    if (
      counter.animation === null ||
      typeof counter.animation !== 'object' ||
      Array.isArray(counter.animation)
    ) {
      continue;
    }
    const animation = counter.animation as Record<string, unknown>;
    const byId = propertyIntents.get(elementType) ?? new Map();
    byId.set(id, {
      counter: {
        ...counter,
        animation: {
          ...animation,
          ...('applyPresetId' in intent ? { presetId: intent.presetId } : {}),
          ...('bezier' in intent ? { bezier: [...intent.bezier] } : {}),
          ...('scale' in intent ? { scale: intent.scale } : {}),
          ...('durationMs' in intent ? { durationMs: intent.durationMs } : {}),
        },
      },
    });
    propertyIntents.set(elementType, byId);
  }
  return propertyIntents;
};

export const patchCounterAnimationPresetByTargets = (
  targets: readonly CounterAnimationTarget[],
  intent: EditorCounterAnimationPresetIntentV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> => {
  if (
    targets.length === 0 ||
    targets.some(({ id }) => id.length === 0 || !isNativeElementId(id)) ||
    new Set(targets.map(({ id }) => id)).size !== targets.length
  ) {
    return Promise.resolve(false);
  }
  const receipt = applyPropertyIntentsEagerly(
    counterAnimationPropertyIntents(targets, intent),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch: {
        property: 'counterAnimationPreset',
        value: structuredClone(intent),
      },
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

export const patchCounterAnimationPresetById = (
  elementType: 'key' | 'stat',
  id: string,
  intent: EditorCounterAnimationPresetIntentV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchCounterAnimationPresetByTargets([{ elementType, id }], intent, options);

export const patchUseInlineStylesByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  useInlineStyles: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'useInlineStyles', value: useInlineStyles },
    options,
  );

export const patchFontStyleByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontStylePropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> => patchElementPropertyByTargets(targets, patch, options);

export const patchFontFamilyByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorFontFamilyPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> => patchElementPropertyByTargets(targets, patch, options);

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
