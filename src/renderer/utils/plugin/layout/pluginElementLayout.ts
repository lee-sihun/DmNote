import type { CSSProperties } from 'react';
import type {
  ElementResizeAnchor,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';
import type { KeySlot } from '@src/types/key/keys';
import { slotCanonical } from '@utils/keySlot';
import { resolveResizablePluginElementSize } from './pluginElementMeasurement';

interface PluginElementPositionInput {
  element: Pick<PluginDisplayElementInternal, 'position' | 'anchor'>;
  positions: Record<string, Array<{ dx: number; dy: number }>>;
  keyMappings: Record<string, KeySlot[]>;
  selectedKeyType: string;
  positionOffset: { x: number; y: number };
}

interface PluginElementStyleInput {
  element: PluginDisplayElementInternal;
  windowType: 'main' | 'overlay';
  renderX: number;
  renderY: number;
  keyCount: number;
  arrayIndex: number;
  resizable: boolean;
}

export const calculatePluginAnchorOffset = (
  anchor: ElementResizeAnchor,
  prevSize: { width: number; height: number },
  newSize: { width: number; height: number },
): { dx: number; dy: number } => {
  const dw = newSize.width - prevSize.width;
  const dh = newSize.height - prevSize.height;

  let dx = 0;
  let dy = 0;

  if (anchor.includes('center') && !anchor.startsWith('center')) {
    dx = -dw / 2;
  } else if (anchor === 'center') {
    dx = -dw / 2;
  } else if (anchor.includes('right')) {
    dx = -dw;
  } else if (anchor === 'center-left') {
    dx = 0;
  } else if (anchor === 'center-right') {
    dx = -dw;
  }

  if (anchor.startsWith('center')) {
    dy = -dh / 2;
  } else if (anchor.startsWith('bottom')) {
    dy = -dh;
  }

  return { dx, dy };
};

export const resolvePluginElementPosition = ({
  element,
  positions,
  keyMappings,
  selectedKeyType,
  positionOffset,
}: PluginElementPositionInput): { x: number; y: number } => {
  let baseX = element.position.x;
  let baseY = element.position.y;

  if (element.anchor?.keyCode && positions && selectedKeyType) {
    const modeKeys = keyMappings[selectedKeyType] || [];
    const keyIndex = modeKeys.findIndex(
      (key) => slotCanonical(key) === element.anchor?.keyCode,
    );

    if (keyIndex >= 0 && positions[selectedKeyType]?.[keyIndex]) {
      const keyPosition = positions[selectedKeyType][keyIndex];
      baseX = keyPosition.dx + (element.anchor.offset?.x ?? 0);
      baseY = keyPosition.dy + (element.anchor.offset?.y ?? 0);
    }
  }

  return {
    x: baseX + positionOffset.x,
    y: baseY + positionOffset.y,
  };
};

export const buildPluginElementStyle = ({
  element,
  windowType,
  renderX,
  renderY,
  keyCount,
  arrayIndex,
  resizable,
}: PluginElementStyleInput): CSSProperties => {
  const shouldPromoteTransformLayer = windowType === 'overlay';
  const baseStyle: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transform:
      windowType === 'main'
        ? `translate(${renderX}px, ${renderY}px)`
        : `translate3d(${renderX}px, ${renderY}px, 0)`,
    zIndex: element.zIndex ?? keyCount + arrayIndex,
    cursor: windowType === 'main' ? undefined : 'default',
    willChange: shouldPromoteTransformLayer ? 'transform' : 'auto',
    pointerEvents: windowType === 'main' ? 'auto' : 'none',
  };

  if (resizable) {
    const renderSize = resolveResizablePluginElementSize(element);
    baseStyle.width = renderSize.width;
    baseStyle.height = renderSize.height;
    baseStyle.overflow = 'hidden';
  }

  return { ...baseStyle, ...element.style };
};

export const buildPluginOverlayHitStyle = (
  element: PluginDisplayElementInternal,
  elementStyle: CSSProperties,
  windowType: 'main' | 'overlay',
): CSSProperties | undefined => {
  if (windowType !== 'overlay') return undefined;

  const hitSize = resolveResizablePluginElementSize(element);
  return {
    position: 'absolute',
    left: elementStyle.left,
    top: elementStyle.top,
    right: elementStyle.right,
    bottom: elementStyle.bottom,
    transform: elementStyle.transform,
    transformOrigin: elementStyle.transformOrigin,
    width: hitSize.width,
    height: hitSize.height,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
};
