import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

interface PluginRenderListSourceState {
  elements: PluginDisplayElementInternal[];
}

/**
 * 현재 탭에 표시할 플러그인 요소의 fullId 목록 투영.
 * 리스트 렌더러는 이 목록만 구독하므로 요소의 state/html 갱신이
 * 리스트 전체 재조정으로 번지지 않는다.
 *
 * 정렬 금지 - 배열 순서가 DOM 순서와 z-order 폴백
 * (zIndex ?? keyCount + arrayIndex)을 결정하므로 스토어 순서를 그대로 보존해야 함
 */
export const selectPluginRenderList = (
  state: PluginRenderListSourceState,
  selectedKeyType: string,
): string[] => {
  const ids: string[] = [];
  for (const element of state.elements) {
    if (element.hidden) continue;
    // tabId 없는 레거시 요소는 모든 탭에 표시 (하위 호환성)
    if (element.tabId && element.tabId !== selectedKeyType) continue;
    ids.push(element.fullId);
  }
  return ids;
};

export const pluginRenderListEqual = (a: string[], b: string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};
