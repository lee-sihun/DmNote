import { createContext, useContext } from 'react';

import type { PanelHostPlacement } from '@stores/grid/usePanelHostStore';

// 프로퍼티 패널 서브트리가 지금 어느 문서에 붙어 있는지.
// 분리 상태에서는 자식 창 문서 - document/window 전역을 직접 잡는 코드는
// (리스너·포털·측정) 이 값을 써야 자식 창에서도 동작한다
export interface PanelHostValue {
  placement: PanelHostPlacement;
  window: Window;
  document: Document;
}

const defaultValue: PanelHostValue = {
  placement: 'docked',
  window:
    typeof window === 'undefined' ? (undefined as unknown as Window) : window,
  document:
    typeof document === 'undefined'
      ? (undefined as unknown as Document)
      : document,
};

export const PanelHostContext = createContext<PanelHostValue>(defaultValue);

export const usePanelHost = (): PanelHostValue => useContext(PanelHostContext);
