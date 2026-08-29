import type { CanonicalKnobItemPosition } from '@src/types/editor';
import type { GraphItemPosition } from '@src/types/key/graphItems';
import type { KeyPosition } from '@src/types/key/keys';
import type { KnobItemPosition } from '@src/types/key/knobs';
import { getKeyInfoByGlobalKey } from '@utils/core/KeyMaps';
import { slotCanonical, slotDisplayName } from '@utils/keySlot';
import { getStatTypeLabel } from './propertyPanelAdapters';
import type { usePropertiesPanelSelection } from './usePropertiesPanelSelection';

type PropertiesPanelSelection = ReturnType<typeof usePropertiesPanelSelection>;

type BatchSelectionModelInput = Pick<
  PropertiesPanelSelection,
  | 'selectedKeyType'
  | 'positions'
  | 'canonicalPositions'
  | 'keyMappings'
  | 'statItemPositions'
  | 'graphItemPositions'
  | 'knobItemPositions'
  | 'selectedKeyElements'
  | 'selectedKeyLikeElements'
  | 'selectedGraphElements'
  | 'selectedKnobElements'
  | 'selectedBatchStyleElements'
>;

const aggregateMixedValue = <Position, Value>(
  positions: Position[],
  getter: (position: Position) => Value | undefined,
  defaultValue: Value,
): { isMixed: boolean; value: Value } => {
  if (positions.length === 0) return { isMixed: false, value: defaultValue };

  const firstValue = getter(positions[0]) ?? defaultValue;
  const isMixed = positions.some((position) => {
    const value = getter(position) ?? defaultValue;
    if (typeof value === 'object' && typeof firstValue === 'object') {
      return JSON.stringify(value) !== JSON.stringify(firstValue);
    }
    return value !== firstValue;
  });
  return { isMixed, value: firstValue };
};

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
  const getSelectedKeysData = () =>
    selectedKeyLikeElements
      .map((element) => {
        if (element.type === 'key') {
          const index = (positions[selectedKeyType] ?? []).findIndex(
            (position) => position.id === element.id,
          );
          if (index < 0) return null;
          const position = positions[selectedKeyType]?.[index];
          const slot = keyMappings[selectedKeyType]?.[index] ?? null;
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
        const index = (statItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === element.id,
        );
        if (index < 0) return null;
        const position = statItemPositions[selectedKeyType]?.[index];
        const statLabel =
          (position?.displayText || '').trim() ||
          getStatTypeLabel(position?.statType ?? null);
        return {
          index,
          position,
          keyCode: null,
          keyInfo: { globalKey: statLabel, displayName: statLabel },
        };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );

  const getSelectedGraphsData = () =>
    selectedGraphElements
      .map((element) => {
        const index = (graphItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === element.id,
        );
        if (index < 0) return null;
        const position = graphItemPositions[selectedKeyType]?.[index];
        const graphLabel = `${getStatTypeLabel(
          position?.statType ?? null,
        )} Graph`;
        return {
          index,
          position,
          keyCode: null,
          keyInfo: { globalKey: graphLabel, displayName: graphLabel },
        };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );

  const getSelectedKnobsData = () =>
    selectedKnobElements
      .map((element) => {
        const index = (knobItemPositions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === element.id,
        );
        if (index < 0) return null;
        const position = knobItemPositions[selectedKeyType]?.[index];
        const knobLabel = (position?.displayText || '').trim() || 'Knob';
        return {
          index,
          position,
          keyCode: null,
          keyInfo: { globalKey: knobLabel, displayName: knobLabel },
        };
      })
      .filter(
        (data): data is NonNullable<typeof data> =>
          data !== null && data.position !== undefined,
      );

  const getSelectedBatchStyleData = () => {
    const keyLikeData = getSelectedKeysData();
    const graphData = getSelectedGraphsData();
    const knobData = getSelectedKnobsData();
    return selectedBatchStyleElements
      .map((element) => {
        if (element.type === 'key') {
          return keyLikeData.find((data) => data.position.id === element.id);
        }
        if (element.type === 'stat') {
          return keyLikeData.find((data) => data.position.id === element.id);
        }
        if (element.type === 'graph') {
          return graphData.find((data) => data.position.id === element.id);
        }
        return knobData.find((data) => data.position.id === element.id);
      })
      .filter((data): data is NonNullable<typeof data> => data !== undefined);
  };

  const getSelectedKeyOnlyPositions = () =>
    selectedKeyElements
      .map((element) => {
        const index = (positions[selectedKeyType] ?? []).findIndex(
          (position) => position.id === element.id,
        );
        const position = positions[selectedKeyType]?.[index];
        return position ? { index, position } : null;
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);

  const getSelectedActiveCapablePositions = (): KeyPosition[] => {
    const keyData = getSelectedKeyOnlyPositions().map(
      ({ position }) => position,
    );
    const knobData = selectedKnobElements
      .map((element) =>
        knobItemPositions[selectedKeyType]?.find(
          (position) => position.id === element.id,
        ),
      )
      .filter(
        (position): position is CanonicalKnobItemPosition => position != null,
      );
    return [...keyData, ...knobData];
  };

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
      const modePositions = canonicalPositions[selectedKeyType] ?? [];
      const selected = selectedKeyLikeElements.flatMap((element) =>
        element.type === 'key'
          ? modePositions.filter((position) => position.id === element.id)
          : [],
      );
      return aggregateMixedValue(selected, getter, defaultValue);
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
      aggregateMixedValue(
        getSelectedActiveCapablePositions(),
        getter,
        defaultValue,
      ),
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
