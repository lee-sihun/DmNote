/**
 * Key/StatItem 공통 스타일 계산 훅
 * 오버레이에서 키/통계 요소의 스타일을 일관되게 계산
 */

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { resolveImageSource } from '@utils/core/imageSource';
import {
  gradientToCss,
  gradientRingStyle,
  resolveStatePair,
  type GradientSpec,
} from '@src/types/color';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_BORDER,
  DEFAULT_ELEMENT_ACTIVE_BORDER,
  DEFAULT_ELEMENT_BORDER_WIDTH,
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_FONT_WEIGHT,
} from '@utils/core/elementDefaults';

/**
 * 색 형식(그라데이션 유무) 전환 커밋은 background 트랜지션을 한 프레임 차단 —
 * 이미지 레이어는 즉시 교체되는데 base 색만 100ms 보간되며 생기는
 * 이중 합성 깜빡임 방지. 다음 프레임에 attribute를 걷어 원래 트랜지션 복원
 */
export function useBgFormatTransitionGate(
  ref: RefObject<HTMLElement | null>,
  hasGradient: boolean,
) {
  const prevRef = useRef(hasGradient);
  useLayoutEffect(() => {
    const flipped = prevRef.current !== hasGradient;
    prevRef.current = hasGradient;
    const el = ref.current;
    if (!flipped || !el) return undefined;
    el.setAttribute('data-bg-format-flip', 'true');
    // 강제 recalc — rAF 콜백이 첫 style recalc보다 앞서 걷어내도 게이트가 반영되게
    void el.offsetWidth;
    // 이중 rAF — 첫 페인트를 지나고 나서 제거 (다른 effect의 스타일 변경 대비)
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        el.removeAttribute('data-bg-format-flip');
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      el.removeAttribute('data-bg-format-flip');
    };
  }, [ref, hasGradient]);
}

export interface KeyElementPosition {
  hidden?: boolean;
  dx: number;
  dy: number;
  width: number;
  height?: number;
  activeImage?: string;
  inactiveImage?: string;
  activeTransparent?: boolean;
  idleTransparent?: boolean;
  className?: string;
  backgroundColor?: string;
  activeBackgroundColor?: string;
  borderColor?: string;
  activeBorderColor?: string;
  backgroundGradient?: GradientSpec | null;
  activeBackgroundGradient?: GradientSpec | null;
  borderGradient?: GradientSpec | null;
  activeBorderGradient?: GradientSpec | null;
  borderWidth?: number;
  borderRadius?: number;
  fontSize?: number;
  fontColor?: string;
  activeFontColor?: string;
  fontFamily?: string;
  idleImageFit?: string;
  activeImageFit?: string;
  imageFit?: string;
  useInlineStyles?: boolean;
  displayText?: string;
  fontWeight?: number;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  fontStrikethrough?: boolean;
  counter?: unknown;
  zIndex?: number;
}

interface KeyElementStylesInput {
  position: KeyElementPosition;
  active: boolean;
  label: string;
}

export interface KeyElementStyles {
  keyStyle: React.CSSProperties;
  /** 보더 그라데이션일 때만 존재 — 키 루트 첫 자식으로 렌더할 마스크 링 */
  borderRingStyle: React.CSSProperties | null;
  imageStyle: React.CSSProperties;
  textStyle: React.CSSProperties;
  inactiveImageSrc: string | null;
  activeImageSrc: string | null;
  currentImageSrc: string | null;
  hasCurrentImage: boolean;
  isTransparent: boolean;
  labelText: string;
  useInline: boolean;
}

