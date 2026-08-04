const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export const isAvailableFocusTarget = (element: HTMLElement) => {
  if (element.closest('[hidden], [aria-hidden="true"]')) return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;

  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse'
  ) {
    return false;
  }

  // display: none 조상 등 계산 스타일만으로 확인할 수 없는 비렌더링 상태 제외
  return element.getClientRects().length > 0;
};

export const getFocusableElements = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isAvailableFocusTarget,
  );
