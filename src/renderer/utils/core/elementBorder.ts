import { resolveStatePair, type GradientSpec } from '@src/types/color';

import {
  DEFAULT_ELEMENT_ACTIVE_BORDER,
  DEFAULT_ELEMENT_ACTIVE_BORDER_GRADIENT,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_BORDER_GRADIENT,
  DEFAULT_ELEMENT_BORDER_WIDTH,
} from './elementDefaults';

// 키·통계·그래프·노브가 공유하는 테두리 필드
export interface ElementBorderFields {
  borderColor?: string | null;
  activeBorderColor?: string | null;
  borderGradient?: GradientSpec | null;
  activeBorderGradient?: GradientSpec | null;
  borderWidth?: number | null;
}

export interface ResolvedElementBorder {
  // 대표 단색 - 실보더 색이자 패널 스와치 색
  color: string;
  // 링으로 그릴 spec, 단색 보더면 null
  gradient: GradientSpec | null;
  // 0이면 보더 없음 (페인트는 폭과 무관하게 유지)
  width: number;
  // 사용자 미지정이라 앱 기본값이 들어간 상태
  isDefault: boolean;
}

interface ResolveOptions {
  // 이미지 키처럼 표면 전체를 다른 것이 채울 때 기본 립을 내지 않는다
  suppressDefault?: boolean;
}

const isNonEmpty = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

// 렌더러의 현재 이미지 판정과 같은 규칙 - 활성은 활성 이미지, 없으면 대기 이미지
export const elementShowsImage = (
  fields: { inactiveImage?: string | null; activeImage?: string | null },
  active: boolean,
): boolean =>
  active
    ? isNonEmpty(fields.activeImage) || isNonEmpty(fields.inactiveImage)
    : isNonEmpty(fields.inactiveImage);

// 명시값 우선, 색·형식·두께 모두 미지정이면 앱 기본 립.
// 두께 0은 명시적 무보더, 두께만 지정하면 기본 립을 그 두께로 그린다.
// 페인트는 폭과 독립 - 두께 0이어도 저장된 색·그라데이션은 패널에 남아야 한다
export function resolveElementBorder(
  fields: ElementBorderFields,
  active: boolean,
  options: ResolveOptions = {},
): ResolvedElementBorder {
  const pair = resolveStatePair(
    active,
    { color: fields.borderColor ?? undefined, gradient: fields.borderGradient },
    {
      color: fields.activeBorderColor ?? undefined,
      gradient: fields.activeBorderGradient,
    },
  );
  const explicitPaint = isNonEmpty(pair.color) || pair.gradient != null;
  const widthExplicit = fields.borderWidth != null;
  const width = Math.max(0, fields.borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH);
  const defaultColor = active
    ? DEFAULT_ELEMENT_ACTIVE_BORDER
    : DEFAULT_ELEMENT_BORDER;
  const defaultGradient = active
    ? DEFAULT_ELEMENT_ACTIVE_BORDER_GRADIENT
    : DEFAULT_ELEMENT_BORDER_GRADIENT;

  if (explicitPaint) {
    return {
      color: isNonEmpty(pair.color) ? pair.color : defaultColor,
      gradient: pair.gradient ?? null,
      width,
      isDefault: false,
    };
  }
  if (width <= 0 || (options.suppressDefault && !widthExplicit)) {
    return { color: defaultColor, gradient: null, width: 0, isDefault: true };
  }
  return {
    color: defaultColor,
    gradient: defaultGradient,
    width,
    isDefault: true,
  };
}
