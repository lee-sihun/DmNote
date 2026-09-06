/**
 * Key/StatItem 공통 스타일 계산 훅
 * 오버레이에서 키/통계 요소의 스타일을 일관되게 계산
 */

import { resolveImageSource } from '@utils/media/imageSource';
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
  DEFAULT_ELEMENT_RADIUS,
  DEFAULT_ELEMENT_BASE_FONT_WEIGHT,
  DEFAULT_ELEMENT_FONT_BOLD,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/element/elementDefaults';
import { resolveElementBorder } from '@utils/element/elementBorder';
import {
  elementShadowToCss,
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';
import { resolveEffectiveFontWeight } from '@utils/typography/fontWeights';
import {
  DEFAULT_IMAGE_MODE,
  IDENTITY_IMAGE_TRANSFORM,
  imageTransformToCss,
  type ImageMode,
  type ImageTransform,
} from '@src/types/key/imageLayer';
import { elementRotationTransform } from '@utils/element/rotation';

export interface KeyElementPosition {
  hidden?: boolean;
  dx: number;
  dy: number;
  width: number;
  height?: number;
  // 요소 회전(도) - 논리 상자 중심 기준, 루트 transform에 합성
  rotation?: number;
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
  imageMode?: ImageMode;
  idleImageTransform?: ImageTransform;
  activeImageTransform?: ImageTransform;
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
  /** 디코드에 실패한 resolved src 집합 - 유실 이미지가 투명 키를 만들지 않게 렌더에서 제외 */
  failedImageSrcs?: ReadonlySet<string>;
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
  /** 이미지가 있을 때의 레이어 모드 - replace면 표면·텍스트를 이미지가 대체 */
  imageMode: ImageMode;
  imageReplaces: boolean;
  isTransparent: boolean;
  labelText: string;
  useInline: boolean;
}

export function computeKeyElementStyles({
  position,
  active,
  label,
  failedImageSrcs,
}: KeyElementStylesInput): KeyElementStyles {
  const {
    dx,
    dy,
    width,
    height = 60,
    rotation = 0,
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
  const fontPair = resolveStatePair(
    active,
    { color: fontColor, gradient: position.fontGradient },
    { color: activeFontColor, gradient: position.activeFontGradient },
  );
  const stateFontColor = fontPair.color;
  const fontGradient = fontPair.gradient ?? null;

  // 이미지 소스. 실패한 src는 없는 것으로 - 배경·라벨·기본 립·섀도가 그대로 복귀하고
  // 활성만 실패하면 대기 이미지로 자연 폴백된다
  const dropFailed = (src: string | null): string | null =>
    src && failedImageSrcs?.has(src) ? null : src;
  const inactiveImageSrc = dropFailed(resolveImageSource(inactiveImage));
  const activeImageSrc = dropFailed(resolveImageSource(activeImage));

  const isTransparent = active ? activeTransparent : idleTransparent;

  const currentImageSrc =
    (active && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
  const hasCurrentImage = !!currentImageSrc;
  const isUsingActiveImage = active && !!activeImageSrc;
  const effectiveImageFit = isUsingActiveImage
    ? activeImageFit || imageFit || 'cover'
    : idleImageFit || imageFit || 'cover';
  const imageMode = position.imageMode ?? DEFAULT_IMAGE_MODE;
  const imageReplaces = hasCurrentImage && imageMode === 'replace';
  // active 이미지가 없으면 idle 이미지와 함께 idle 변환을 그대로 쓴다
  const imageTransform =
    (isUsingActiveImage
      ? position.activeImageTransform
      : position.idleImageTransform) ?? IDENTITY_IMAGE_TRANSFORM;

  // 기본 색상 — replace 이미지 키는 기본 배경 억제 (이미지가 표면 전부)
  const rootHasImage = imageReplaces;
  const rootBgPair = stateBgPair;
  const rootBackgroundColor = rootBgPair.color;
  const defaultBgColor = rootHasImage
    ? 'transparent'
    : active
    ? DEFAULT_ELEMENT_ACTIVE_BG
    : DEFAULT_ELEMENT_BG;
  const defaultTextColor =
    active && !activeImageSrc
      ? DEFAULT_ELEMENT_ACTIVE_FONT
      : DEFAULT_ELEMENT_FONT;

  // 그라데이션 모드 — 대표 단색은 칠하지 않음 (반투명 스톱 이중 합성 방지)
  const bgGradient = rootHasImage ? null : rootBgPair.gradient ?? null;

  // 보더 판정은 공용 해석기 - 패널 표시값과 같은 규칙. 이미지 키는 기본 립 제외
  const borderFields = {
    borderColor,
    activeBorderColor,
    borderGradient: position.borderGradient,
    activeBorderGradient: position.activeBorderGradient,
    borderWidth,
  };
  const resolvedElementBorder = resolveElementBorder(borderFields, active, {
    suppressDefault: imageReplaces,
  });
  const borderGradientSpec = resolvedElementBorder.gradient;
  const gradientRingWidth = resolvedElementBorder.width;
  const showBorderRing =
    borderGradientSpec != null && resolvedElementBorder.width > 0;
  const resolvedBorder =
    !showBorderRing && resolvedElementBorder.width > 0
      ? `${resolvedElementBorder.width}px solid ${resolvedElementBorder.color}`
      : 'none';
  // 반대 상태만 링이고 이 상태는 보더가 없으면 같은 패딩을 예약 - 눌림 시
  // 콘텐츠 박스 이동 방지. 보더가 있는 상태는 이미 같은 인셋을 만든다
  // 억제 판정도 이 상태와 같은 규칙(replace만) - overlay에서 반대 상태가 립을
  // 그리는데 여기서 null이 나오면 패딩 예약이 빠져 눌림 시 콘텐츠가 1px 튄다
  const otherStateBorder = resolveElementBorder(borderFields, !active, {
    suppressDefault:
      imageMode === 'replace' &&
      Boolean(active ? inactiveImageSrc : activeImageSrc || inactiveImageSrc),
  });
  const reserveRingPadding =
    showBorderRing ||
    (resolvedElementBorder.width <= 0 &&
      otherStateBorder.gradient != null &&
      otherStateBorder.width > 0);
  const reservedRingWidth = showBorderRing
    ? gradientRingWidth
    : otherStateBorder.width;

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
      suppressDefault: imageReplaces,
    }),
  );

  const keyStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)${elementRotationTransform(
      rotation,
    )}`,
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
          ...(reserveRingPadding ? { padding: `${reservedRingWidth}px` } : {}),
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
            ? `${reservedRingWidth}px`
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
    // overflow는 전역 :where 기본값(replace hidden, overlay visible)에 맡긴다
    willChange: 'transform',
    backfaceVisibility: 'hidden' as const,
    transformStyle: 'preserve-3d' as const,
    // overlay 이미지는 오버행할 수 있어 paint containment 제외. replace는 루트
    // overflow:hidden이 이미 자르므로 유지 (이미지 프리셋 대부분이 replace)
    contain: imageReplaces
      ? 'layout style paint'
      : hasCurrentImage
      ? 'layout style'
      : 'layout style paint',
    imageRendering: 'auto' as const,
    isolation: 'isolate' as const,
    boxSizing: 'border-box' as const,
    zIndex: position.zIndex,
    cursor: 'default',
  };

  const fallbackImageDimmed = active && !activeImageSrc && !!inactiveImageSrc;
  // 레이어 배치·object-fit·변환·z는 전역 :where([data-key-image-layer]) 규칙이
  // 소비한다. 인라인 우선 모드만 실제 선언으로 승격
  const imageTransformCss = imageTransformToCss(imageTransform);
  const imageLayerZ = imageReplaces ? 0 : 3;
  const createImageStyle = (
    objectFit: string,
    dimmed: boolean,
  ): React.CSSProperties => ({
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
    filter: dimmed ? 'brightness(0.62)' : 'none',
    ...(useInline
      ? {
          position: 'absolute' as const,
          inset: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box' as const,
          padding: imageReplaces ? 'inherit' : 0,
          ...(imageReplaces ? {} : { borderRadius: 'inherit' }),
          display: 'block',
          objectFit: objectFit as React.CSSProperties['objectFit'],
          transform: imageTransformCss,
          zIndex: imageLayerZ,
        }
      : ({
          '--dmn-key-image-fit-default': objectFit,
          '--dmn-key-image-transform-default': imageTransformCss,
          '--dmn-key-image-z-default': String(imageLayerZ),
        } as React.CSSProperties)),
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
          // 링은 DOM상 img보다 앞이라 같은 z(0)면 뒤에 오는 replace 이미지가 덮는다.
          // replace(0) 위·overlay(3) 아래 - GraphPanel의 순서와 동일
          zIndex: 1,
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
    imageMode,
    imageReplaces,
    isTransparent,
    labelText,
    useInline,
  };
}
