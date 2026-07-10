/**
 * Lenis smooth scroll 전역 설정
 * 모든 컴포넌트에서 일관된 스크롤 경험을 위해 사용
 */
export const LENIS_CONFIG = {
  /** 목표점 추적 강도 (0~1) — duration 방식과 달리 꼬리 구간 서브픽셀 계단이 없음 */
  // 높을수록 즉각적, 낮을수록 관성이 큼
  lerp: 0.14,
  /** 휠 스크롤 속도 multiplier */
  // 낮을수록 느리게 스크롤
  wheelMultiplier: 0.9,
} as const;

export type LenisConfig = typeof LENIS_CONFIG;
