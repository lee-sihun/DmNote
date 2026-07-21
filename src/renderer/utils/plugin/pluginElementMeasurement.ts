interface MeasurableElement {
  isConnected: boolean;
  getBoundingClientRect: () => Pick<DOMRect, 'width' | 'height'>;
}

export interface PluginElementSize {
  width: number;
  height: number;
}

const DEFAULT_RESIZABLE_PLUGIN_SIZE: PluginElementSize = {
  width: 200,
  height: 150,
};

export const resolveResizablePluginElementSize = (element: {
  measuredSize?: PluginElementSize;
  estimatedSize?: PluginElementSize;
}): PluginElementSize =>
  element.measuredSize ??
  element.estimatedSize ??
  DEFAULT_RESIZABLE_PLUGIN_SIZE;

export const measureConnectedPluginElement = (
  element: MeasurableElement,
  zoom: number,
): PluginElementSize | null => {
  if (!element.isConnected || !Number.isFinite(zoom) || zoom <= 0) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const width = Math.ceil(rect.width / zoom);
  const height = Math.ceil(rect.height / zoom);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { width, height };
};
