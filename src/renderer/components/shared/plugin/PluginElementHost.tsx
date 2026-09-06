import React from 'react';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { PluginElement } from './PluginElement';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';

interface PluginElementHostProps {
  fullId: string;
  windowType: 'main' | 'overlay';
  activeTool?: string;
  positionOffset?: { x: number; y: number };
  zoom?: number;
  panX?: number;
  panY?: number;
  isViewportTransforming?: boolean;
  arrayIndex?: number;
  keyCount?: number;
  isSelected?: boolean;
  selectedElements?: SelectedElement[];
  onSelectionContextMenu?: (payload: {
    elementId: string;
    clientX: number;
    clientY: number;
    referenceElement: HTMLDivElement | null;
  }) => boolean;
  onMultiDrag?: (deltaX: number, deltaY: number) => void;
  onMultiDragStart?: () => void | (() => void);
  onMultiDragEnd?: () => void;
}

/**
 * fullId로 자기 요소 하나만 구독하는 얇은 래퍼.
 * 리스트 렌더러가 elements 배열 전체를 구독하지 않아도 되게 하며,
 * 다른 요소의 갱신은 이 컴포넌트를 리렌더하지 않는다
 * (updateElement가 미변경 요소의 참조를 보존하므로 Object.is 비교로 차단됨)
 */
const PluginElementHost = ({ fullId, ...rest }: PluginElementHostProps) => {
  const element = usePluginDisplayElementStore((state) =>
    state.elements.find((el) => el.fullId === fullId),
  );

  // 제거 직후 렌더 목록 갱신 전의 과도기 방어
  if (!element) return null;

  return <PluginElement element={element} {...rest} />;
};

export default PluginElementHost;
