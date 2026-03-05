export interface ScrollShadowState {
  hasTopShadow: boolean;
  hasBottomShadow: boolean;
}

const OVERFLOW_EPS = 0.5; // 스크롤 오버플로우 감지용 오차
const CLIP_EPS = 1; // 경계에서 실제로 잘리는지 판단할 때 사용할 오차
const OVERLAP_EPS = 0.5; // 요소가 뷰포트와 겹친다고 간주할 최소 오차
const EDGE_EPS = 1; // 스크롤 상/하단 근접 판정 오차

/**
 * Calculate whether scroll shadows should be shown based on whether
 * any child element is currently clipped at the top or bottom edge
 * of the scroll container. If there are no child elements, it falls
 * back to the traditional scroll position checks.
 */
export function getScrollShadowState(
  container: HTMLElement | null,
  _content?: HTMLElement | null,
): ScrollShadowState {
  if (!container) {
    return { hasTopShadow: false, hasBottomShadow: false };
  }

  const hasOverflow =
    container.scrollHeight - container.clientHeight > OVERFLOW_EPS;
  if (!hasOverflow) {
    return { hasTopShadow: false, hasBottomShadow: false };
  }

  const containerRect = container.getBoundingClientRect();

  // 샘플 지점(컨테이너 내부) 계산
  const sampleX =
    containerRect.left +
    Math.min(Math.max(containerRect.width / 2, 2), containerRect.width - 2);
  const sampleTopY = Math.min(containerRect.bottom - 2, containerRect.top + 2);
  const sampleBottomY = Math.max(
    containerRect.top + 2,
    containerRect.bottom - 2,
  );

  const findElementAt = (y: number): HTMLElement | null => {
    if (y < containerRect.top || y > containerRect.bottom) return null;
    const hit = document.elementFromPoint(sampleX, y) as HTMLElement | null;
    if (!hit) return null;

    let node: HTMLElement | null = hit;
    while (node && node !== container && !container.contains(node)) {
      node = node.parentElement;
    }

    if (!node || node === document.documentElement || node === document.body) {
      return null;
    }

    return node;
  };

  const topTarget = findElementAt(sampleTopY);
  const bottomTarget = findElementAt(sampleBottomY);

  const hasTopShadow =
    !!topTarget &&
    (() => {
      const rect = topTarget.getBoundingClientRect();
      const overlaps =
        rect.bottom > containerRect.top + OVERLAP_EPS &&
        rect.top < containerRect.bottom - OVERLAP_EPS;
      const clipped = rect.top < containerRect.top - CLIP_EPS;
      const awayFromTop = container.scrollTop > EDGE_EPS;
      return overlaps && clipped && awayFromTop;
    })();

  const hasBottomShadow =
    !!bottomTarget &&
    (() => {
      const rect = bottomTarget.getBoundingClientRect();
      const overlaps =
        rect.top < containerRect.bottom - OVERLAP_EPS &&
        rect.bottom > containerRect.top + OVERLAP_EPS;
      const clipped = rect.bottom > containerRect.bottom + CLIP_EPS;
      const awayFromBottom =
        container.scrollTop <
        container.scrollHeight - container.clientHeight - EDGE_EPS;
      return overlaps && clipped && awayFromBottom;
    })();

  return { hasTopShadow, hasBottomShadow };
}
