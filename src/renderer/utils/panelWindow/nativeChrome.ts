// 분리 창의 네이티브 가장자리 색 - 리사이즈 중 웹 페인트가 아직 닿지 못한 구간을
// UI 프로세스가 같은 색으로 그리게 한다. 색 자체는 CSS 토큰이 단일 출처라
// 여기서 계산값을 읽어 백엔드로 넘긴다 (Rust에 리터럴을 박으면 램프 재조정 때 드리프트)

// sRGB 0~1
export type NativeChromeColor = [number, number, number, number];

const CSS_COLOR_PATTERN = /^rgba?\(([^)]+)\)$/;

// 토큰이 없거나 색으로 해석되지 않을 때 계산값에 남는 표식.
// color는 상속 속성이라 이 장치가 없으면 실패가 본문 글자색(밝은 회색)으로
// 조용히 대체되어, 창 전체가 흰 면으로 칠해진다
const SENTINEL_CSS = 'rgb(1, 2, 3)';
const SENTINEL: NativeChromeColor = [1 / 255, 2 / 255, 3 / 255, 1];

export const parseComputedColor = (value: string): NativeChromeColor | null => {
  const matched = CSS_COLOR_PATTERN.exec(value.trim());
  if (!matched) return null;
  const parts = matched[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3) return null;
  const [red, green, blue, alpha] = parts;
  if (![red, green, blue].every(Number.isFinite)) return null;
  return [
    red / 255,
    green / 255,
    blue / 255,
    Number.isFinite(alpha) ? alpha : 1,
  ];
};

export const isSentinelColor = (color: NativeChromeColor): boolean =>
  color.every((component, index) => component === SENTINEL[index]);

// var()는 선언된 문자열 그대로라 계산색이 필요 - 프로브에 물려 브라우저가 정규화하게 한다.
// 표식을 상속시켜, 토큰 부재와 해석 실패를 모두 null로 떨어뜨린다
export const readTokenColor = (token: string): NativeChromeColor | null => {
  const host = document.createElement('span');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
  host.style.color = SENTINEL_CSS;

  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  host.appendChild(probe);

  // body에 붙이면 :nth-child 매칭과 body MutationObserver를 흔든다
  document.documentElement.appendChild(host);
  const computed = getComputedStyle(probe).color;
  host.remove();

  const parsed = parseComputedColor(computed);
  if (!parsed || isSentinelColor(parsed)) return null;
  return parsed;
};
