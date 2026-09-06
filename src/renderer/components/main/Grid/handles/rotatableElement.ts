// 공통 스타일 속성으로 회전하는 종류. 스프라이트는 전용 필드 patch 사용
export type RotatableElementType = 'key' | 'stat' | 'graph' | 'knob';

export const isRotatableElementType = (
  type: string,
): type is RotatableElementType =>
  type === 'key' || type === 'stat' || type === 'graph' || type === 'knob';
