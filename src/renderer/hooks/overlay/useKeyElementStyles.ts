/**
 * Key/StatItem 공통 스타일 계산 훅
 * 오버레이에서 키/통계 요소의 스타일을 일관되게 계산
 */

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
  DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
  DEFAULT_ELEMENT_FONT_BOLD,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import {
  elementShadowToCss,
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import { resolveEffectiveFontWeight } from '@utils/core/fontWeights';

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
  shadow?: ElementShadowSpec;
  activeShadow?: ElementShadowSpec;
  fontSize?: number;
  fontColor?: string;
  activeFontColor?: string;
  fontGradient?: GradientSpec | null;
  activeFontGradient?: GradientSpec | null;
  fontFamily?: string;
  idleImageFit?: string;
  activeImageFit?: string;
  imageFit?: string;
  useInlineStyles?: boolean;
  displayText?: string;
  fontWeight?: number;
  fontBold?: boolean;
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
  /** 라벨 노드 전용 페인트 - 인라인 우선 모드의 그라데이션 클립 승격분 */
  labelPaintStyle: React.CSSProperties;
  /** idle·active 어느 상태든 라벨 그라데이션이 저장돼 있는지 - 측정 수명 기준 */
  labelHasGradient: boolean;
  /** 라벨 글리프 측정 캐시 키 - 타이포그래피·표시 상태 서명 */
  labelMetricsDep: string;
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
    shadow,
    activeShadow,
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
    fontBold,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
  } = position;

  const labelText = displayText || label;
  const useInline = useInlineStyles === true;

  // 상태별 색상 — 배경·보더는 쌍 단위 폴백 (색/그라데이션이 상태 간 섞여 새지 않게)
  const idleBgPair = resolveStatePair(
    false,
    { color: backgroundColor, gradient: position.backgroundGradient },
    {
      color: activeBackgroundColor,
      gradient: position.activeBackgroundGradient,
    },
  );
  const activeBgPair = resolveStatePair(
    true,
    { color: backgroundColor, gradient: position.backgroundGradient },
    {
      color: activeBackgroundColor,
      gradient: position.activeBackgroundGradient,
    },
  );
  const stateBgPair = active ? activeBgPair : idleBgPair;
  const borderPair = resolveStatePair(
    active,
    { color: borderColor, gradient: position.borderGradient },
    { color: activeBorderColor, gradient: position.activeBorderGradient },
  );
  const stateBorderColor = borderPair.color;
  const fontPair = resolveStatePair(
    active,
    { color: fontColor, gradient: position.fontGradient },
    { color: activeFontColor, gradient: position.activeFontGradient },
  );
  const stateFontColor = fontPair.color;
  const fontGradient = fontPair.gradient ?? null;

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

  // 기본 색상 — 이미지 키는 기본 배경 억제 (이미지가 표면 전부)
  const rootHasImage = hasCurrentImage;
  const rootBgPair = stateBgPair;
  const rootBackgroundColor = rootBgPair.color;
  const defaultBgColor = rootHasImage
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
  const bgGradient = rootHasImage ? null : rootBgPair.gradient ?? null;
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

  const textDecorations: string[] = [];
  if (fontUnderline) textDecorations.push('underline');
  if (fontStrikethrough) textDecorations.push('line-through');
  const resolvedTextDecoration =
    textDecorations.length > 0 ? textDecorations.join(' ') : 'none';
  const resolvedFontFamily = fontFamily
    ? `"${fontFamily}", "Pretendard Variable", sans-serif`
    : 'inherit';
  const hasLegacyBoldWeight = fontBold == null && fontWeight === 700;
  const resolvedBold =
    fontBold ??
    (fontWeight == null ? DEFAULT_ELEMENT_FONT_BOLD : hasLegacyBoldWeight);
  const resolvedFontWeight = resolveEffectiveFontWeight(
    hasLegacyBoldWeight
      ? DEFAULT_ELEMENT_BASE_FONT_WEIGHT
      : fontWeight ?? DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
    resolvedBold,
  );
  const resolvedShadow = elementShadowToCss(
    resolveElementShadow({
      active,
      shadow,
      activeShadow,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      suppressDefault: hasCurrentImage,
    }),
  );

  const keyStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`,
    ...(useInline
      ? {
          // 인라인 우선 모드만 속성 패널 값을 실제 inline declaration으로 승격
          backgroundColor: bgGradient
            ? 'transparent'
            : rootBackgroundColor || defaultBgColor,
          ...(bgGradient ? { backgroundImage: gradientToCss(bgGradient) } : {}),
          backgroundClip: 'padding-box' as const,
          borderRadius:
            borderRadius != null
              ? `${borderRadius}px`
              : `${DEFAULT_ELEMENT_RADIUS}px`,
          border: showBorderRing ? 'none' : resolvedBorder,
          ...(reserveRingPadding ? { padding: `${gradientRingWidth}px` } : {}),
          color: stateFontColor || defaultTextColor,
          fontSize: fontSize ? `${fontSize}px` : undefined,
          fontFamily: fontFamily ? resolvedFontFamily : undefined,
          fontWeight: resolvedFontWeight,
          fontStyle: fontItalic ? ('italic' as const) : ('normal' as const),
          textDecoration: resolvedTextDecoration,
          boxShadow: resolvedShadow,
        }
      : ({
          // 일반 모드는 전역 :where 규칙이 소비하는 fallback 변수만 제공
          '--dmn-key-bg-default': bgGradient
            ? 'transparent'
            : rootBackgroundColor || defaultBgColor,
          '--dmn-key-bg-image-default': bgGradient
            ? gradientToCss(bgGradient)
            : 'none',
          '--dmn-key-border-default': showBorderRing ? 'none' : resolvedBorder,
          '--dmn-key-radius-default':
            borderRadius != null
              ? `${borderRadius}px`
              : `${DEFAULT_ELEMENT_RADIUS}px`,
          '--dmn-key-padding-default': reserveRingPadding
            ? `${gradientRingWidth}px`
            : '0px',
          '--dmn-key-text-color-default': stateFontColor || defaultTextColor,
          '--dmn-key-text-image-default': fontGradient
            ? gradientToCss(fontGradient)
            : 'none',
          '--dmn-key-label-color-default': fontGradient
            ? 'transparent'
            : 'inherit',
          '--dmn-key-text-repeat-default': fontGradient
            ? 'no-repeat'
            : 'repeat',
          '--dmn-key-font-size-default': fontSize ? `${fontSize}px` : 'inherit',
          '--dmn-key-font-family-default': resolvedFontFamily,
          '--dmn-key-font-weight-default': String(resolvedFontWeight),
          '--dmn-key-font-style-default': fontItalic ? 'italic' : 'normal',
          '--dmn-key-text-decoration-default': resolvedTextDecoration,
          '--dmn-key-shadow-default': resolvedShadow,
        } as React.CSSProperties)),
    overflow: 'hidden' as const,
    willChange: 'transform',
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
  const createImageStyle = (
    objectFit: string,
    dimmed: boolean,
  ): React.CSSProperties => ({
    width: '100%',
    height: '100%',
    objectFit: objectFit as React.CSSProperties['objectFit'],
    display: 'block',
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
    position: 'relative' as const,
    zIndex: 0,
    filter: dimmed ? 'brightness(0.62)' : 'none',
  });
  const imageStyle = createImageStyle(effectiveImageFit, fallbackImageDimmed);

  const textStyle: React.CSSProperties = {
    willChange: 'auto',
    // color는 지정하지 않는다 - 라벨 인라인에 실리면 [data-key-label] 규칙의
    // 그라데이션 클립(color: transparent)을 인라인 우선순위로 덮어버린다
    fontSize: useInline ? (fontSize ? `${fontSize}px` : undefined) : 'inherit',
    fontFamily: useInline
      ? fontFamily
        ? resolvedFontFamily
        : undefined
      : 'inherit',
    fontWeight: useInline ? resolvedFontWeight : 'inherit',
    fontStyle: useInline ? (fontItalic ? 'italic' : 'normal') : 'inherit',
    textDecoration: useInline ? resolvedTextDecoration : 'inherit',
  };

  // 측정 수명은 상태 쌍 단위 - 입력 토글마다 정리·재측정이 반복되지 않게
  const labelHasGradient = Boolean(
    position.fontGradient || position.activeFontGradient,
  );
  // 상태 포함 - [data-state] 스코프 커스텀 CSS가 메트릭을 바꿀 수 있다
  const labelMetricsDep = `${
    fontSize ?? ''
  }|${resolvedFontFamily}|${resolvedFontWeight}|${fontItalic ? 1 : 0}|${
    active ? 'active' : 'inactive'
  }`;

  // 라벨 페인트 - 변수 모드는 전역 [data-key-label] 규칙이 소비하고,
  // 인라인 우선 모드만 실제 선언으로 승격 (글리프 클립은 라벨 노드에서만)
  const labelPaintStyle: React.CSSProperties =
    useInline && fontGradient
      ? {
          backgroundImage: gradientToCss(fontGradient),
          backgroundRepeat: 'no-repeat',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          WebkitTextFillColor: 'currentcolor',
        }
      : {};

  const borderRingStyle =
    showBorderRing && borderGradientSpec
      ? {
          ...gradientRingStyle(borderGradientSpec, gradientRingWidth),
          ...(useInline
            ? { background: gradientToCss(borderGradientSpec) }
            : {}),
        }
      : null;

  return {
    keyStyle,
    borderRingStyle,
    imageStyle,
    textStyle,
    labelPaintStyle,
    labelHasGradient,
    labelMetricsDep,
    inactiveImageSrc,
    activeImageSrc,
    currentImageSrc,
    hasCurrentImage,
    isTransparent,
    labelText,
    useInline,
  };
}
