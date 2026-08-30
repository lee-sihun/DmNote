/**
 * 탭 드래그 컨텍스트
 * Provider는 tabDrag.tsx가 소유한다. 컴포넌트가 아닌 것만 여기 둔다
 */

import { createContext, useContext } from 'react';

export type TabDragOrientation = 'horizontal' | 'vertical';

/** 행이 아니라 영역 단위 드롭 지점. 목록이 비어 있어도 놓을 자리가 있어야 한다 */
export type TabDragZone = 'bar' | 'overflow' | 'opener';

export interface TabDragValue {
  draggingId: string | null;
  /** 방금 착지한 탭. 자리에 내려앉는 스쿼시를 이 한 번만 돌린다 */
  landedId: string | null;
  /** 잡은 채 그리드 버튼 위에 있는가. 그 버튼이 곧 열릴 자리임을 색으로 알린다 */
  isOverOpener: boolean;
  /** 교체 상대. 드래그 중에는 아무것도 움직이지 않고 자리를 내주는 톤으로만 알린다 */
  swapTargetId: string | null;
  beginDrag: (id: string, event: React.PointerEvent<HTMLElement>) => void;
  registerTarget: (
    id: string,
    orientation: TabDragOrientation,
  ) => (element: HTMLElement | null) => void;
  registerZone: (zone: TabDragZone) => (element: HTMLElement | null) => void;
}

export const TabDragContext = createContext<TabDragValue | null>(null);

export const useTabDrag = () => {
  const value = useContext(TabDragContext);
  if (!value) throw new Error('TabDragProvider 밖에서 useTabDrag를 썼다');
  return value;
};
