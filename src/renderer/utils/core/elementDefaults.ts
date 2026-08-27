import type { GradientSpec } from '@src/types/color';
import {
  elementShadowToCss,
  type ElementShadowSpec,
} from '@src/types/key/shadows';

/**
 * 기본 제공 요소(키·노브·그래프·통계)의 기본 팔레트 단일 소스
 * 표면 분리는 1px 헤어라인, 깊이는 외부 섀도가 담당
 * global.css의 [data-key-element] 기본 규칙과 값 동기 유지
 *
 * tokens.css의 --ui-* 와는 의도적으로 분리돼 있다. 여기 값은 store에 저장되는
 * 유저 데이터의 기본값이라 앱 크롬 팔레트를 따라 움직이면 기존 사용자의
 * 저장된 요소 색이 바뀐다. 아래 값들은 앱 크롬이 근흑이던 시절의 --ui-glass /
 * --ui-fg 값에서 유래했지만 지금은 별개 계보다. 재동조 금지
 */

export const DEFAULT_ELEMENT_BG = 'rgba(14, 14, 17, 0.72)';
export const DEFAULT_ELEMENT_ACTIVE_BG = 'rgba(255, 255, 255, 0.88)';
export const DEFAULT_ELEMENT_FONT = 'rgba(237, 238, 242, 0.78)';
export const DEFAULT_ELEMENT_ACTIVE_FONT = 'rgba(20, 20, 24, 0.9)';

// 기본 보더 - 1px 글래스 립. 170°는 빛이 왼쪽 위에서 드는 방향이라 밝은 립이
// 위 변 왼쪽에 조금 더 걸리고 오른쪽 아래로 잦아든다. 끝 스톱을 80%에 두어
// 아래 1/4은 균일하게 남기고 하단 모서리가 비어 보이지 않게 한다.
// 테두리 색·형식·두께 UI로 그대로 수정 가능, 대표 단색은 첫 스톱 (형제 필드 규칙)
export const DEFAULT_ELEMENT_BORDER_GRADIENT: GradientSpec = {
  angle: 170,
  stops: [
    { color: 'rgba(255, 255, 255, 0.14)', pos: 0 },
    { color: 'rgba(255, 255, 255, 0.04)', pos: 0.8 },
  ],
};
// 활성은 흰 배경 위라 립이 자연히 잠긴다. 같은 spec을 써서 눌림 시 링 두께가 안 바뀌게
export const DEFAULT_ELEMENT_ACTIVE_BORDER_GRADIENT: GradientSpec =
  DEFAULT_ELEMENT_BORDER_GRADIENT;
export const DEFAULT_ELEMENT_BORDER =
  DEFAULT_ELEMENT_BORDER_GRADIENT.stops[0].color;
export const DEFAULT_ELEMENT_ACTIVE_BORDER = DEFAULT_ELEMENT_BORDER;
export const DEFAULT_ELEMENT_BORDER_WIDTH = 1;

export const DEFAULT_ELEMENT_RADIUS = 4;
export const DEFAULT_ELEMENT_BASE_FONT_WEIGHT = 400;
export const DEFAULT_ELEMENT_FONT_BOLD = true;

// 카운터 타이포 — 자간(0.06em)은 global.css .counter가 소유
// 색은 키 텍스트와 동일 (백엔드 KeyCounterColor::default와 동기 유지)
export const DEFAULT_COUNTER_FONT_SIZE = 11;
export const DEFAULT_COUNTER_FONT_WEIGHT = 500;

// 키 표면 섀도 — 보더가 분리를 담당하므로 양쪽 모두 외부 깊이만 표현
// 활성 inset은 투명 보더에서도 밝은 테두리처럼 보여 사용 금지
export const DEFAULT_ELEMENT_SHADOW_SPEC: ElementShadowSpec = {
  enabled: true,
  color: 'rgba(0, 0, 0, 0.28)',
  offsetX: 0,
  offsetY: 4,
  blur: 10,
};

export const DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC: ElementShadowSpec = {
  enabled: true,
  color: 'rgba(0, 0, 0, 0.32)',
  offsetX: 0,
  offsetY: 3,
  blur: 8,
};

export const DEFAULT_ELEMENT_SHADOW = elementShadowToCss(
  DEFAULT_ELEMENT_SHADOW_SPEC,
);
export const DEFAULT_ELEMENT_ACTIVE_SHADOW = elementShadowToCss(
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
);
