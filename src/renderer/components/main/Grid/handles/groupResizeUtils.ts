/**
 * 그룹 리사이즈 관련 유틸리티 함수들
 * GroupResizeHandles 컴포넌트에서 분리된 순수 함수들
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

export type { SelectedElement };

// ===== 타입 정의 =====

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementBounds {
  element: SelectedElement;
  bounds: Bounds;
}

export function elementBoundsChanged(
  initialBounds: ElementBounds[],
  nextBounds: ElementBounds[],
): boolean {
  return nextBounds.some(({ element, bounds }) => {
    const initial = initialBounds.find(
      (entry) =>
        entry.element.id === element.id && entry.element.type === element.type,
    );
    return (
      !initial ||
      bounds.x !== initial.bounds.x ||
      bounds.y !== initial.bounds.y ||
      bounds.width !== initial.bounds.width ||
      bounds.height !== initial.bounds.height
    );
  });
}

/** 항상 비율을 지키는 요소 - 그림 레이어(스프라이트)는 늘리지 않는다 */
export function isAspectLockedElement(element: SelectedElement): boolean {
  return element.type === 'sprite';
}

export interface GroupResizeAxis {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

const groupScaleRatio = (start: number, next: number): number =>
  start > 0 && Number.isFinite(start) && Number.isFinite(next)
    ? next / start
    : 1;

/**
 * 비율 고정 요소가 따를 단일 배율. 드래그한 축의 배율을 쓰고, 두 축이 함께 움직이는
 * 모서리는 단일 리사이즈와 같은 규칙으로 변화가 큰 축을 따른다
 */
export function uniformGroupScale(
  scaleX: number,
  scaleY: number,
  handle: GroupResizeAxis,
): number {
  if (handle.dx !== 0 && handle.dy === 0) return scaleX;
  if (handle.dy !== 0 && handle.dx === 0) return scaleY;
  return Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
}

/**
 * 그룹 변환을 요소 하나에 투영. 일반 요소는 그룹 배율을 축마다 그대로 받고,
 * 비율 고정 요소는 단일 배율로 가로·세로를 함께 바꾸되 중심은 그룹 배율로 옮겨
 * 다른 요소와 같은 자리를 지킨다
 */
export function projectGroupElementBounds(
  element: SelectedElement,
  bounds: Bounds,
  startGroup: Bounds,
  nextGroup: Bounds,
  handle: GroupResizeAxis,
): Bounds {
  const scaleX = groupScaleRatio(startGroup.width, nextGroup.width);
  const scaleY = groupScaleRatio(startGroup.height, nextGroup.height);
  const relativeX = bounds.x - startGroup.x;
  const relativeY = bounds.y - startGroup.y;
  if (!isAspectLockedElement(element)) {
    return {
      x: nextGroup.x + relativeX * scaleX,
      y: nextGroup.y + relativeY * scaleY,
      width: bounds.width * scaleX,
      height: bounds.height * scaleY,
    };
  }
  const scale = uniformGroupScale(scaleX, scaleY, handle);
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  const centerX = nextGroup.x + (relativeX + bounds.width / 2) * scaleX;
  const centerY = nextGroup.y + (relativeY + bounds.height / 2) * scaleY;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

/**
 * 축소 한계 계산에 쓸 요소 치수. 비율 고정 요소는 어느 축을 끌어도 짧은 변이
 * 함께 줄어드므로 짧은 변으로 잰다
 */
export function shrinkLimitSize(
  element: SelectedElement,
  bounds: Bounds,
  axis: 'x' | 'y',
): number {
  if (isAspectLockedElement(element)) {
    return Math.min(bounds.width, bounds.height);
  }
  return axis === 'x' ? bounds.width : bounds.height;
}

/**
 * 요소가 리사이즈 가능한지 확인
 */
export function isElementResizable(
  element: SelectedElement,
  _positions: CanonicalEditorDocumentV1['keyPositions'],
  _statPositions: CanonicalEditorDocumentV1['statPositions'],
  _graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  _knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  _selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
): boolean {
  if (element.type === 'key') {
    return true;
  } else if (element.type === 'stat') {
    return true;
  } else if (element.type === 'graph') {
    return true;
  } else if (element.type === 'knob') {
    return true;
  } else if (element.type === 'sprite') {
    // 리사이즈는 resizeSprite op - 상자와 자세 이동값이 함께 비례 스케일된다
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
  positions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
): Bounds | null {
  if (element.type === 'key') {
    const pos = positions[selectedKeyType]?.find(
      (candidate) => candidate.id === element.id,
    );
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 60,
      height: pos.height || 60,
    };
  } else if (element.type === 'stat') {
    const pos = statPositions?.[selectedKeyType]?.find(
      (candidate) => candidate.id === element.id,
    );
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 60,
      height: pos.height || 60,
    };
  } else if (element.type === 'graph') {
    const pos = graphPositions?.[selectedKeyType]?.find(
      (candidate) => candidate.id === element.id,
    );
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 200,
      height: pos.height || 100,
    };
  } else if (element.type === 'knob') {
    const pos = knobPositions?.[selectedKeyType]?.find(
      (candidate) => candidate.id === element.id,
    );
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 60,
      height: pos.height || 60,
    };
  } else if (element.type === 'sprite') {
    // 활동 영역 박스가 곧 리사이즈 대상
    const pos = spritePositions[selectedKeyType]?.find(
      (candidate) => candidate.id === element.id,
    );
    if (!pos) return null;
    return {
      x: pos.dx,
      y: pos.dy,
      width: pos.width || 200,
      height: pos.height || 200,
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
  positions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
  selectedKeyType: string,
  pluginElements: PluginDisplayElementInternal[],
  spritePositions: CanonicalEditorDocumentV1['spritePositions'],
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
        knobPositions,
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
      knobPositions,
      selectedKeyType,
      pluginElements,
      spritePositions,
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
  positions: CanonicalEditorDocumentV1['keyPositions'],
  statPositions: CanonicalEditorDocumentV1['statPositions'],
  graphPositions: CanonicalEditorDocumentV1['graphPositions'],
  knobPositions: CanonicalEditorDocumentV1['knobPositions'],
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
          knobPositions,
          selectedKeyType,
          pluginElements,
        ),
    )
    .map((element) => element.id);
}
