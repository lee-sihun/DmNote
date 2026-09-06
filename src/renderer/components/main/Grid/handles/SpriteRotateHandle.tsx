import { spriteItemsApi } from '@api/modules/editor/itemsApi';
import { resolveElementById } from '@src/renderer/editor/model/elementIdMap';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import CanvasRotateHandle from './CanvasRotateHandle';
import type { Bounds } from './groupResizeUtils';

interface SpriteRotateHandleProps {
  elementId: string;
  mode: string;
  bounds: Bounds;
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
}

const SpriteRotateHandle = ({
  elementId,
  mode,
  bounds,
  rotation,
  zoom,
  panX,
  panY,
}: SpriteRotateHandleProps) => (
  <CanvasRotateHandle
    bounds={bounds}
    rotation={rotation}
    zoom={zoom}
    panX={panX}
    panY={panY}
    sessionKey={`sprite:${mode}:${elementId}`}
    start={() => {
      if (resolveElementById('sprite', elementId)?.mode !== mode) return null;
      let gestureId: string | undefined;
      return {
        preview: (value) => {
          if (
            (gestureId &&
              editGestureController.activeGestureId() !== gestureId) ||
            resolveElementById('sprite', elementId)?.mode !== mode
          )
            return false;
          editGestureController.preview(
            mode,
            [{ id: elementId, patch: { rotation: value } }],
            { domain: 'spritePosition' },
          );
          gestureId = editGestureController.activeGestureId();
          return Boolean(gestureId);
        },
        commit: (value) => {
          if (
            !gestureId ||
            editGestureController.activeGestureId() !== gestureId
          )
            return;
          const persisted = spriteItemsApi.patchPosition(
            mode,
            elementId,
            { rotation: value },
            gestureId,
          );
          editGestureController.settleCommit(persisted);
          void persisted.catch((error) =>
            console.error('Failed to rotate sprite', error),
          );
        },
        cancel: () => {
          if (
            gestureId &&
            editGestureController.activeGestureId() === gestureId
          )
            editGestureController.cancel();
        },
      };
    }}
  />
);

export default SpriteRotateHandle;
