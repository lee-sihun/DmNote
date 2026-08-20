import { getPanelChildWindow } from '@utils/panelWindow/panelChildWindow';

// 앱의 "지금 포커스된 요소" - 분리 패널 창이 있으면 그쪽 문서까지 본다.
// document.activeElement는 창마다 따로 있고, 자식 창에 포커스가 있으면 메인 것은 body다
export const getActiveElement = (): Element | null => {
  const child = getPanelChildWindow();
  if (child) {
    const active = child.document.activeElement;
    if (active && active !== child.document.body) return active;
  }
  return document.activeElement;
};
