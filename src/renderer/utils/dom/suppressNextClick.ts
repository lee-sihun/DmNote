// 드래그 제스처 뒤에 따라오는 click 1회를 삼킨다. 캔버스 핸들의 pointerup 이후
// click이 그리드 선택 해제로 새는 것을 막는 용도.
// click이 아예 오지 않는 경로(cancel 등) 대비로 다음 틱에 스스로 정리한다
export const suppressNextClick = (): void => {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
};
