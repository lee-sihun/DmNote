import type { CSSProperties } from 'react';

interface GridViewportLayerStyles {
  pan: CSSProperties;
  scale: CSSProperties;
}

export const getGridViewportLayerStyles = (
  panX: number,
  panY: number,
  zoom: number,
  isTransforming: boolean,
): GridViewportLayerStyles => ({
  pan: {
    transform: `translate(${panX}px, ${panY}px)`,
    transformOrigin: '0 0',
    willChange: isTransforming ? 'transform' : 'auto',
  },
  scale: {
    transform: zoom === 1 ? 'none' : `scale(${zoom})`,
    transformOrigin: '0 0',
  },
});
