/**
 * 기본 제공 요소(키·노브·그래프·통계)의 기본 팔레트 단일 소스
 * 보더 없는 글래스 표면 — 분리는 인셋 링 + 상단 하이라이트 섀도가 담당
 * 색감은 tokens.css의 무채색 스모크 계열(--ui-glass, --ui-fg)과 동조
 * global.css의 [data-key-element] 기본 규칙과 값 동기 유지
 */

export const DEFAULT_ELEMENT_BG = 'rgba(14, 14, 17, 0.72)';
export const DEFAULT_ELEMENT_ACTIVE_BG = 'rgba(255, 255, 255, 0.88)';
export const DEFAULT_ELEMENT_FONT = 'rgba(237, 238, 242, 0.78)';
export const DEFAULT_ELEMENT_ACTIVE_FONT = 'rgba(20, 20, 24, 0.9)';

// 기본 상태는 보더 없음 — 사용자가 보더를 켤 때의 색 폴백
export const DEFAULT_ELEMENT_BORDER = 'rgba(113, 113, 113, 0.9)';
export const DEFAULT_ELEMENT_ACTIVE_BORDER = 'rgba(255, 255, 255, 0.9)';

// 그래프 등 실보더 요소가 인셋 링을 흉내낼 때 쓰는 헤어라인 색
export const DEFAULT_ELEMENT_HAIRLINE = 'rgba(255, 255, 255, 0.07)';

export const DEFAULT_ELEMENT_RADIUS = 4;
export const DEFAULT_ELEMENT_FONT_WEIGHT = 700;

// 카운터 타이포 — 자간(0.06em)은 global.css .counter가 소유
// 색은 키 텍스트와 동일 (백엔드 KeyCounterColor::default와 동기 유지)
export const DEFAULT_COUNTER_FONT_SIZE = 11;
export const DEFAULT_COUNTER_FONT_WEIGHT = 500;

// 비활성: 인셋 링 + 상단 하이라이트 + 소프트 드롭 / 활성: 눌림 인셋
export const DEFAULT_ELEMENT_SHADOW =
  'inset 0 0 0 1px rgba(255, 255, 255, 0.07), inset 0 1px 0 0 rgba(255, 255, 255, 0.1), 0 4px 10px rgba(0, 0, 0, 0.28)';
export const DEFAULT_ELEMENT_ACTIVE_SHADOW =
  '0 3px 8px rgba(0, 0, 0, 0.32), inset 0 1px 2px rgba(255, 255, 255, 0.5), inset 0 -1px 3px rgba(0, 0, 0, 0.12)';
