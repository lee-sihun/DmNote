import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';
import { patchStylePropertyById } from '@src/renderer/editor/runtime/operations/elementPaintStyleOps';
import { previewSingleStyleProperty } from '../PropertiesPanel/selection/previewPatchForwarders';
import CanvasRotateHandle from './CanvasRotateHandle';
import type { Bounds } from './groupResizeUtils';
import type { RotatableElementType } from './rotatableElement';

interface NativeRotateHandleProps {
  elementType: RotatableElementType;
  elementId: string;
  bounds: Bounds;
  rotation: number;
  zoom: number;
  panX: number;
  panY: number;
}

const NativeRotateHandle = ({
  elementType,
  elementId,
  bounds,
  rotation,
  zoom,
  panX,
  panY,
}: NativeRotateHandleProps) => (
  <CanvasRotateHandle
    bounds={bounds}
    rotation={rotation}
    zoom={zoom}
    panX={panX}
    panY={panY}
    sessionKey={`${elementType}:${elementId}`}
    start={() => ({
      preview: (value) => {
        previewSingleStyleProperty(elementType, elementId, {
          property: 'rotation',
          value,
        });
        return true;
      },
      commit: (value) => {
        const gestureId = editGestureController.activeGestureId();
        if (!gestureId) return;
        const persisted = patchStylePropertyById(
          elementType,
          elementId,
          { property: 'rotation', value },
          { gestureId },
        );
        editGestureController.settleCommit(persisted);
        void persisted.catch((error) => {
          console.error('Failed to rotate element', error);
        });
      },
      cancel: () => editGestureController.cancel(),
    })}
  />
);

export default NativeRotateHandle;
