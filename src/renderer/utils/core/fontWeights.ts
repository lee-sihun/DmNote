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

const FALLBACK_FONT_WEIGHTS = [FONT_WEIGHT_REGULAR] as const;

const clampFontWeight = (weight: number): number =>
  Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, Math.round(weight)));

export const resolveEffectiveFontWeight = (
  baseWeight: number,
  bold: boolean,
): number => Math.round(baseWeight) + (bold ? FONT_BOLD_DELTA : 0);

export const expandFontWeightRanges = (
  ranges: readonly FontWeightRange[],
): number[] => {
  const weights = new Set<number>();

  for (const { min, max } of ranges) {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) continue;

    if (min === max) {
      if (min >= FONT_WEIGHT_MIN && min <= FONT_WEIGHT_MAX) {
        weights.add(Math.round(min));
      }
      continue;
    }

    for (
      let weight = FONT_WEIGHT_MIN;
      weight <= FONT_WEIGHT_MAX;
      weight += FONT_WEIGHT_STEP
    ) {
      if (weight >= min && weight <= max) weights.add(weight);
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
  if (ranges.length === 0) return [...FALLBACK_FONT_WEIGHTS];
  const weights = expandFontWeightRanges(ranges);
  return weights;
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
