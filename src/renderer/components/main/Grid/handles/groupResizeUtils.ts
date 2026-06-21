/**
 * 그룹 리사이즈 관련 유틸리티 함수들
 * GroupResizeHandles 컴포넌트에서 분리된 순수 함수들
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { KeyPositions } from '@src/types/key/keys';
import type { StatItemPositions } from '@src/types/key/statItems';
import type { GraphItemPositions } from '@src/types/key/graphItems';
import type { DialItemPositions } from '@src/types/key/dials';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { SelectableElementType } from '@stores/grid/useGridSelectionStore';

// ===== 타입 정의 =====

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectedElement {
  id: string;
  type: SelectableElementType;
  index?: number;
}

export interface ElementBounds {
  element: SelectedElement;
  bounds: Bounds;
}

/**
 * 요소가 리사이즈 가능한지 확인
 */
export function isElementResizable(
  element: SelectedElement,
  _positions: KeyPositions,
  _statPositions: StatItemPositions,
  _graphPositions: GraphItemPositions,
  _dialPositions: DialItemPositions,
  _selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
): boolean {
  if (element.type === 'key') {
    return true;
  } else if (element.type === 'stat') {
    return true;
  } else if (element.type === 'graph') {
    return true;
  } else if (element.type === 'dial') {
    return true;
  } else if (element.type === 'plugin') {
    const pluginEl = pluginElements.find(
      (p: PluginDisplayElementInternal) => p.fullId === element.id,
    );
    if (!pluginEl) return false;

    const definitions = usePluginDisplayElementStore.getState().definitions;
    const definition = pluginEl.definitionId
      ? definitions.get(pluginEl.definitionId)
      : null;

    return definition?.resizable === true;
  }
  return false;
}

/**
 * 요소의 bounds 가져오기
 */
export function getElementBounds(
  element: SelectedElement,
  positions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  dialPositions: DialItemPositions,
  selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
): Bounds | null {
  if (element.type === 'key' && element.index !== undefined) {
    const pos = positions[selectedKeyType]?.[element.index];
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 60,
      height: pos.height || 60,
    };
  } else if (element.type === 'stat' && element.index !== undefined) {
    const pos = statPositions?.[selectedKeyType]?.[element.index];
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 60,
      height: pos.height || 60,
    };
  } else if (element.type === 'graph' && element.index !== undefined) {
    const pos = graphPositions?.[selectedKeyType]?.[element.index];
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 200,
      height: pos.height || 100,
    };
  } else if (element.type === 'dial' && element.index !== undefined) {
    const pos = dialPositions?.[selectedKeyType]?.[element.index];
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 60,
      height: pos.height || 60,
    };
  } else if (element.type === 'plugin') {
    const pluginEl = pluginElements.find(
      (p: PluginDisplayElementInternal) => p.fullId === element.id,
    );
    if (!pluginEl?.measuredSize) return null;
    return {
      x: pluginEl.position.x,
      y: pluginEl.position.y,
      width: pluginEl.measuredSize.width,
      height: pluginEl.measuredSize.height,
    };
  }
  return null;
}

/**
 * 그룹 바운딩 박스 계산 (리사이즈 가능한 요소만 포함)
 */
export function calculateGroupBounds(
  selectedElements: SelectedElement[],
  positions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  dialPositions: DialItemPositions,
  selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
): (Bounds & { elementBounds: ElementBounds[] }) | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const elementBoundsList: ElementBounds[] = [];

  for (const element of selectedElements) {
    if (
      !isElementResizable(
        element,
        positions,
        statPositions,
        graphPositions,
        dialPositions,
        selectedKeyType,
        pluginElements,
      )
    ) {
      continue;
    }

    const bounds = getElementBounds(
      element,
      positions,
      statPositions,
      graphPositions,
      dialPositions,
      selectedKeyType,
      pluginElements,
    );
    if (!bounds) continue;

    elementBoundsList.push({ element, bounds });

    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (elementBoundsList.length === 0) return null;

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    elementBounds: elementBoundsList,
  };
}

/**
 * 리사이즈 불가능한 요소 ID 목록 반환
 */
export function getNonResizableElementIds(
  selectedElements: SelectedElement[],
  positions: KeyPositions,
  statPositions: StatItemPositions,
  graphPositions: GraphItemPositions,
  dialPositions: DialItemPositions,
  selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
): string[] {
  return selectedElements
    .filter(
      (element) =>
        !isElementResizable(
          element,
          positions,
          statPositions,
          graphPositions,
          dialPositions,
          selectedKeyType,
          pluginElements,
        ),
    )
    .map((element) => element.id);
}
