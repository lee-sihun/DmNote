'use no memo';
import React, { useEffect, useState } from 'react';
import { useSignals } from '@preact/signals-react/runtime';
import { getAxisSignal } from '@stores/signals/axisSignals';
import { resolveImageSource } from '@utils/core/imageSource';
import { warmupImageSource } from '@utils/core/imageWarmup';
import {
  DEFAULT_ELEMENT_BG,
  DEFAULT_ELEMENT_ACTIVE_BG,
  DEFAULT_ELEMENT_FONT,
  DEFAULT_ELEMENT_ACTIVE_FONT,
  DEFAULT_ELEMENT_SHADOW_SPEC,
  DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
} from '@utils/core/elementDefaults';
import { resolveElementBorder } from '@utils/core/elementBorder';
import {
  gradientToCss,
  gradientRingStyle,
  resolveStatePair,
  type GradientSpec,
} from '@src/types/color';
import {
  elementShadowToCss,
  resolveElementShadow,
  type ElementShadowSpec,
} from '@src/types/key/shadows';

interface KnobPosition {
  hidden?: boolean;
  axisId?: string;
  sensitivity?: number;
  reverse?: boolean;
  dx?: number;
  dy?: number;
  width?: number;
  height?: number;
  className?: string;
  zIndex?: number;
  activeImage?: string;
  inactiveImage?: string;
  idleTransparent?: boolean;
  activeTransparent?: boolean;
  imageFit?: string;
  idleImageFit?: string;
  activeImageFit?: string;
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
  useInlineStyles?: boolean;
}

interface OverlayKnobItemProps {
  position: KnobPosition;
  index?: number;
}

// 회전 멈춤 후 입력(active) 상태를 유지하는 시간(ms)
const ACTIVE_HOLD_MS = 150;

