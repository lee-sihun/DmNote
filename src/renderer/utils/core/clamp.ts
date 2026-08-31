// 범위 고정. max를 나중에 적용하므로 역전 범위(min > max)에서는 max가 이긴다.
// 순서가 계약인 이유는 스프라이트 리사이즈가 백엔드 클램프와 비트 단위로 맞아야 하기 때문이다
// (resizeProjection.ts 참조)
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
