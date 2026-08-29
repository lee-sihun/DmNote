import {
  isElementInMarquee,
  type SelectedElement,
} from '@stores/grid/useGridSelectionStore';

export interface KeySelectionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativeRangeElement {
  id: string;
  dx: number;
  dy: number;
  width?: number;
  height?: number;
  hidden?: boolean;
}

interface PluginRangeElement {
  fullId: string;
  tabId?: string;
  position: { x: number; y: number };
  measuredSize?: { width: number; height: number };
}

interface KeyRangeSelectionSource {
  mode: string;
  keyPositions: readonly NativeRangeElement[];
  pluginElements: readonly PluginRangeElement[];
  statPositions: readonly (NativeRangeElement | null | undefined)[];
  graphPositions: readonly (NativeRangeElement | null | undefined)[];
  knobPositions: readonly (NativeRangeElement | null | undefined)[];
}

const boundsFor = (
  position: NativeRangeElement,
  defaultWidth: number,
  defaultHeight: number,
): KeySelectionBounds => ({
  x: position.dx,
  y: position.dy,
  width: position.width || defaultWidth,
  height: position.height || defaultHeight,
});

export const collectElementsInKeyRange = (
  anchor: KeySelectionBounds,
  clickedPosition: NativeRangeElement,
  source: KeyRangeSelectionSource,
): SelectedElement[] => {
  const clicked = boundsFor(clickedPosition, 60, 60);
  const minX = Math.min(anchor.x, clicked.x);
  const maxX = Math.max(anchor.x + anchor.width, clicked.x + clicked.width);
  const minY = Math.min(anchor.y, clicked.y);
  const maxY = Math.max(anchor.y + anchor.height, clicked.y + clicked.height);
  const rangeRect = {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
  const selected: SelectedElement[] = [];

  source.keyPositions.forEach((position, index) => {
    if (isElementInMarquee(boundsFor(position, 60, 60), rangeRect)) {
      selected.push({ type: 'key', id: position.id, index });
    }
  });

  source.pluginElements.forEach((element) => {
    const belongsToCurrentTab = !element.tabId || element.tabId === source.mode;
    if (!belongsToCurrentTab || !element.measuredSize) return;
    const elementBounds = {
      x: element.position.x,
      y: element.position.y,
      width: element.measuredSize.width,
      height: element.measuredSize.height,
    };
    if (isElementInMarquee(elementBounds, rangeRect)) {
      selected.push({ type: 'plugin', id: element.fullId });
    }
  });

  const collectNative = (
    type: 'stat' | 'graph' | 'knob',
    positions: readonly (NativeRangeElement | null | undefined)[],
    defaultWidth: number,
    defaultHeight: number,
  ) => {
    positions.forEach((position, index) => {
      if (!position || position.hidden) return;
      if (
        isElementInMarquee(
          boundsFor(position, defaultWidth, defaultHeight),
          rangeRect,
        )
      ) {
        selected.push({ type, id: position.id, index });
      }
    });
  };

  collectNative('stat', source.statPositions, 60, 60);
  collectNative('graph', source.graphPositions, 200, 100);
  collectNative('knob', source.knobPositions, 80, 80);
  return selected;
};
