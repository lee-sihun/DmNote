import type {
  GraphItemPosition,
  GraphItemPositions,
} from '@src/types/key/graphItems';
import type {
  KeyMappings,
  KeyPosition,
  KeyPositions,
} from '@src/types/key/keys';
import type { KnobItemPosition, KnobItemPositions } from '@src/types/key/knobs';
import type { StatItemPositions } from '@src/types/key/statItems';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { aggregateMixedValue } from '@utils/core/mixedValue';
import { slotCanonical, slotDisplayName } from '@utils/keySlot';
import { getStatTypeLabel } from '@utils/grid/statTypeLabel';

interface BatchSelectedElement<Type extends string> {
  type: Type;
  id: string;
}

interface IndexedPosition<Position> {
  index: number;
  position: Position;
}

const indexPositionsById = <Position extends { id?: string }>(
  positions: readonly Position[],
): Map<string, IndexedPosition<Position>> => {
  const index = new Map<string, IndexedPosition<Position>>();
  positions.forEach((position, positionIndex) => {
    if (!position.id || index.has(position.id)) return;
    index.set(position.id, { index: positionIndex, position });
  });
  return index;
};

const groupPositionsById = <Position extends { id?: string }>(
  positions: readonly Position[],
): Map<string, Position[]> => {
  const groups = new Map<string, Position[]>();
  positions.forEach((position) => {
    if (!position.id) return;
    const group = groups.get(position.id);
    if (group) group.push(position);
    else groups.set(position.id, [position]);
  });
  return groups;
};

const indexSelectionDataById = <Data extends { position: { id?: string } }>(
  data: readonly Data[],
): Map<string, Data> => {
  const index = new Map<string, Data>();
  data.forEach((item) => {
    const id = item.position.id;
    if (!id || index.has(id)) return;
    index.set(id, item);
  });
  return index;
};

export interface BatchSelectionModelInput {
  selectedKeyType: string;
  positions: KeyPositions;
  canonicalPositions: KeyPositions;
  keyMappings: KeyMappings;
  statItemPositions: StatItemPositions;
  graphItemPositions: GraphItemPositions;
  knobItemPositions: KnobItemPositions;
  selectedKeyElements: readonly BatchSelectedElement<'key'>[];
  selectedKeyLikeElements: readonly BatchSelectedElement<'key' | 'stat'>[];
  selectedGraphElements: readonly BatchSelectedElement<'graph'>[];
  selectedKnobElements: readonly BatchSelectedElement<'knob'>[];
  selectedBatchStyleElements: readonly BatchSelectedElement<
    'key' | 'stat' | 'graph' | 'knob'
  >[];
}

