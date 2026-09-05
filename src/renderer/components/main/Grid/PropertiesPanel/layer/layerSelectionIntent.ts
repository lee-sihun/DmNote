import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import type { DisplayItem, LayerItem } from '../types';

export type LayerSelectionIntent =
  | {
      type: 'set-full';
      elements: SelectedElement[];
      groupIds: string[];
    }
  | { type: 'set-elements'; elements: SelectedElement[] }
  | { type: 'replace'; element: SelectedElement }
  | { type: 'delay-single'; element: SelectedElement }
  | { type: 'delay-clear' }
  | { type: 'none' };

interface ItemSelectionAnchor {
  index: number;
  displayIndex: number | null;
}

interface GroupSelectionAnchor {
  index: null;
  displayIndex: number;
}

export interface LayerItemSelectionResolution {
  intent: LayerSelectionIntent;
  anchor: ItemSelectionAnchor | null;
}

export interface LayerGroupSelectionResolution {
  intent: LayerSelectionIntent;
  anchor: GroupSelectionAnchor | null;
}

interface ResolveLayerItemSelectionIntentParams {
  item: LayerItem;
  index: number;
  primary: boolean;
  shift: boolean;
  lastClickedIndex: number | null;
  lastClickedDisplayIndex: number | null;
  layerItems: readonly LayerItem[];
  displayItems: readonly DisplayItem[];
  selectedElements: SelectedElement[];
  selectedGroupIds: string[];
}

interface ResolveLayerGroupSelectionIntentParams {
  groupId: string;
  primary: boolean;
  shift: boolean;
  lastClickedDisplayIndex: number | null;
  layerItems: readonly LayerItem[];
  rangeLayerItems: readonly LayerItem[];
  displayItems: readonly DisplayItem[];
  selectedElements: SelectedElement[];
  selectedGroupIds: string[];
}

interface DisplayRangeSelection {
  elements: SelectedElement[];
  groupIds: string[];
}

export const layerItemToSelectedElement = (
  item: LayerItem,
): SelectedElement => {
  if (item.type === 'plugin') return { type: 'plugin', id: item.id };
  return {
    type: item.type,
    id: item.id,
    ...(item.index !== undefined ? { index: item.index } : {}),
  };
};

const collectDisplayRangeSelection = (
  startIndex: number,
  endIndex: number,
  displayItems: readonly DisplayItem[],
  layerItems: readonly LayerItem[],
): DisplayRangeSelection => {
  const rangeElements: SelectedElement[] = [];
  const rangeGroupIds: string[] = [];

  for (let index = startIndex; index <= endIndex; index++) {
    const displayItem = displayItems[index];
    if (!displayItem) continue;
    if (displayItem.displayType === 'group-header') {
      rangeGroupIds.push(displayItem.groupId);
      layerItems
        .filter((item) => item.groupId === displayItem.groupId)
        .forEach((child) => {
          rangeElements.push(layerItemToSelectedElement(child));
        });
    } else {
      rangeElements.push(layerItemToSelectedElement(displayItem.item));
    }
  }

  const seen = new Set<string>();
  const elements = rangeElements.filter((element) => {
    if (seen.has(element.id)) return false;
    seen.add(element.id);
    return true;
  });

  return { elements, groupIds: rangeGroupIds };
};

const resolveDisplayRangeIntent = (
  range: DisplayRangeSelection,
  primary: boolean,
  selectedElements: readonly SelectedElement[],
  selectedGroupIds: readonly string[],
): LayerSelectionIntent => {
  if (!primary) {
    return {
      type: 'set-full',
      elements: range.elements,
      groupIds: range.groupIds,
    };
  }

  const existingIds = new Set(selectedElements.map((element) => element.id));
  const newElements = range.elements.filter(
    (element) => !existingIds.has(element.id),
  );
  const existingGroupIds = new Set(selectedGroupIds);
  const newGroupIds = range.groupIds.filter(
    (groupId) => !existingGroupIds.has(groupId),
  );

  return {
    type: 'set-full',
    elements: [...selectedElements, ...newElements],
    groupIds: [...selectedGroupIds, ...newGroupIds],
  };
};

