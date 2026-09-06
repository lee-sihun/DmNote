// computed width·height를 소수점 그대로 border-box 크기로 읽는다. offsetWidth는 정수
// 반올림이라 회전 상자의 꼭짓점 복원에 쓰면 가장자리가 잘린다. 값이 없는 축은 offset 크기
export const borderBoxSize = (
  element: HTMLElement,
  style: CSSStyleDeclaration,
): { width: number; height: number } => {
  const axis = (name: 'width' | 'height'): number => {
    const size = Number.parseFloat(style[name]);
    if (!Number.isFinite(size)) {
      return name === 'width' ? element.offsetWidth : element.offsetHeight;
    }
    if (style.boxSizing === 'border-box') return size;
    const sides = name === 'width' ? ['left', 'right'] : ['top', 'bottom'];
    return sides.reduce(
      (total, side) =>
        total +
        (Number.parseFloat(style.getPropertyValue(`padding-${side}`)) || 0) +
        (Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) ||
          0),
      size,
    );
  };
  return { width: axis('width'), height: axis('height') };
};
