import { gradientToCss, type GradientSpec } from '@src/types/color';
import { toCssRgba } from '@utils/color/colorUtils';

interface CounterPaintInput {
  fillColor?: string;
  fillGradient?: GradientSpec | null;
  strokeColor?: string;
  strokeGradient?: GradientSpec | null;
}

/**
 * 카운터 fill·stroke 페인트 CSS 변수 산출 - CountDisplay와 에디터 프리뷰
 * 레이어가 공유한다. 실제 속성 적용은 global.css의 fallback 체인이 담당하고,
 * 사용자 --counter-color / --counter-stroke-color가 항상 앱 그라데이션보다 우선
 */
export const counterPaintVars = ({
  fillColor,
  fillGradient,
  strokeColor,
  strokeGradient,
}: CounterPaintInput): Record<string, string> => {
  const fill = toCssRgba(fillColor, '#FFFFFF');
  const stroke = toCssRgba(strokeColor, 'transparent');
  // 대표색 알파가 0이어도 그라데이션 스톱은 보일 수 있다
  const strokeVisible = Boolean(strokeGradient) || stroke.alpha > 0;
  return {
    '--counter-color-default': fill.css,
    '--counter-stroke-color-default': stroke.css,
    '--counter-stroke-width-default': strokeVisible ? '1px' : '0px',
    '--dmn-counter-fill-image-default': fillGradient
      ? gradientToCss(fillGradient)
      : 'none',
    '--dmn-counter-fill-clip-default': fillGradient ? 'text' : 'border-box',
    '--dmn-counter-text-fill-default': fillGradient
      ? 'transparent'
      : 'currentcolor',
    // 그라데이션 stroke는 ::before의 배경 클립이 칠하므로 stroke 색은 투명 처리
    '--dmn-counter-stroke-image-default': strokeGradient
      ? gradientToCss(strokeGradient)
      : 'none',
    '--dmn-counter-stroke-clip-default': strokeGradient ? 'text' : 'border-box',
    '--dmn-counter-stroke-paint-default': strokeGradient
      ? 'transparent'
      : stroke.css,
  };
};
