import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import CounterPreviewLayer, {
  type CounterPreviewPosition,
} from './CounterPreviewLayer';

interface KeyCounterPreviewLayerProps {
  positions: CounterPreviewPosition[];
  previewValue?: number;
  selectedElements?: SelectedElement[];
}

const KeyCounterPreviewLayer = ({
  positions,
  previewValue = 0,
  selectedElements = [],
}: KeyCounterPreviewLayerProps) => {
  return (
    <CounterPreviewLayer
      kind="key"
      positions={positions}
      value={previewValue}
      selectedElements={selectedElements}
    />
  );
};

export default KeyCounterPreviewLayer;
