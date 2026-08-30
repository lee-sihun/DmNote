/**
 * 탭 이름 변경·삭제 창구의 계약
 * Provider는 tabActions.tsx가 소유한다 - 컴포넌트와 훅을 한 파일에 두면
 * fast refresh가 파일 전체를 다시 마운트한다 (tabDragContext와 같은 이유)
 */

import { createContext, useContext } from 'react';

export interface TabTarget {
  id: string;
  name: string;
}

export interface TabActions {
  requestRename: (target: TabTarget) => void;
  requestDelete: (target: TabTarget) => void;
}

export const TabActionsContext = createContext<TabActions | null>(null);

export const useTabActions = (): TabActions => {
  const actions = useContext(TabActionsContext);
  if (!actions) throw new Error('TabActionsProvider 없이 호출됨');
  return actions;
};
