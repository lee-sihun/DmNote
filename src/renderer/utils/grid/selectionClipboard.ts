import type {
  ClipboardItem,
  SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import type {
  CanonicalGraphItemPosition,
  CanonicalKeyPosition,
  CanonicalKnobItemPosition,
  CanonicalReactiveSpritePosition,
  CanonicalStatItemPosition,
} from '@src/types/editor';
import type { KeySlot } from '@src/types/key/keys';
import type { LayerGroupDef } from '@src/types/layerGroups';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { cloneSlot } from '@utils/keySlot';
import { buildSpriteKeyCanonicalMap } from '@utils/sprite/spriteKeyBinding';

interface SelectionClipboardSource {
  selectedElements: readonly SelectedElement[];
  keyMappings: readonly KeySlot[];
  keyPositions: readonly CanonicalKeyPosition[];
  statPositions: readonly CanonicalStatItemPosition[];
  graphPositions: readonly CanonicalGraphItemPosition[];
  knobPositions: readonly CanonicalKnobItemPosition[];
  spritePositions: readonly CanonicalReactiveSpritePosition[];
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
  spritePositions,
  pluginElements,
  selectedGroupIds,
  layerGroups,
  collapsedGroupIds,
}: SelectionClipboardSource): SelectionClipboardSnapshot => {
  const items: ClipboardItem[] = [];
  // 트리거 id -> canonical 키. 재생 매핑과 같은 결합을 쓴다
  const sourceKeyCanonicals = buildSpriteKeyCanonicalMap(
    keyMappings,
    keyPositions,
  );

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
    } else if (element.type === 'sprite') {
      const position = spritePositions.find(
        (candidate) => candidate.id === element.id,
      );
      if (position) {
        items.push({
          type: 'sprite',
          position: { ...position },
          // 다른 탭에 붙일 때 같은 키로 다시 결합하려면 지금의 결합을 얼려야 한다
          triggerCanonicals: Object.fromEntries(
            position.poses.flatMap((pose) =>
              pose.triggers.flatMap((trigger) => {
                const canonical = sourceKeyCanonicals.get(trigger);
                return canonical === undefined ? [] : [[trigger, canonical]];
              }),
            ),
          ),
        });
      }
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
