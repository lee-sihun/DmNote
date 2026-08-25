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
    sharedCtx = document
      .createElement('canvas')
      .getContext('2d', { willReadFrequently: true });
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

// grapheme 단위 분해 - letter-spacing이 글자 단위로 붙는 렌더와 일치
type GraphemeSegmenter = {
  segment: (text: string) => Iterable<{ segment: string }>;
};

const graphemesOf = (text: string): string[] => {
  const SegmenterCtor = (
    Intl as unknown as {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: 'grapheme' },
      ) => GraphemeSegmenter;
    }
  ).Segmenter;
  if (SegmenterCtor) {
    const segmenter = new SegmenterCtor(undefined, {
      granularity: 'grapheme',
    });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
};

// 텍스트가 여러 줄로 배치됐는지 - flex item rect는 1개일 수 있어 Range로 판정
const isMultiLineText = (element: HTMLElement): boolean => {
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  let lines = 0;
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.height > 0 && rect.width > 0) lines += 1;
    if (lines > 1) return true;
  }
  return false;
};

// 잉크 픽셀 스캔 - 알파가 있는 픽셀의 경계 (스캔 픽셀 좌표)
export const scanAlphaBounds = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width; x++) {
      if (data[(rowStart + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
};

// 래스터 측정 배율과 여유 - TextMetrics의 외곽선 근사는 실제 래스터보다
// 작게 나와 가장자리가 잘린다. 실제로 그려 픽셀 범위를 읽고, DOM 렌더와의
// 서브픽셀·스무딩 편차는 1px 여유로 흡수한다
const INK_SCAN_SCALE = 2;
const INK_BLEED_PX = 1;
const INK_SCAN_LIMIT = 8192;

interface RasterInk {
  /** 펜 원점 기준 왼쪽 잉크 시작 (음수 = 원점 왼쪽 오버행) */
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

const rasterInkBounds = (
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  fontSize: number,
  fontAscent: number,
  fontDescent: number,
  letterSpacing: number,
): RasterInk | null => {
  const graphemes = letterSpacing === 0 ? null : graphemesOf(text);
  const advance = graphemes
    ? graphemes.reduce(
        (sum, grapheme) => sum + ctx.measureText(grapheme).width,
        letterSpacing * graphemes.length,
      )
    : ctx.measureText(text).width;
  // 원점 여백 - 사이드 베어링·오버행이 원점 밖으로 뻗을 공간
  const margin = Math.ceil(fontSize);
  const scanW = Math.ceil((advance + margin * 2) * INK_SCAN_SCALE);
  const scanH = Math.ceil(
    (fontAscent + fontDescent + margin * 2) * INK_SCAN_SCALE,
  );
  if (
    scanW <= 0 ||
    scanH <= 0 ||
    scanW > INK_SCAN_LIMIT ||
    scanH > INK_SCAN_LIMIT
  ) {
    return null;
  }
  const canvas = ctx.canvas;
  // 확장만 - 호출마다 버퍼 재할당이 반복되지 않게
  if (canvas.width < scanW) canvas.width = scanW;
  if (canvas.height < scanH) canvas.height = scanH;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(INK_SCAN_SCALE, 0, 0, INK_SCAN_SCALE, 0, 0);
  // 리사이즈가 컨텍스트 상태를 초기화하므로 폰트 재설정
  ctx.font = font;
  ctx.fillStyle = '#ffffff';
  const baseline = margin + fontAscent;
  if (graphemes) {
    // letter-spacing은 grapheme 단위 렌더와 일치하게 글자별로 그린다
    let penX = margin;
    for (const grapheme of graphemes) {
      ctx.fillText(grapheme, penX, baseline);
      penX += ctx.measureText(grapheme).width + letterSpacing;
    }
  } else {
    ctx.fillText(text, margin, baseline);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const bounds = scanAlphaBounds(
    ctx.getImageData(0, 0, scanW, scanH).data,
    scanW,
    scanH,
  );
  if (!bounds) return null;
  return {
    left: bounds.minX / INK_SCAN_SCALE - margin,
    right: (bounds.maxX + 1) / INK_SCAN_SCALE - margin,
    ascent: baseline - bounds.minY / INK_SCAN_SCALE,
    descent: (bounds.maxY + 1) / INK_SCAN_SCALE - baseline,
  };
};

/**
 * 라벨용 글리프 페인트 박스 - 문자열을 실제로 그려 픽셀 잉크 범위를 읽는다.
 * TextMetrics 근사와 달리 래스터 기준이라 가로세로 모두 글자에 밀착하면서
 * 가장자리가 잘리지 않는다. letter-spacing이 없으면 통짜로 그려 커닝·리거처를
 * 보존하고, 있으면 grapheme 단위로 그린다. 측정 문자열과 실제 렌더가
 * 갈라지는 조건(여러 줄, text-transform, RTL, 정렬·들여쓰기 커스텀)은
 * null - 호출부는 줄 박스 전체 폴백
 */
export const measureLabelGlyphBox = (
  element: HTMLElement,
  text: string,
): CounterGlyphBox | null => {
  if (!text.trim()) return null;
  const ctx = measureCtx();
  if (!ctx) return null;
  const cs = getComputedStyle(element);
  if (
    cs.textTransform !== 'none' ||
    cs.direction !== 'ltr' ||
    cs.writingMode !== 'horizontal-tb' ||
    (cs.textIndent !== '0px' && cs.textIndent !== '') ||
    !['start', 'left', ''].includes(cs.textAlign)
  ) {
    return null;
  }
  if (isMultiLineText(element)) return null;
  const fontSize = parseFloat(cs.fontSize) || 0;
  if (fontSize <= 0) return null;
  const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  ctx.font = font;
  const probe = ctx.measureText(text);
  const fontAscent = probe.fontBoundingBoxAscent;
  const fontDescent = probe.fontBoundingBoxDescent;
  if (!Number.isFinite(fontAscent) || !Number.isFinite(fontDescent)) {
    return null;
  }
  const letterSpacing = parseFloat(cs.letterSpacing) || 0;
  const ink = rasterInkBounds(
    ctx,
    text,
    font,
    fontSize,
    fontAscent,
    fontDescent,
    letterSpacing,
  );
  if (!ink) return null;
  // 베이스라인: 라인박스 상하 균등 여백 모델 (half-leading)
  const lineBox = element.offsetHeight;
  const baselineY = (lineBox - (fontAscent + fontDescent)) / 2 + fontAscent;
  const paddingLeft = parseFloat(cs.paddingLeft) || 0;
  return {
    x: paddingLeft + ink.left - INK_BLEED_PX,
    y: baselineY - ink.ascent - INK_BLEED_PX,
    width: ink.right - ink.left + INK_BLEED_PX * 2,
    height: ink.ascent + ink.descent + INK_BLEED_PX * 2,
  };
};
