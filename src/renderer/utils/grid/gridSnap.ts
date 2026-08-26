// 그리드 배수로 반올림, 크기 0 이하는 스냅 끄기
export const roundToGrid = (value: number, gridSize: number): number =>
  gridSize > 0 ? Math.round(value / gridSize) * gridSize : value;
