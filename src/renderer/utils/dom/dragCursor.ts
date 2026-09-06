/**
 * 드래그 중 전역 커서 고정 - 크로뮴 계열은 포인터 캡처 중에도 커서를
 * 히트테스트로 결정해, window 리스너나 캡처로 잇는 드래그에서 포인터가
 * 시작 요소를 벗어나면 커서가 되돌아온다. 잡는 동안 문서 전체를 지정
 * 커서로 덮고 놓을 때 복원한다 (main.css의 html.dmn-drag-cursor 규칙)
 */

const CLASS_NAME = 'dmn-drag-cursor';
const VAR_NAME = '--dmn-drag-cursor';

export const beginDragCursor = (
  cursor = 'grabbing',
  doc: Document = document,
): void => {
  const root = doc.documentElement;
  root.style.setProperty(VAR_NAME, cursor);
  root.classList.add(CLASS_NAME);
};

export const endDragCursor = (doc: Document = document): void => {
  const root = doc.documentElement;
  root.classList.remove(CLASS_NAME);
  root.style.removeProperty(VAR_NAME);
};
