import { usePanelHostStore } from '@stores/grid/usePanelHostStore';
import { getPanelChildWindow } from '@utils/panelWindow/panelChildWindow';

// 분리 패널 창의 Window - 분리 상태일 때만 값이 있다.
// 메인 window에 거는 전역 리스너(단축키 등)를 자식 창에도 같이 걸 때 쓴다
export const usePanelChildWindow = (): Window | null => {
  const detached = usePanelHostStore((state) => state.placement === 'detached');
  return detached ? getPanelChildWindow()?.window ?? null : null;
};
