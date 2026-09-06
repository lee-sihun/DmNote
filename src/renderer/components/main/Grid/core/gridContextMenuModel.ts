import type { ListItem } from '@components/main/Modal/listPopup/ListPopup';
import { isNativeElementId } from '@src/renderer/editor/model/elementId';
import type {
  IndexedSelectableElementType,
  SelectedElement,
} from '@stores/grid/useGridSelectionStore';
import {
  summarizeSelectionGrouping,
  type GroupSelectionSource,
} from '@utils/grid/groupSelection';

type Translate = (key: string) => string;

export const buildMixedSelectionMenuItems = (
  selectedElements: readonly SelectedElement[],
  groupingSource: GroupSelectionSource | null,
  t: Translate,
): ListItem[] => {
  const items: ListItem[] = [
    { id: 'delete', label: t('contextMenu.deleteSelected') },
    { id: 'duplicate', label: t('contextMenu.duplicateSelected') },
  ];

  if (selectedElements.length >= 2 && groupingSource) {
    const grouping = summarizeSelectionGrouping(
      selectedElements,
      groupingSource,
    );
    if (grouping.kind === 'same') {
      items.push({ id: 'ungroupSelected', label: t('contextMenu.ungroup') });
    } else if (grouping.kind === 'none') {
      items.push({
        id: 'groupSelected',
        label: t('contextMenu.groupSelected'),
      });
    } else {
      items.push(
        {
          id: 'groupSelected',
          label: t('contextMenu.groupSelected'),
        },
        { id: 'ungroupSelected', label: t('contextMenu.ungroup') },
      );
    }
  }

  items.push(
    { id: 'bringToFront', label: t('contextMenu.bringToFront') },
    { id: 'sendToBack', label: t('contextMenu.sendToBack') },
  );
  return items;
};

export const shouldOpenMixedSelectionMenu = (
  selectedElements: readonly SelectedElement[],
  clickedId: string,
): boolean =>
  selectedElements.length > 1 &&
  selectedElements.some((element) => element.id === clickedId);

export const isStableNativeSelection = (element: {
  type: string;
  id: string;
}): element is { type: IndexedSelectableElementType; id: string } =>
  (element.type === 'key' ||
    element.type === 'stat' ||
    element.type === 'graph' ||
    element.type === 'knob') &&
  element.id.length > 0 &&
  isNativeElementId(element.id);

export const gridAddTypeForMenuItem = (
  id: string,
): IndexedSelectableElementType | null => {
  if (id === 'add') return 'key';
  if (id === 'addStat') return 'stat';
  if (id === 'addGraph') return 'graph';
  if (id === 'addKnob') return 'knob';
  return null;
};
