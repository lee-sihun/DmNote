import type { CustomFont, FontWeightRange } from '@src/types/settings/fonts';
import {
  DEFAULT_FONT_FAMILY,
  normalizeFontFamilyName,
  validateWebFontFaceCss,
} from '@src/types/settings/fonts';

export const FONT_WEIGHT_MIN = 100;
export const FONT_WEIGHT_MAX = 900;
export const FONT_WEIGHT_STEP = 100;
export const FONT_WEIGHT_REGULAR = 400;
export const FONT_BOLD_DELTA = 300;
// CSS font-weight 유효 범위 - 벗어난 값은 선언 자체가 무효화되어 상속값으로 떨어진다
const CSS_FONT_WEIGHT_MIN = 1;
const CSS_FONT_WEIGHT_MAX = 1000;

const FALLBACK_FONT_WEIGHTS = [FONT_WEIGHT_REGULAR] as const;

// 백엔드 editor_ops와 같은 규칙 - Bold 미확정 요소의 굵기를 바꾸기 전에 암묵 Bold를
// 고정한다. 고정하지 않으면 (700, 미확정)이 새로 생겨 재시작 마이그레이션이 레거시
// 700으로 오인하고, 낙관 투영과 저장값이 갈라진다
export const implicitElementFontBold = (fontWeight: unknown): boolean =>
  fontWeight == null || fontWeight === 700;
export const implicitCounterFontBold = (fontWeight: unknown): boolean =>
  fontWeight === 700;

const clampFontWeight = (weight: number): number =>
  Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, Math.round(weight)));

export const resolveEffectiveFontWeight = (
  baseWeight: number,
  bold: boolean,
): number =>
  Math.min(
    CSS_FONT_WEIGHT_MAX,
    Math.max(
      CSS_FONT_WEIGHT_MIN,
      Math.round(baseWeight) + (bold ? FONT_BOLD_DELTA : 0),
    ),
  );

export const expandFontWeightRanges = (
  ranges: readonly FontWeightRange[],
): number[] => {
  const weights = new Set<number>();

  for (const { min, max } of ranges) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) continue;

    if (min === max) {
      // 950·1000 같은 정적 페이스도 표현 가능한 경계값으로 대표
      weights.add(clampFontWeight(min));
      continue;
    }

    let added = false;
    for (
      let weight = FONT_WEIGHT_MIN;
      weight <= FONT_WEIGHT_MAX;
      weight += FONT_WEIGHT_STEP
    ) {
      if (weight >= min && weight <= max) {
        weights.add(weight);
        added = true;
      }
    }
    // 100 단위 값이 하나도 없는 범위(200–250, 950–1000)는 경계값으로 대표
    if (!added) {
      weights.add(clampFontWeight(min));
      weights.add(clampFontWeight(max));
    }
  }

  return Array.from(weights).sort((a, b) => a - b);
};

const getFontRanges = (font: CustomFont): FontWeightRange[] => {
  if (font.weightRanges && font.weightRanges.length > 0) {
    return font.weightRanges;
  }
  if (font.type === 'web' && font.cssContent) {
    const detected = validateWebFontFaceCss(font.cssContent).detectedWeights;
    if (detected.length > 0) return detected;
  }
  return [{ min: 400, max: 400 }];
};

export const getSupportedFontWeights = (
  fontFamily: string | null | undefined,
  fonts: readonly CustomFont[],
): number[] => {
  const normalizedFamily = normalizeFontFamilyName(
    fontFamily || DEFAULT_FONT_FAMILY,
  );
  const ranges = fonts
    .filter((font) => normalizeFontFamilyName(font.name) === normalizedFamily)
    .flatMap(getFontRanges);
  const weights = expandFontWeightRanges(ranges);
  return weights.length === 0 ? [...FALLBACK_FONT_WEIGHTS] : weights;
};

export const getCommonSupportedFontWeights = (
  fontFamilies: readonly (string | null | undefined)[],
  fonts: readonly CustomFont[],
): number[] => {
  const uniqueFamilies = Array.from(
    new Set(
      (fontFamilies.length > 0 ? fontFamilies : [DEFAULT_FONT_FAMILY]).map(
        (family) => normalizeFontFamilyName(family || DEFAULT_FONT_FAMILY),
      ),
    ),
  );
  const [firstFamily, ...remainingFamilies] = uniqueFamilies;
  if (!firstFamily) return [...FALLBACK_FONT_WEIGHTS];

  const common = new Set(getSupportedFontWeights(firstFamily, fonts));
  for (const family of remainingFamilies) {
    const supported = new Set(getSupportedFontWeights(family, fonts));
    for (const weight of common) {
      if (!supported.has(weight)) common.delete(weight);
    }
  }
  return Array.from(common).sort((a, b) => a - b);
};

export const findNearestFontWeight = (
  weight: number,
  supportedWeights: readonly number[],
): number => {
  if (supportedWeights.length === 0) return clampFontWeight(weight);
  const target = clampFontWeight(weight);
  return supportedWeights.reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(candidate - target);
    const nearestDistance = Math.abs(nearest - target);
    return candidateDistance < nearestDistance ||
      (candidateDistance === nearestDistance && candidate > nearest)
      ? candidate
      : nearest;
  });
};

export const resolveSupportedFontWeight = (
  fontFamily: string | null | undefined,
  fonts: readonly CustomFont[],
): number =>
  findNearestFontWeight(
    FONT_WEIGHT_REGULAR,
    getSupportedFontWeights(fontFamily, fonts),
  );
