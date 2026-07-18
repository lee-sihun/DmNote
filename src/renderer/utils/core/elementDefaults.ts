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

// 기본 보더 — 1px 헤어라인이 표면 분리 담당, 테두리 색상/두께 UI로 그대로 수정 가능
// 무보더 글래스 프리셋 느낌을 위해 존재감 최소 수준, 활성은 흰 배경 위라 자연히 사라짐
export const DEFAULT_ELEMENT_BORDER = 'rgba(255, 255, 255, 0.04)';
export const DEFAULT_ELEMENT_ACTIVE_BORDER = 'rgba(255, 255, 255, 0.04)';
export const DEFAULT_ELEMENT_BORDER_WIDTH = 1;

// 그래프 등 다른 요소가 같은 헤어라인을 쓸 때의 별칭
export const DEFAULT_ELEMENT_HAIRLINE = DEFAULT_ELEMENT_BORDER;

export const DEFAULT_ELEMENT_RADIUS = 4;
export const DEFAULT_ELEMENT_FONT_WEIGHT = 700;

// 카운터 타이포 — 자간(0.06em)은 global.css .counter가 소유
// 색은 키 텍스트와 동일 (백엔드 KeyCounterColor::default와 동기 유지)
export const DEFAULT_COUNTER_FONT_SIZE = 11;
export const DEFAULT_COUNTER_FONT_WEIGHT = 500;

// 키 표면 섀도 — 보더가 분리를 담당하므로 비활성은 소프트 드롭만 / 활성은 눌림 인셋
export const DEFAULT_ELEMENT_SHADOW = '0 4px 10px rgba(0, 0, 0, 0.28)';
export const DEFAULT_ELEMENT_ACTIVE_SHADOW =
  '0 3px 8px rgba(0, 0, 0, 0.32), inset 0 1px 2px rgba(255, 255, 255, 0.5), inset 0 -1px 3px rgba(0, 0, 0, 0.12)';
