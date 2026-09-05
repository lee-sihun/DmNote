import { isNativeElementId } from '../../model/elementId';
import type { NativeElementType } from '../../model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  type PropertyIntents,
} from '../intent/elementIntent';
import { commitSemanticOps } from './editorSemanticOps';
import { captureEditorDocument } from '../coordinator/editorStateCoordinator';
import type {
  EditorCounterAnimationPresetIntentV1,
  EditorCounterBooleanPropertyPatchV1,
  EditorCounterLayoutPropertyPatchV1,
  EditorCounterTypographyPropertyPatchV1,
  EditorFontFamilyPropertyPatchV1,
  EditorFontStylePropertyPatchV1,
} from '@src/types/editor';
import { implicitCounterFontBold } from '@utils/core/fontWeights';
import {
  patchElementPropertyByTargets,
  type PropertyCommitOptions,
} from './elementPropertyCore';

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
