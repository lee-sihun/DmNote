import { paintPropertyFields } from '@src/types/color';
import type { KeyPosition } from '@src/types/key/keys';
import type { ElementIdSelection } from '@hooks/pickers/useBatchElementBinding';
import {
  patchActiveImageByTargets,
  patchActiveTransparentByTargets,
  patchInactiveImageByTargets,
  patchIdleTransparentByTargets,
  patchPaintByTargets,
  patchShadowByTargets,
  patchSoundPathByIds,
  patchStylePropertyByTargets,
} from '@src/renderer/editor/runtime/elementOps';
import { reportElementOpError } from '@src/renderer/editor/runtime/elementIntent';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import type {
  EditorPaintPropertyPatchV1,
  EditorPreviewStylePropertyPatchV1,
  EditorShadowPropertyPatchV1,
  EditorStylePropertyPreviewPatchV1,
} from '@src/types/editor';
import {
  previewBatchPaint,
  previewBatchStyleProperty,
} from '../previewPatchForwarders';

const NATIVE_IMAGE_TYPES = ['key', 'stat', 'graph', 'knob'] as const;

export const createStylePropertyHandlers = (
  targets: readonly {
    elementType: 'key' | 'stat' | 'graph' | 'knob';
    id: string;
  }[],
  selectedKeyType: string,
  options: { settleGesture?: boolean } = { settleGesture: true },
) => {
  const stableTargets =
    targets.length > 0 &&
    targets.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
    new Set(targets.map(({ id }) => id)).size === targets.length
      ? targets
      : null;
  if (!stableTargets) {
    return {
      previewStyleProperty: undefined,
      commitStyleProperty: undefined,
    };
  }
  return {
    previewStyleProperty: (patch: EditorStylePropertyPreviewPatchV1) =>
      previewBatchStyleProperty(stableTargets, selectedKeyType, patch),
    commitStyleProperty: (patch: EditorPreviewStylePropertyPatchV1) => {
      const gestureId = options.settleGesture
        ? editGestureController.activeGestureId() ?? undefined
        : undefined;
      const persisted = patchStylePropertyByTargets(stableTargets, patch, {
        gestureId,
      });
      if (options.settleGesture) {
        editGestureController.settleCommit(persisted);
      }
      void persisted.catch(reportElementOpError);
    },
  };
};

// 표면별 허용 타깃 - font는 라벨 렌더러가 있는 키·스탯(active는 키만)
const paintRelevantTargets = <
  T extends { elementType: 'key' | 'stat' | 'graph' | 'knob' },
>(
  targets: readonly T[],
  patch: EditorPaintPropertyPatchV1,
): readonly T[] => {
  const { active, surface } = paintPropertyFields(patch.property);
  if (surface === 'font') {
    return targets.filter(({ elementType }) =>
      active
        ? elementType === 'key'
        : elementType === 'key' || elementType === 'stat',
    );
  }
  return active
    ? targets.filter(
        ({ elementType }) => elementType === 'key' || elementType === 'knob',
      )
    : targets;
};

export const createPaintHandlers = (
  targets: readonly {
    elementType: 'key' | 'stat' | 'graph' | 'knob';
    id: string;
  }[],
  selectedKeyType: string,
) => {
  const stableTargets = (patch: EditorPaintPropertyPatchV1) => {
    const relevant = paintRelevantTargets(targets, patch);
    const stable =
      relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    return stable ? relevant : null;
  };
  return {
    previewPaint: (patch: EditorPaintPropertyPatchV1) => {
      const stable = stableTargets(patch);
      if (!stable) return;
      previewBatchPaint(stable, selectedKeyType, patch);
    },
    commitPaint: (patch: EditorPaintPropertyPatchV1) => {
      const stable = stableTargets(patch);
      if (!stable) return;
      const gestureId = editGestureController.activeGestureId() ?? undefined;
      const persisted = patchPaintByTargets(stable, patch, { gestureId });
      editGestureController.settleCommit(persisted);
      void persisted.catch(reportElementOpError);
    },
  };
};

export const createShadowCommitHandler =
  (
    targets: readonly {
      elementType: 'key' | 'stat' | 'knob';
      id: string;
    }[],
  ) =>
  (patch: EditorShadowPropertyPatchV1) => {
    const relevant =
      patch.property === 'activeShadow'
        ? targets.filter(({ elementType }) => elementType !== 'stat')
        : targets;
    const stable =
      relevant.length > 0 &&
      relevant.every(({ id }) => id.length > 0 && isNativeElementId(id)) &&
      new Set(relevant.map(({ id }) => id)).size === relevant.length;
    if (!stable) return;
    const gestureId = editGestureController.activeGestureId() ?? undefined;
    const persisted = patchShadowByTargets(relevant, patch, { gestureId });
    editGestureController.settleCommit(persisted);
    void persisted.catch(reportElementOpError);
  };

export const commitBoundInactiveImage = (
  selection: ElementIdSelection,
  inactiveImage: string,
) => {
  const targets = NATIVE_IMAGE_TYPES.flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchInactiveImageByTargets(targets, inactiveImage);
  void persisted.catch(reportElementOpError);
};

export const commitBoundActiveImage = (
  selection: ElementIdSelection,
  activeImage: string,
) => {
  const targets = (['key', 'knob'] as const).flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchActiveImageByTargets(targets, activeImage);
  void persisted.catch(reportElementOpError);
};

export const commitBoundIdleTransparent = (
  selection: ElementIdSelection,
  idleTransparent: boolean,
) => {
  const targets = NATIVE_IMAGE_TYPES.flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchIdleTransparentByTargets(targets, idleTransparent);
  void persisted.catch(reportElementOpError);
};

export const commitBoundActiveTransparent = (
  selection: ElementIdSelection,
  activeTransparent: boolean,
) => {
  const targets = (['key', 'knob'] as const).flatMap((elementType) =>
    (selection[elementType] ?? []).map((id) => ({ elementType, id })),
  );
  if (targets.length === 0) return;
  const persisted = patchActiveTransparentByTargets(targets, activeTransparent);
  void persisted.catch(reportElementOpError);
};

export const commitBoundSoundPath = (
  selection: ElementIdSelection,
  soundPath: string,
) => {
  const ids = selection.key ?? [];
  if (ids.length === 0) return;
  const persisted = patchSoundPathByIds(ids, soundPath);
  void persisted.catch(reportElementOpError);
};

export type { BatchLocalColors, BatchPickerTarget } from './batchPickerTypes';

export type MixedValueResult<T> = { isMixed: boolean; value: T };
export type MixedValueGetter<P> = <T>(
  getter: (position: P) => T | undefined,
  defaultValue: T,
) => MixedValueResult<T>;

export interface KeyData {
  index: number;
  position: KeyPosition | undefined;
  keyCode: string | null;
  keyInfo: { globalKey: string; displayName: string } | null;
}
