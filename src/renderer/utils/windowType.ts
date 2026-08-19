/**
 * 현재 렌더러가 어떤 창에서 도는지 판정
 * 인라인 __dmn_window_type 비교가 흩어지지 않게 여기로 모은다
 */

export const isPanelWindow = (): boolean =>
  window.__dmn_window_type === 'panel';

export const isMainWindow = (): boolean => window.__dmn_window_type === 'main';
