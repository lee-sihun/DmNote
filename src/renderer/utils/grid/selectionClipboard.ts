import type {
  ClipboardItem,
  SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import type {
  CanonicalGraphItemPosition,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
  CanonicalStatItemPosition,
} from '@src/types/editor';
import type { KeySlot } from '@src/types/key/keys';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { cloneSlot } from '@utils/keySlot';

interface SelectionClipboardSource {
  selectedElements: readonly SelectedElement[];
  keyMappings: readonly KeySlot[];
  keyPositions: readonly CanonicalKeyPosition[];
  statPositions: readonly CanonicalStatItemPosition[];
  graphPositions: readonly CanonicalGraphItemPosition[];
  knobPositions: readonly CanonicalKnobItemPosition[];
  pluginElements: readonly PluginDisplayElementInternal[];
  selectedGroupIds: readonly string[];
  layerGroups: readonly LayerGroupDef[];
  collapsedGroupIds: ReadonlySet<string>;
}

export interface SelectionClipboardSnapshot {
  items: ClipboardItem[];
  groups: Array<{ id: string; name: string; collapsed?: boolean }>;
}

export const createSelectionClipboardSnapshot = ({
  selectedElements,
  keyMappings,
  keyPositions,
  statPositions,
  graphPositions,
  knobPositions,
  pluginElements,
  selectedGroupIds,
  layerGroups,
  collapsedGroupIds,
}: SelectionClipboardSource): SelectionClipboardSnapshot => {
  const items: ClipboardItem[] = [];

  for (const element of selectedElements) {
    if (element.type === 'key') {
      const index = keyPositions.findIndex(
        (position) => position.id === element.id,
      );
      const keyCode = index >= 0 ? keyMappings[index] : undefined;
      const position = index >= 0 ? keyPositions[index] : undefined;
      if (keyCode !== undefined && position) {
        items.push({
          type: 'key',
          keyCode: cloneSlot(keyCode),
          position: { ...position },
        });
      }
    } else if (element.type === 'stat') {
      const position = statPositions.find(
        (candidate) => candidate.id === element.id,
      );
      if (position) items.push({ type: 'stat', position: { ...position } });
    } else if (element.type === 'graph') {
      const position = graphPositions.find(
        (candidate) => candidate.id === element.id,
      );
      if (position) items.push({ type: 'graph', position: { ...position } });
    } else if (element.type === 'knob') {
      const position = knobPositions.find(
        (candidate) => candidate.id === element.id,
      );
      if (position) items.push({ type: 'knob', position: { ...position } });
    } else {
      const pluginElement = pluginElements.find(
        (candidate) => candidate.fullId === element.id,
      );
      if (pluginElement) {
        const { fullId: _fullId, ...elementData } = pluginElement;
        items.push({ type: 'plugin', element: elementData });
      }
    }
  }

  const groups = selectedGroupIds.flatMap((groupId) => {
    const group = layerGroups.find((candidate) => candidate.id === groupId);
    return group
      ? [
          {
            id: groupId,
            name: group.name,
            collapsed: collapsedGroupIds.has(groupId) || undefined,
          },
        ]
      : [];
  });
  return { items, groups };
};