export const createBatchSelectionModel = ({
  selectedKeyType,
  positions,
  canonicalPositions,
  keyMappings,
  statItemPositions,
  graphItemPositions,
  knobItemPositions,
  selectedKeyElements,
  selectedKeyLikeElements,
  selectedGraphElements,
  selectedKnobElements,
  selectedBatchStyleElements,
}: BatchSelectionModelInput) => {
  const modePositions = positions[selectedKeyType] ?? [];
  const modeCanonicalPositions = canonicalPositions[selectedKeyType] ?? [];
  const modeKeyMappings = keyMappings[selectedKeyType] ?? [];
  const modeStatPositions = statItemPositions[selectedKeyType] ?? [];
  const modeGraphPositions = graphItemPositions[selectedKeyType] ?? [];
  const modeKnobPositions = knobItemPositions[selectedKeyType] ?? [];

  const keyIndex = indexPositionsById(modePositions);
  const statIndex = indexPositionsById(modeStatPositions);
  const graphIndex = indexPositionsById(modeGraphPositions);
  const knobIndex = indexPositionsById(modeKnobPositions);
  const canonicalKeyGroups = groupPositionsById(modeCanonicalPositions);

  const selectedKeysData = selectedKeyLikeElements
    .map((element) => {
      if (element.type === 'key') {
        const indexed = keyIndex.get(element.id);
        if (!indexed) return null;
        const { index, position } = indexed;
        const slot = modeKeyMappings[index] ?? null;
        const keyCode = slot != null ? slotCanonical(slot) : null;
        const keyInfo =
          slot != null && keyCode
            ? typeof slot === 'string'
              ? getKeyInfoByGlobalKey(slot)
              : {
                  browserKey: keyCode,
                  globalKey: keyCode,
                  displayName: slotDisplayName(slot),
                }
            : null;
        return { index, position, keyCode, keyInfo };
      }
      const indexed = statIndex.get(element.id);
      if (!indexed) return null;
      const { index, position } = indexed;
      const statLabel =
        (position.displayText || '').trim() ||
        getStatTypeLabel(position.statType ?? null);
      return {
        index,
        position,
        keyCode: null,
        keyInfo: { globalKey: statLabel, displayName: statLabel },
      };
    })
    .filter((data): data is NonNullable<typeof data> => data !== null);

  const selectedGraphsData = selectedGraphElements
    .map((element) => {
      const indexed = graphIndex.get(element.id);
      if (!indexed) return null;
      const { index, position } = indexed;
      const graphLabel = `${getStatTypeLabel(position.statType ?? null)} Graph`;
      return {
        index,
        position,
        keyCode: null,
        keyInfo: { globalKey: graphLabel, displayName: graphLabel },
      };
    })
    .filter((data): data is NonNullable<typeof data> => data !== null);

  const selectedKnobsData = selectedKnobElements
    .map((element) => {
      const indexed = knobIndex.get(element.id);
      if (!indexed) return null;
      const { index, position } = indexed;
      const knobLabel = (position.displayText || '').trim() || 'Knob';
      return {
        index,
        position,
        keyCode: null,
        keyInfo: { globalKey: knobLabel, displayName: knobLabel },
      };
    })
    .filter((data): data is NonNullable<typeof data> => data !== null);

  const keyLikeDataById = indexSelectionDataById(selectedKeysData);
  const graphDataById = indexSelectionDataById(selectedGraphsData);
  const knobDataById = indexSelectionDataById(selectedKnobsData);
  const selectedBatchStyleData = selectedBatchStyleElements
    .map((element) =>
      element.type === 'key' || element.type === 'stat'
        ? keyLikeDataById.get(element.id)
        : element.type === 'graph'
        ? graphDataById.get(element.id)
        : knobDataById.get(element.id),
    )
    .filter((data): data is NonNullable<typeof data> => data !== undefined);

  const selectedKeyOnlyPositions = selectedKeyElements
    .map((element) => keyIndex.get(element.id) ?? null)
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const selectedActiveCapablePositions: KeyPosition[] = [
    ...selectedKeyOnlyPositions.map(({ position }) => position),
    ...selectedKnobElements.flatMap((element) => {
      const indexed = knobIndex.get(element.id);
      return indexed ? [indexed.position] : [];
    }),
  ];
  const selectedCanonicalKeyPositions = selectedKeyLikeElements.flatMap(
    (element) =>
      element.type === 'key' ? canonicalKeyGroups.get(element.id) ?? [] : [],
  );

  const getSelectedKeysData = () => selectedKeysData;
  const getSelectedGraphsData = () => selectedGraphsData;
  const getSelectedKnobsData = () => selectedKnobsData;
  const getSelectedBatchStyleData = () => selectedBatchStyleData;
  const getSelectedKeyOnlyPositions = () => selectedKeyOnlyPositions;

  return {
    getSelectedKeysData,
    getSelectedGraphsData,
    getSelectedKnobsData,
    getSelectedBatchStyleData,
    getSelectedKeyOnlyPositions,
    getMixedValue: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedKeysData().map((data) => data.position),
        getter,
        defaultValue,
      ),
    getMixedValueCanonical: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) => {
      return aggregateMixedValue(
        selectedCanonicalKeyPositions,
        getter,
        defaultValue,
      );
    },
    getMixedValueGraphs: <Value>(
      getter: (position: GraphItemPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedGraphsData().map((data) => data.position),
        getter,
        defaultValue,
      ),
    getMixedValueGraphsAsKey: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedGraphsData().map((data) => data.position),
        getter,
        defaultValue,
      ),
    getMixedValueKnobs: <Value>(
      getter: (position: KnobItemPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedKnobsData().map((data) => data.position),
        getter,
        defaultValue,
      ),
    getMixedValueKnobsAsKey: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedKnobsData().map((data) => data.position),
        getter,
        defaultValue,
      ),
    getMixedValueBatch: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedBatchStyleData().map((data) => data.position as KeyPosition),
        getter,
        defaultValue,
      ),
    getMixedValueActiveCapable: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(selectedActiveCapablePositions, getter, defaultValue),
    getMixedValueKeysOnly: <Value>(
      getter: (position: KeyPosition) => Value | undefined,
      defaultValue: Value,
    ) =>
      aggregateMixedValue(
        getSelectedKeyOnlyPositions().map(({ position }) => position),
        getter,
        defaultValue,
      ),
  };
};