export function computeKeyElementStyles({
  position,
  active,
  label,
}: KeyElementStylesInput): KeyElementStyles {
  const {
    dx,
    dy,
    width,
    height = 60,
    activeImage,
    inactiveImage,
    activeTransparent = false,
    idleTransparent = false,
    backgroundColor,
    activeBackgroundColor,
    borderColor,
    activeBorderColor,
    borderWidth,
    borderRadius,
    fontSize,
    fontColor,
    activeFontColor,
    fontFamily,
    idleImageFit,
    activeImageFit,
    imageFit,
    useInlineStyles,
    displayText,
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
  } = position;

  const labelText = displayText || label;
  const useInline = useInlineStyles === true;

  // 상태별 색상 — 배경·보더는 쌍 단위 폴백 (색/그라데이션이 상태 간 섞여 새지 않게)
  const bgPair = resolveStatePair(
    active,
    { color: backgroundColor, gradient: position.backgroundGradient },
    {
      color: activeBackgroundColor,
      gradient: position.activeBackgroundGradient,
    },
  );
  const borderPair = resolveStatePair(
    active,
    { color: borderColor, gradient: position.borderGradient },
    { color: activeBorderColor, gradient: position.activeBorderGradient },
  );
  const stateBackgroundColor = bgPair.color;
  const stateBorderColor = borderPair.color;
  const stateFontColor = active ? activeFontColor ?? fontColor : fontColor;

  // 이미지 소스
  const inactiveImageSrc = resolveImageSource(inactiveImage);
  const activeImageSrc = resolveImageSource(activeImage);

  const isTransparent = active ? activeTransparent : idleTransparent;

  const currentImageSrc =
    (active && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
  const hasCurrentImage = !!currentImageSrc;
  const isUsingActiveImage = active && !!activeImageSrc;
  const effectiveImageFit = isUsingActiveImage
    ? activeImageFit || imageFit || 'cover'
    : idleImageFit || imageFit || 'cover';

  // 기본 색상
  const defaultBgColor = hasCurrentImage
    ? 'transparent'
    : active
    ? DEFAULT_ELEMENT_ACTIVE_BG
    : DEFAULT_ELEMENT_BG;
  const defaultBorderColor = active
    ? DEFAULT_ELEMENT_ACTIVE_BORDER
    : DEFAULT_ELEMENT_BORDER;
  const defaultTextColor =
    active && !activeImageSrc
      ? DEFAULT_ELEMENT_ACTIVE_FONT
      : DEFAULT_ELEMENT_FONT;

  // 그라데이션 모드 — 대표 단색은 칠하지 않음 (반투명 스톱 이중 합성 방지)
  const bgGradient = hasCurrentImage ? null : bgPair.gradient ?? null;
  const borderGradientSpec = borderPair.gradient ?? null;

  // 보더 판정 — 명시값 우선, 아무 값도 없으면 기본 1px 헤어라인이 표면 분리
  // 담당(패널 표시값과 일치). 두께 0은 명시적 무보더, 이미지 키는 헤어라인 제외
  const hasExplicitBorder =
    borderWidth != null ? borderWidth > 0 : stateBorderColor != null;
  const showDefaultHairline =
    !hasExplicitBorder && borderWidth == null && !hasCurrentImage;
  const explicitBorder = `${
    borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH
  }px solid ${stateBorderColor || defaultBorderColor}`;
  const resolvedBorder =
    hasExplicitBorder || showDefaultHairline ? explicitBorder : 'none';
  // 그라데이션 보더는 명시 보더와 같은 두께 규칙 — width 0은 명시적 비활성
  const gradientRingWidth = borderWidth ?? DEFAULT_ELEMENT_BORDER_WIDTH;
  const ringEnabled = borderWidth != null ? borderWidth > 0 : true;
  const showBorderRing = borderGradientSpec != null && ringEnabled;
  // 한쪽 상태만 링이어도 반대 상태에 같은 패딩을 예약 — 눌림 시 콘텐츠 박스
  // 이동 방지. 실보더·헤어라인 상태는 보더가 이미 같은 인셋을 만들므로 제외
  const pairHasRing =
    ringEnabled &&
    (position.borderGradient != null || position.activeBorderGradient != null);
  const reserveRingPadding =
    showBorderRing ||
    (pairHasRing && !hasExplicitBorder && !showDefaultHairline);

  const keyStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`,
    // 그라데이션 키의 base는 무조건 transparent — 테마 --key-bg가 밑에 깔려
    // 반투명 스톱과 이중 합성되는 것 방지 (테마 오버라이드는 --key-bg-image로)
    backgroundColor: bgGradient
      ? 'transparent'
      : useInline && stateBackgroundColor
      ? stateBackgroundColor
      : `var(--key-bg, ${stateBackgroundColor || defaultBgColor})`,
    // 단색 키에는 인라인 backgroundImage를 두지 않는다 — 테마의 직접
    // background-image 지정(문서화된 계약)을 덮지 않기 위함
    ...(bgGradient
      ? {
          backgroundImage: useInline
            ? gradientToCss(bgGradient)
            : `var(--key-bg-image, ${gradientToCss(bgGradient)})`,
        }
      : {}),
    borderRadius:
      useInline && borderRadius != null
        ? `${borderRadius}px`
        : `var(--key-radius, ${
            borderRadius != null
              ? `${borderRadius}px`
              : `${DEFAULT_ELEMENT_RADIUS}px`
          })`,
    // 그라데이션 보더는 보더 대신 동일 두께 padding — overflow:hidden이
    // 패딩 박스에서 클리핑되므로 링 자식이 가장자리에 정확히 그려짐.
    // 테마 --key-border를 소비하지 않음 (실보더 + 링 padding 이중 소비 방지)
    border: showBorderRing
      ? 'none'
      : useInline
      ? resolvedBorder
      : `var(--key-border, ${resolvedBorder})`,
    ...(reserveRingPadding ? { padding: `${gradientRingWidth}px` } : {}),
    color:
      useInline && stateFontColor
        ? stateFontColor
        : `var(--key-text-color, ${stateFontColor || defaultTextColor})`,
    fontSize: fontSize ? `${fontSize}px` : undefined,
    overflow: 'hidden' as const,
    willChange: active ? 'transform, background-color' : 'transform',
    backfaceVisibility: 'hidden' as const,
    transformStyle: 'preserve-3d' as const,
    contain: 'layout style paint',
    imageRendering: 'auto' as const,
    isolation: 'isolate' as const,
    boxSizing: 'border-box' as const,
    zIndex: position.zIndex,
    cursor: 'default',
  };

  const fallbackImageDimmed = active && !activeImageSrc && !!inactiveImageSrc;
  const imageStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: effectiveImageFit as React.CSSProperties['objectFit'],
    display: 'block',
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
    position: 'relative' as const,
    zIndex: 0,
    filter: fallbackImageDimmed ? 'brightness(0.62)' : 'none',
  };

  // 텍스트 데코레이션
  const textDecorations: string[] = [];
  if (fontUnderline) textDecorations.push('underline');
  if (fontStrikethrough) textDecorations.push('line-through');

  const textStyle: React.CSSProperties = {
    willChange: 'auto',
    fontSize: fontSize ? `${fontSize}px` : undefined,
    fontFamily: fontFamily
      ? `"${fontFamily}", "Pretendard Variable", sans-serif`
      : undefined,
    fontWeight: fontWeight ?? DEFAULT_ELEMENT_FONT_WEIGHT,
    fontStyle: fontItalic ? ('italic' as const) : ('normal' as const),
    textDecoration:
      textDecorations.length > 0 ? textDecorations.join(' ') : 'none',
  };

  const borderRingStyle =
    showBorderRing && borderGradientSpec
      ? gradientRingStyle(borderGradientSpec, gradientRingWidth)
      : null;

  return {
    keyStyle,
    borderRingStyle,
    imageStyle,
    textStyle,
    inactiveImageSrc,
    activeImageSrc,
    currentImageSrc,
    hasCurrentImage,
    isTransparent,
    labelText,
    useInline,
  };
}
