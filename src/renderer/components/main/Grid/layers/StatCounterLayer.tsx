import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import CounterPreviewLayer, {
  type CounterPreviewPosition,
} from './CounterPreviewLayer';

interface StatCounterLayerProps {
  positions: CounterPreviewPosition[];
  selectedElements?: SelectedElement[];
}

const normalizeStatCounterPreviewValue = (
  value: number | null | undefined,
): number => (value ?? 0) | 0;

const StatCounterLayer = ({
  positions,
  selectedElements = [],
}: StatCounterLayerProps) => {
  return (
    <CounterPreviewLayer
      kind="stat"
      positions={positions}
      value={normalizeStatCounterPreviewValue(0)}
      selectedElements={selectedElements}
    />
  );
};

export default StatCounterLayer;
