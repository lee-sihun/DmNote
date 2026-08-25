/**
 * 카운터 글리프 페인트 박스 측정 - 그라데이션을 스팬 레이아웃 박스가 아니라
 * 실제 글자 잉크 범위에 맞춰 깔기 위한 canvas 기반 측정.
 * 가로는 표시 중인 숫자열의 잉크 범위, 세로는 숫자 세트(0~9) 전체 밴드를
 * 사용해 카운트 자릿수가 바뀌어도 세로 기준이 출렁이지 않는다
 */

export interface CounterGlyphBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CharInkMetrics {
  /** 글리프 advance 폭 (letter-spacing 미포함) */
  advance: number;
  /** 펜 원점 왼쪽으로 뻗은 잉크 (actualBoundingBoxLeft) */
  left: number;
  /** 펜 원점 오른쪽으로 뻗은 잉크 (actualBoundingBoxRight) */
  right: number;
}

// 글자별 잉크 경계를 letter-spacing 반영 advance로 합성한 가로 잉크 범위
export const composeInkSpan = (
  chars: CharInkMetrics[],
  letterSpacing: number,
): { left: number; right: number } | null => {
  if (!chars.length) return null;
  let advance = 0;
  let left = Infinity;
  let right = -Infinity;
  for (const ch of chars) {
    left = Math.min(left, advance - ch.left);
    right = Math.max(right, advance + ch.right);
    advance += ch.advance + letterSpacing;
  }
  return right > left ? { left, right } : null;
};

let sharedCtx: CanvasRenderingContext2D | null | undefined;
const measureCtx = (): CanvasRenderingContext2D | null => {
  if (sharedCtx === undefined) {
    sharedCtx = document.createElement('canvas').getContext('2d');
  }
  return sharedCtx;
};

// 세로 밴드 캐시 - 폰트 서명 단위. 지연 로드된 폰트로 스왑되면 무효화
const digitBandCache = new Map<string, { ascent: number; descent: number }>();
if (typeof document !== 'undefined') {
  document.fonts?.addEventListener?.('loadingdone', () =>
    digitBandCache.clear(),
  );
}

const digitBandFor = (
  ctx: CanvasRenderingContext2D,
  font: string,
): { ascent: number; descent: number } => {
  let band = digitBandCache.get(font);
  if (!band) {
    let ascent = 0;
    let descent = 0;
    for (const digit of '0123456789') {
      const m = ctx.measureText(digit);
      ascent = Math.max(ascent, m.actualBoundingBoxAscent);
      descent = Math.max(descent, m.actualBoundingBoxDescent);
    }
    band = { ascent, descent };
    digitBandCache.set(font, band);
  }
  return band;
};

/**
 * 스팬 내부 좌표(레이아웃 px, 줌 무관)의 글리프 페인트 박스.
 * 측정 불가 환경(canvas 미지원 등)에서는 null - 호출부는 박스 전체 폴백
 */
export const measureCounterGlyphBox = (
  element: HTMLElement,
): CounterGlyphBox | null => {
  const text = element.getAttribute('data-text');
  if (!text) return null;
  const ctx = measureCtx();
  if (!ctx) return null;
  const cs = getComputedStyle(element);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.font = font;
  const probe = ctx.measureText(text);
  const fontAscent = probe.fontBoundingBoxAscent;
  const fontDescent = probe.fontBoundingBoxDescent;
  if (!Number.isFinite(fontAscent) || !Number.isFinite(fontDescent)) {
    return null;
  }
  const band = digitBandFor(ctx, font);
  if (band.ascent + band.descent <= 0) return null;
  const letterSpacing = parseFloat(cs.letterSpacing) || 0;
  const chars: CharInkMetrics[] = [];
  for (const ch of text) {
    const m = ctx.measureText(ch);
    chars.push({
      advance: m.width,
      left: m.actualBoundingBoxLeft,
      right: m.actualBoundingBoxRight,
    });
  }
  const span = composeInkSpan(chars, letterSpacing);
  if (!span) return null;
  // 베이스라인: 라인박스 상하 균등 여백 모델 (half-leading)
  const lineBox = element.offsetHeight;
  const baselineY = (lineBox - (fontAscent + fontDescent)) / 2 + fontAscent;
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  return {
    x: paddingLeft + span.left,
    y: baselineY - band.ascent,
    width: span.right - span.left,
    height: band.ascent + band.descent,
  };
};
