// realm-safe 노드 판정. 분리 패널 창의 노드는 다른 realm에서 만들어져
// 메인 창의 `instanceof Element/HTMLElement`가 false다 - nodeType으로 본다
export const isNodeLike = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Node).nodeType === 'number';

export const isElementNode = (value: unknown): value is Element =>
  isNodeLike(value) && value.nodeType === Node.ELEMENT_NODE;

// HTMLElement 여부 - 요소이면서 style/focus 같은 HTML 인터페이스를 가진 것
export const isHTMLElementNode = (value: unknown): value is HTMLElement =>
  isElementNode(value) &&
  typeof (value as HTMLElement).focus === 'function' &&
  (value as HTMLElement).style !== undefined;