export const resolveLayerItemSelectionIntent = ({
  item,
  index,
  primary,
  shift,
  lastClickedIndex,
  lastClickedDisplayIndex,
  layerItems,
  displayItems,
  selectedElements,
  selectedGroupIds,
}: ResolveLayerItemSelectionIntentParams): LayerItemSelectionResolution => {
  if (
    shift &&
    (lastClickedDisplayIndex !== null || lastClickedIndex !== null)
  ) {
    const displayIndex = displayItems.findIndex(
      (displayItem) =>
        displayItem.displayType === 'layer' && displayItem.item.id === item.id,
    );

    if (lastClickedDisplayIndex !== null && displayIndex !== -1) {
      const range = collectDisplayRangeSelection(
        Math.min(lastClickedDisplayIndex, displayIndex),
        Math.max(lastClickedDisplayIndex, displayIndex),
        displayItems,
        layerItems,
      );
      return {
        intent: resolveDisplayRangeIntent(
          range,
          primary,
          selectedElements,
          selectedGroupIds,
        ),
        anchor: null,
      };
    }

    if (lastClickedIndex !== null) {
      const rangeElements: SelectedElement[] = [];
      const startIndex = Math.min(lastClickedIndex, index);
      const endIndex = Math.max(lastClickedIndex, index);
      for (let rangeIndex = startIndex; rangeIndex <= endIndex; rangeIndex++) {
        const rangeItem = layerItems[rangeIndex];
        if (rangeItem) {
          rangeElements.push(layerItemToSelectedElement(rangeItem));
        }
      }

      if (primary) {
        const existingIds = new Set(
          selectedElements.map((element) => element.id),
        );
        const newElements = rangeElements.filter(
          (element) => !existingIds.has(element.id),
        );
        return {
          intent: {
            type: 'set-elements',
            elements: [...selectedElements, ...newElements],
          },
          anchor: null,
        };
      }

      return {
        intent: { type: 'set-elements', elements: rangeElements },
        anchor: null,
      };
    }
  }

  const element = layerItemToSelectedElement(item);
  let intent: LayerSelectionIntent;

  if (primary) {
    const exists = selectedElements.some(
      (selectedElement) => selectedElement.id === element.id,
    );
    intent = {
      type: 'set-full',
      elements: exists
        ? selectedElements.filter(
            (selectedElement) => selectedElement.id !== element.id,
          )
        : [...selectedElements, element],
      groupIds: selectedGroupIds,
    };
  } else {
    const isAlreadySelected = selectedElements.some(
      (selectedElement) => selectedElement.id === item.id,
    );
    if (isAlreadySelected && selectedElements.length > 1) {
      intent = { type: 'delay-single', element };
    } else if (isAlreadySelected) {
      intent = { type: 'delay-clear' };
    } else {
      intent = { type: 'replace', element };
    }
  }

  const displayIndex = displayItems.findIndex(
    (displayItem) =>
      displayItem.displayType === 'layer' && displayItem.item.id === item.id,
  );
  return {
    intent,
    anchor: {
      index,
      displayIndex: displayIndex !== -1 ? displayIndex : null,
    },
  };
};

export const resolveLayerGroupSelectionIntent = ({
  groupId,
  primary,
  shift,
  lastClickedDisplayIndex,
  layerItems,
  rangeLayerItems,
  displayItems,
  selectedElements,
  selectedGroupIds,
}: ResolveLayerGroupSelectionIntentParams): LayerGroupSelectionResolution => {
  const children = layerItems.filter((item) => item.groupId === groupId);
  const childElements = children.map(layerItemToSelectedElement);
  const displayIndex = displayItems.findIndex(
    (displayItem) =>
      displayItem.displayType === 'group-header' &&
      displayItem.groupId === groupId,
  );

  if (displayIndex < 0) {
    return { intent: { type: 'none' }, anchor: null };
  }

  if (shift && lastClickedDisplayIndex !== null) {
    const range = collectDisplayRangeSelection(
      Math.min(lastClickedDisplayIndex, displayIndex),
      Math.max(lastClickedDisplayIndex, displayIndex),
      displayItems,
      rangeLayerItems,
    );
    return {
      intent: resolveDisplayRangeIntent(
        range,
        primary,
        selectedElements,
        selectedGroupIds,
      ),
      anchor: null,
    };
  }

  let intent: LayerSelectionIntent;
  if (primary) {
    const isCurrentlySelected = selectedGroupIds.includes(groupId);
    if (isCurrentlySelected) {
      const childIds = new Set(children.map((child) => child.id));
      intent = {
        type: 'set-full',
        elements: selectedElements.filter(
          (element) => !childIds.has(element.id),
        ),
        groupIds: selectedGroupIds.filter(
          (selectedGroupId) => selectedGroupId !== groupId,
        ),
      };
    } else {
      const existingIds = new Set(
        selectedElements.map((element) => element.id),
      );
      const newElements = childElements.filter(
        (element) => !existingIds.has(element.id),
      );
      intent = {
        type: 'set-full',
        elements: [...selectedElements, ...newElements],
        groupIds: [...selectedGroupIds, groupId],
      };
    }
  } else {
    intent = {
      type: 'set-full',
      elements: childElements,
      groupIds: [groupId],
    };
  }

  return {
    intent,
    anchor: { index: null, displayIndex },
  };
};
