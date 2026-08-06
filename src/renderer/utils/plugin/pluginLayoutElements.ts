import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

/**
 * 오버레이 레이아웃(bounds) 계산에 실제로 쓰이는 필드만 투영한 뷰.
 * computeLayout이 이 타입만 입력받으므로, 레이아웃에서 필드를 추가로 읽으려면
 * 이 투영과 pluginLayoutElementsEqual을 함께 수정해야 함 (타입으로 강제)
 */
export interface PluginLayoutElement {
  hidden?: boolean;
  tabId?: string;
  position: { x: number; y: number };
  anchor?: { keyCode: string; offset?: { x: number; y: number } };
  measuredSize?: { width: number; height: number };
  estimatedSize?: { width: number; height: number };
}

interface PluginLayoutElementsSourceState {
  elements: PluginDisplayElementInternal[];
}

// position 생략 요소(anchor 배치 등) 방어 - equality·computeLayout의 필수 계약 유지
const ZERO_POSITION = Object.freeze({ x: 0, y: 0 });

// filter 금지 - computeLayout의 hasContent 판정이 배열 길이를 보므로 길이·순서 보존
// zIndex는 의도적 제외 - computeLayout 미사용, z-order는 PluginElement가 자체 구독으로 처리
export const selectPluginLayoutElements = (
  state: PluginLayoutElementsSourceState,
): PluginLayoutElement[] =>
  state.elements.map((el) => ({
    hidden: el.hidden,
    tabId: el.tabId,
    position: el.position ?? ZERO_POSITION,
    anchor: el.anchor,
    measuredSize: el.measuredSize,
    estimatedSize: el.estimatedSize,
  }));

const sizeEqual = (
  a: { width: number; height: number } | undefined,
  b: { width: number; height: number } | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.width === b.width && a.height === b.height;
};

const anchorEqual = (
  a: PluginLayoutElement['anchor'],
  b: PluginLayoutElement['anchor'],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.keyCode !== b.keyCode) return false;
  const offsetA = a.offset;
  const offsetB = b.offset;
  if (offsetA === offsetB) return true;
  if (!offsetA || !offsetB) return false;
  return offsetA.x === offsetB.x && offsetA.y === offsetB.y;
};

export const pluginLayoutElementsEqual = (
  a: PluginLayoutElement[],
  b: PluginLayoutElement[],
): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const elementA = a[i];
    const elementB = b[i];
    if (elementA.hidden !== elementB.hidden) return false;
    if (elementA.tabId !== elementB.tabId) return false;
    if (
      elementA.position.x !== elementB.position.x ||
      elementA.position.y !== elementB.position.y
    ) {
      return false;
    }
    if (!anchorEqual(elementA.anchor, elementB.anchor)) return false;
    if (!sizeEqual(elementA.measuredSize, elementB.measuredSize)) return false;
    if (!sizeEqual(elementA.estimatedSize, elementB.estimatedSize)) {
      return false;
    }
  }
  return true;
};
