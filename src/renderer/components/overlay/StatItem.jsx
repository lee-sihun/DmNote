import React, { memo, useEffect, useMemo } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { getStatValueSignal } from "@stores/statsSignals";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";
import { toCssRgba } from "@utils/colorUtils";
import { resolveImageSource } from "@utils/imageSource";
import { warmupImageSource } from "@utils/imageWarmup";

export default memo(function StatItem({
  statType,
  position,
  label,
  counterEnabled = false,
  active = false,
}) {
  useSignals();

  if (position?.hidden) return null;

  const {
    dx,
    dy,
    width,
    height = 60,
    activeImage,
    inactiveImage,
    activeTransparent = false,
    idleTransparent = false,
    className,
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
    // 글꼴 스타일
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
    // 카운터
    counter,
  } = position;

  const stateBackgroundColor = active
    ? activeBackgroundColor ?? backgroundColor
    : backgroundColor;
  const stateBorderColor = active
    ? activeBorderColor ?? borderColor
    : borderColor;
  const stateFontColor = active ? activeFontColor ?? fontColor : fontColor;

  const inactiveImageSrc = resolveImageSource(inactiveImage);
  const activeImageSrc = resolveImageSource(activeImage);

  // 상태 전환 직전 이미지 디코드를 미리 수행해 첫 렌더 끊김을 줄임
  useEffect(() => {
    warmupImageSource(inactiveImageSrc);
    warmupImageSource(activeImageSrc);
  }, [inactiveImageSrc, activeImageSrc]);

  const isTransparent = active ? activeTransparent : idleTransparent;
  if (isTransparent) {
    return null;
  }

  const useInline = useInlineStyles === true;
  const labelText = displayText || label || "";

  // 활성 상태에서 activeImage가 없으면 inactiveImage를 fallback으로 사용
  const currentImageSrc =
    (active && activeImageSrc ? activeImageSrc : inactiveImageSrc) || null;
  const hasCurrentImage = !!currentImageSrc;
  const isUsingActiveImage = active && !!activeImageSrc;
  const effectiveImageFit = isUsingActiveImage
    ? activeImageFit || imageFit || "cover"
    : idleImageFit || imageFit || "cover";

  const counterSettings = useMemo(() => {
    if (counter) {
      return normalizeCounterSettings(counter);
    }
    return createDefaultCounterSettings();
  }, [counter]);

  const showInsideCounter =
    counterEnabled &&
    counterSettings.enabled &&
    counterSettings.placement === "inside";

  const counterValue = showInsideCounter
    ? (getStatValueSignal(statType).value ?? 0) | 0
    : 0;

  const keyStyle = useMemo(() => {
    const defaultBgColor = hasCurrentImage
      ? "transparent"
      : active
      ? "rgba(121, 121, 121, 0.9)"
      : "rgba(46, 46, 47, 0.9)";
    const defaultBorderColor = active
      ? "rgba(255, 255, 255, 0.9)"
      : "rgba(113, 113, 113, 0.9)";
    const defaultTextColor =
      active && !activeImageSrc ? "#FFFFFF" : "rgba(121, 121, 121, 0.9)";

    return {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`,
      backgroundColor:
        useInline && stateBackgroundColor
          ? stateBackgroundColor
          : `var(--key-bg, ${stateBackgroundColor || defaultBgColor})`,
      borderRadius:
        useInline && borderRadius != null
          ? `${borderRadius}px`
          : `var(--key-radius, ${
              borderRadius != null ? `${borderRadius}px` : "10px"
            })`,
      border:
        useInline && (stateBorderColor || borderWidth != null)
          ? `${borderWidth ?? 3}px solid ${stateBorderColor || defaultBorderColor}`
          : `var(--key-border, ${borderWidth ?? 3}px solid ${
              stateBorderColor || defaultBorderColor
            })`,
      color:
        useInline && stateFontColor
          ? stateFontColor
          : `var(--key-text-color, ${stateFontColor || defaultTextColor})`,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      overflow: "hidden",
      willChange: active ? "transform, background-color" : "transform",
      backfaceVisibility: "hidden",
      transformStyle: "preserve-3d",
      contain: "layout style paint",
      imageRendering: "auto",
      isolation: "isolate",
      boxSizing: "border-box",
      zIndex: position.zIndex,
    };
  }, [
    active,
    dx,
    dy,
    width,
    height,
    hasCurrentImage,
    activeImageSrc,
    position.zIndex,
    useInline,
    stateBackgroundColor,
    stateBorderColor,
    borderWidth,
    borderRadius,
    fontSize,
    stateFontColor,
  ]);

  const fallbackImageDimmed = active && !activeImageSrc && !!inactiveImageSrc;
  const imageStyle = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      objectFit: effectiveImageFit,
      display: "block",
      pointerEvents: "none",
      userSelect: "none",
      position: "relative",
      zIndex: 0,
      // mask 오버레이 없이 필터만 적용해 페인트 비용을 줄임
      filter: fallbackImageDimmed ? "brightness(0.62)" : "none",
    }),
    [effectiveImageFit, fallbackImageDimmed],
  );

  const textStyle = useMemo(() => {
    const textDecorations = [];
    if (fontUnderline) textDecorations.push("underline");
    if (fontStrikethrough) textDecorations.push("line-through");

    return {
      willChange: "auto",
      contain: "layout style paint",
      fontSize: fontSize ? `${fontSize}px` : undefined,
      fontFamily: fontFamily
        ? `"${fontFamily}", "SUIT-Regular", sans-serif`
        : undefined,
      fontWeight: fontWeight ?? 700,
      fontStyle: fontItalic ? "italic" : "normal",
      textDecoration:
        textDecorations.length > 0 ? textDecorations.join(" ") : "none",
    };
  }, [
    fontSize,
    fontFamily,
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
  ]);

  const counterFillColor = active
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const counterStrokeColor = active
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;
  const contentGap = Number.isFinite(counterSettings.gap)
    ? counterSettings.gap
    : 6;
  const fillColorCss = toCssRgba(counterFillColor, "#FFFFFF");
  const strokeColorCss = toCssRgba(counterStrokeColor, "transparent");

  const renderInsideLayout = () => {
    if (!showInsideCounter) {
      return null;
    }

    const strokeWidth = strokeColorCss.alpha > 0 ? "1px" : "0px";

    const counterDecorations = [];
    if (counterSettings.fontUnderline) counterDecorations.push("underline");
    if (counterSettings.fontStrikethrough)
      counterDecorations.push("line-through");
    const counterTextDecoration =
      counterDecorations.length > 0 ? counterDecorations.join(" ") : "none";

    const counterElement = (
      <span
        key="counter"
        className="counter pointer-events-none select-none"
        data-text={counterValue}
        data-counter-state={active ? "active" : "inactive"}
        style={{
          fontSize: `${counterSettings.fontSize ?? 16}px`,
          fontFamily: counterSettings.fontFamily
            ? `"${counterSettings.fontFamily}", "SUIT-Regular", sans-serif`
            : undefined,
          fontWeight: counterSettings.fontWeight ?? 400,
          fontStyle: counterSettings.fontItalic ? "italic" : "normal",
          textDecoration: counterTextDecoration,
          lineHeight: 1,
          "--counter-color-default": fillColorCss.css,
          "--counter-stroke-color-default": strokeColorCss.css,
          "--counter-stroke-width-default": strokeWidth,
        }}
      >
        {counterValue}
      </span>
    );

    const nameElement = (
      <span
        key="label"
        className="font-bold text-[14px] pointer-events-none select-none"
        style={textStyle}
      >
        {labelText}
      </span>
    );

    const isHorizontal =
      counterSettings.align === "left" || counterSettings.align === "right";

    const elements = isHorizontal
      ? counterSettings.align === "left"
        ? [counterElement, nameElement]
        : [nameElement, counterElement]
      : counterSettings.align === "top"
      ? [counterElement, nameElement]
      : [nameElement, counterElement];

    const alignMode = counterSettings.alignMode || "center";
    const isBetween = alignMode === "between";
    const containerClass = `flex ${
      isHorizontal ? "" : "flex-col"
    } w-full h-full items-center pointer-events-none select-none`;

    return (
      <div
        className={containerClass}
        style={{
          justifyContent: isBetween ? "space-between" : "center",
          padding: isBetween
            ? isHorizontal
              ? `0 ${contentGap}px`
              : `${contentGap}px 0`
            : "0px",
          gap: isBetween ? "0px" : `${contentGap}px`,
        }}
      >
        {elements}
      </div>
    );
  };

  return (
    <div
      className={`absolute cursor-pointer ${className || ""}`}
      style={keyStyle}
      data-state={active ? "active" : "inactive"}
    >
      {hasCurrentImage ? (
        <img src={currentImageSrc} alt="" style={imageStyle} draggable={false} />
      ) : showInsideCounter ? (
        renderInsideLayout()
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold"
          style={textStyle}
        >
          {labelText}
        </div>
      )}
    </div>
  );
});
