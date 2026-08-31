// 범위 고정. max를 먼저 적용해 역전 범위(min > max)에서는 min이 이긴다 -
// 백엔드 클램프도 같은 순서라 스프라이트 수치 미러가 비트 단위로 일치한다
export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
