import React from 'react';
import {
  useGridSelectionStore,
  getMarqueeRect,
} from '@stores/grid/useGridSelectionStore';

interface MarqueeSelectionOverlayProps {
  zoom?: number;
  panX?: number;
  panY?: number;
}

/**
 * 마퀴(드래그) 선택 영역을 표시하는 오버레이 컴포넌트
 */
export const MarqueeSelectionOverlay: React.FC<
  MarqueeSelectionOverlayProps
> = ({ zoom = 1, panX = 0, panY = 0 }) => {
  const isMarqueeSelecting = useGridSelectionStore(
    (state) => state.isMarqueeSelecting,
  );
  const marqueeStart = useGridSelectionStore((state) => state.marqueeStart);
  const marqueeEnd = useGridSelectionStore((state) => state.marqueeEnd);

  if (!isMarqueeSelecting) return null;

  const rect = getMarqueeRect(marqueeStart, marqueeEnd);
  if (!rect) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.left * zoom + panX,
        top: rect.top * zoom + panY,
        width: rect.width * zoom,
        height: rect.height * zoom,
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        border: '1px dashed rgba(59, 130, 246, 0.8)',
        pointerEvents: 'none',
        zIndex: 9998,
      }}
    />
  );
};

export default MarqueeSelectionOverlay;
