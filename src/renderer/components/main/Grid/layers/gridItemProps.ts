import type React from 'react';

import type { GridItemSelectedElement } from '@hooks/Grid/useGridItemInteraction';

/**
 * 캔버스 잎 컴포넌트의 공통 props. 요소 데이터 타입만 다르고 상호작용 계약은 같다 -
 * 그리드가 종류별 렌더를 하나의 함수로 접을 수 있는 근거
 */
export interface GridItemProps<TPosition> {
  index: number;
  elementId: string;
  position: TPosition;
  onPositionChange: (
    index: number,
    dx: number,
    dy: number,
    elementId: string,
  ) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onCtrlClick?: (e: React.MouseEvent) => void;
  onShiftClick?: (e: React.MouseEvent) => void;
  isSelected?: boolean;
  selectedElements?: GridItemSelectedElement[];
  onMultiDrag?: (dx: number, dy: number) => void;
  onMultiDragStart?: () => void | (() => void);
  onMultiDragEnd?: () => void;
  activeTool?: string;
  onEraserClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  setReferenceRef?: (node: HTMLElement | null) => void;
  zoom?: number;
  panX?: number;
  panY?: number;
  zIndex?: number;
  isViewportTransforming?: boolean;
}
