import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';
import {
  commitSelectionRotation,
  previewSelectionRotation,
} from '@src/renderer/editor/runtime/selectionRotationOps';
import { wrapDegrees } from '@utils/core/rotation';
import type { useSelectionRotationFrame } from '@hooks/Grid/useSelectionRotationFrame';
import type { CanvasRotationSession } from './CanvasRotateHandle';

export type SelectionRotationFrame = NonNullable<
  ReturnType<typeof useSelectionRotationFrame>
>;

export const createSelectionRotationGesture = (
  frame: SelectionRotationFrame,
): CanvasRotationSession | null => {
  // 비대칭 배치도 연속 회전 중 같은 선택틀 중심을 사용
  const snapshot = {
    ...structuredClone(frame.snapshot),
    center: {
      x: frame.bounds.x + frame.bounds.width / 2,
      y: frame.bounds.y + frame.bounds.height / 2,
    },
  };
  let gestureId: string | undefined;
  return {
    preview: (rotation) => {
      if (gestureId && editGestureController.activeGestureId() !== gestureId) {
        return false;
      }
      const applied = previewSelectionRotation(
        snapshot,
        wrapDegrees(rotation - frame.rotation),
      );
      if (applied) gestureId = editGestureController.activeGestureId();
      return applied;
    },
    commit: (rotation) => {
      if (!gestureId || editGestureController.activeGestureId() !== gestureId)
        return;
      const persisted = commitSelectionRotation(
        snapshot,
        wrapDegrees(rotation - frame.rotation),
        { gestureId },
      );
      editGestureController.settleCommit(persisted);
      void persisted.catch((error) => {
        console.error('Failed to rotate selection', error);
      });
    },
    cancel: () => {
      if (gestureId && editGestureController.activeGestureId() === gestureId) {
        editGestureController.cancel();
      }
    },
  };
};
