import type { KeyPosition } from '@src/types/key/keys';

// 회전(노브) 요소: KeyPosition 상속(위치/스타일/클래스/이미지) + 축 전용 필드.
// 노트/카운터/폰트 설정은 사용하지 않음.
export type KnobItemPosition = KeyPosition & {
  /** 바인딩된 HID 축 식별자 "HIDA:vid:pid:usagePage:usage" */
  axisId: string;
  /** 회전 배율 (물리 1회전당 화면 회전 수, 기본 1) */
  sensitivity: number;
  /** 회전 방향 반전 */
  reverse: boolean;
};

export type KnobItemPositions = Record<string, KnobItemPosition[]>;
