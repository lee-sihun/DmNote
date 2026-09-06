import CanvasRotateHandle from './CanvasRotateHandle';
import {
  createSelectionRotationGesture,
  type SelectionRotationFrame,
} from './selectionRotationGesture';

interface SelectionRotateHandleProps {
  frame: SelectionRotationFrame;
  zoom: number;
  panX: number;
  panY: number;
}

const SelectionRotateHandle = ({
  frame,
  zoom,
  panX,
  panY,
}: SelectionRotateHandleProps) => (
  <CanvasRotateHandle
    kind="selection"
    bounds={frame.bounds}
    rotation={frame.rotation}
    zoom={zoom}
    panX={panX}
    panY={panY}
    sessionKey={frame.selectionKey}
    start={() => createSelectionRotationGesture(frame)}
  />
);

export default SelectionRotateHandle;
