import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PreviewDomain } from '@src/types/preview';
import {
  createSelectionRotationSnapshot,
  rotateSelection,
  type SelectionRotationSnapshot,
} from '@utils/core/selectionRotation';
import type { NativeElementType } from '../model/elementIdMap';
import { editGestureController } from './editGestureController';
import {
  generatePropertyIntentPatch,
  intentPatch,
  runElementIntent,
  type PropertyIntents,
} from './elementIntent';
import { captureEditorDocument } from './editorStateCoordinator';

const PREVIEW_DOMAIN: Record<NativeElementType, PreviewDomain> = {
  key: 'keyPosition',
  stat: 'statPosition',
  graph: 'graphPosition',
  knob: 'knobPosition',
  sprite: 'spritePosition',
};

const currentRotationUpdates = (
  document: CanonicalEditorDocumentV1,
  snapshot: SelectionRotationSnapshot,
  deltaDegrees: number,
) => {
  const current = createSelectionRotationSnapshot(
    document,
    snapshot.targets,
    snapshot.mode,
  );
  if (!current || current.geometrySignature !== snapshot.geometrySignature) {
    return null;
  }
  // 다시 계산한 AABB와 무관하게 시작 선택틀의 회전 중심 유지
  return rotateSelection({ ...current, center: snapshot.center }, deltaDegrees);
};

const rotationIntents = (
  updates: NonNullable<ReturnType<typeof rotateSelection>>,
): PropertyIntents => {
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { type, id, patch } of updates) {
    const byId = intents.get(type) ?? new Map();
    byId.set(id, patch);
    intents.set(type, byId);
  }
  return intents;
};

export const previewSelectionRotation = (
  snapshot: SelectionRotationSnapshot,
  deltaDegrees: number,
): boolean => {
  const updates = currentRotationUpdates(
    captureEditorDocument(),
    snapshot,
    deltaDegrees,
  );
  if (!updates) return false;
  for (const [type, byId] of rotationIntents(updates)) {
    editGestureController.preview(
      snapshot.mode,
      [...byId].map(([id, patch]) => ({ id, patch })),
      { domain: PREVIEW_DOMAIN[type] },
    );
  }
  return true;
};

export const commitSelectionRotation = (
  snapshot: SelectionRotationSnapshot,
  deltaDegrees: number,
  options: { gestureId?: string } = {},
): Promise<boolean> => {
  const frozen = structuredClone(snapshot);
  if (!currentRotationUpdates(captureEditorDocument(), frozen, deltaDegrees)) {
    return Promise.resolve(false);
  }
  return runElementIntent({
    // 즉시 표시는 프리뷰가 맡고 canonical 낙관 적용·복원은 coordinator가 소유
    applyEager: () => null,
    generate: (base) => {
      const updates = currentRotationUpdates(base, frozen, deltaDegrees);
      return intentPatch(
        updates
          ? generatePropertyIntentPatch(base, rotationIntents(updates))
          : null,
      );
    },
    ...(options.gestureId ? { gestureId: options.gestureId } : {}),
  }).then(({ satisfied }) => satisfied);
};