// HID 축(노브)에 바인딩되는 회전 요소. axisSignals의 누적 회전수(정규화된
// wrap-델타)에 배율(sensitivity)/방향을 적용해 회전. 입력 사이 보간은
// CSS transition으로 처리. 회전 중에는 키의 눌림처럼 입력(active) 상태로 전환.
const OverlayKnobItem = ({ position, index = 0 }: OverlayKnobItemProps) => {
  useSignals();

  const {
    axisId = '',
    sensitivity = 1,
    reverse = false,
    dx = 0,
    dy = 0,
    width = 60,
    height = 60,
    className,
    activeImage,
    inactiveImage,
    idleTransparent = false,
    activeTransparent = false,
    imageFit,
    idleImageFit,
    activeImageFit,
    backgroundColor,
    activeBackgroundColor,
    borderColor,
    activeBorderColor,
    backgroundGradient,
    activeBackgroundGradient,
    borderGradient,
    activeBorderGradient,
    borderWidth,
    borderRadius,
    shadow,
    activeShadow,
    useInlineStyles,
  } = position ?? {};
  const useInline = useInlineStyles === true;

  const accum = axisId ? getAxisSignal(axisId).value : 0;

  // 회전 감지 → 입력(active) 상태 (마지막 움직임 후 ACTIVE_HOLD_MS 유지)
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!axisId) return undefined;
    const signal = getAxisSignal(axisId);
    let prev = signal.value;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = signal.subscribe((value) => {
      if (value === prev) return;
      prev = value;
      setIsActive(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setIsActive(false);
      }, ACTIVE_HOLD_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      setIsActive(false);
    };
  }, [axisId]);

  const inactiveImageSrc = resolveImageSource(inactiveImage);
  const activeImageSrc = resolveImageSource(activeImage);

  // 첫 회전 입력에서 active 이미지 cold decode가 겹치지 않도록 선행 디코드 (Key/StatItem과 동일 패턴)
  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  if (!position || position.hidden) return null;

  // accum은 회전수 단위(물리 1회전 ≈ 1.0) — sensitivity는 순수 배율
  const angle = accum * 360 * sensitivity * (reverse ? -1 : 1);

  const imageSrc =
    (isActive && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
  const isUsingActiveImage = isActive && !!activeImageSrc;
  const resolvedFit = (
    isUsingActiveImage
      ? activeImageFit || imageFit || 'cover'
      : idleImageFit || imageFit || 'cover'
  ) as React.CSSProperties['objectFit'];

  const isTransparent = isActive ? activeTransparent : idleTransparent;
  const stateBackground = isActive
    ? activeBackgroundColor || backgroundColor || DEFAULT_ELEMENT_ACTIVE_BG
    : backgroundColor || DEFAULT_ELEMENT_BG;
  // 보더 색은 회전 인식 막대 색을 겸함 — 폴백은 텍스트 색 계열
  const stateBorderColor = isActive
    ? activeBorderColor || borderColor || DEFAULT_ELEMENT_ACTIVE_FONT
    : borderColor || DEFAULT_ELEMENT_FONT;
  // 그라데이션 쌍 해석 — 상태 간 색/그라데이션이 섞이지 않도록 쌍 단위 폴백
  const bgPair = resolveStatePair(
    isActive,
    { color: backgroundColor, gradient: backgroundGradient },
    { color: activeBackgroundColor, gradient: activeBackgroundGradient },
  );
  const bgSpec = bgPair.gradient ?? null;
  // 보더는 키·그래프와 같은 공용 해석기 (미지정이면 기본 글래스 립)
  const resolvedKnobBorder = resolveElementBorder(
    {
      borderColor,
      activeBorderColor,
      borderGradient,
      activeBorderGradient,
      borderWidth,
    },
    isActive,
  );
  const borderSpec = resolvedKnobBorder.gradient;
  const gradientRingWidth = resolvedKnobBorder.width;
  const showBorderRing = Boolean(borderSpec) && gradientRingWidth > 0;
  // 모서리 반경 미지정 시 원형 유지 (px 지정 시 키와 동일한 px 단위)
  const resolvedRadius = borderRadius != null ? `${borderRadius}px` : '50%';
  const resolvedBackground = isTransparent
    ? 'transparent'
    : bgSpec
    ? gradientToCss(bgSpec)
    : stateBackground;
  const resolvedBorder =
    !showBorderRing && gradientRingWidth > 0
      ? `${gradientRingWidth}px solid ${resolvedKnobBorder.color}`
      : 'none';
  const resolvedShadow = elementShadowToCss(
    resolveElementShadow({
      active: isActive,
      shadow,
      activeShadow,
      defaultShadow: DEFAULT_ELEMENT_SHADOW_SPEC,
      defaultActiveShadow: DEFAULT_ELEMENT_ACTIVE_SHADOW_SPEC,
      suppressDefault: Boolean(
        isTransparent || imageSrc || (borderWidth && borderWidth > 0),
      ),
    }),
  );

  const transform = `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`;

  return (
    <div
      className={`absolute select-none ${className || ''}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        zIndex: position.zIndex ?? index,
        contain: 'layout style',
      }}
    >
      <div
        style={
          {
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
            ...(useInline
              ? {
                  borderRadius: resolvedRadius,
                  background: resolvedBackground,
                  backgroundClip: 'padding-box',
                  border: resolvedBorder,
                  padding: showBorderRing
                    ? `${gradientRingWidth}px`
                    : undefined,
                  boxShadow: resolvedShadow,
                }
              : {
                  '--dmn-knob-bg-default': resolvedBackground,
                  '--dmn-knob-border-default': resolvedBorder,
                  '--dmn-knob-radius-default': resolvedRadius,
                  '--dmn-knob-padding-default': showBorderRing
                    ? `${gradientRingWidth}px`
                    : '0px',
                  '--dmn-knob-shadow-default': resolvedShadow,
                  '--dmn-knob-indicator-default': stateBorderColor,
                }),
            boxSizing: 'border-box',
            transform: `rotate(${angle}deg)`,
            transition: 'transform 0.1s linear',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
          } as React.CSSProperties
        }
        data-knob-element="true"
        data-knob-state={isActive ? 'active' : 'inactive'}
      >
        {showBorderRing && borderSpec && (
          <span
            aria-hidden="true"
            data-gradient-border-ring="true"
            style={{
              ...gradientRingStyle(borderSpec, gradientRingWidth),
              ...(useInline ? { background: gradientToCss(borderSpec) } : {}),
            }}
          />
        )}
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            draggable={false}
            style={{
              width: '100%',
              height: '100%',
              objectFit: resolvedFit,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        ) : (
          // 기본 원형 + 회전 인식용 중앙 일자 막대
          <div
            style={{
              position: 'absolute',
              top: '12%',
              left: '50%',
              width: '8%',
              height: '76%',
              transform: 'translateX(-50%)',
              background: useInline ? stateBorderColor : undefined,
              borderRadius: '4px',
            }}
            data-knob-indicator="true"
          />
        )}
      </div>
    </div>
  );
};

export default OverlayKnobItem;
