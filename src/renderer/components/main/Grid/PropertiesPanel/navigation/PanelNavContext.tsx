import { createContext, useContext } from 'react';

// 사이드 패널 인-패널 내비게이션 — 탭 콘텐츠가 자기 클로저에서 피커를 렌더하되
// createPortal로 패널 루트의 서브 페이지 호스트에 그려 넣는다
export interface PanelNavState {
  // 애니메이션 상태 기준 — 열림/닫힘 즉시 반영
  activePageKey: string | null;
  // 마운트 기준 — exit 전환이 끝날 때까지 유지 (빈 페이지 슬라이드 방지)
  renderPageKey: string | null;
  openPage: (key: string) => void;
  closePage: () => void;
  // 서브 페이지 포털 타깃 (state로 보관 — 렌더 중 ref 읽기 회피)
  pageHost: HTMLDivElement | null;
}

const PanelNavContext = createContext<PanelNavState | null>(null);

export const PanelNavProvider = PanelNavContext.Provider;

export const usePanelNav = (): PanelNavState => {
  const nav = useContext(PanelNavContext);
  if (!nav) {
    throw new Error('usePanelNav는 PanelNavProvider 내부에서만 사용 가능');
  }
  return nav;
};
