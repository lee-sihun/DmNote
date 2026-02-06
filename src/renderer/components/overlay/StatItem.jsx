import React, { memo, useMemo } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { getStatValueSignal } from "@stores/statsSignals";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";
import { toCssRgba } from "@utils/colorUtils";
import { resolveImageSource } from "@utils/imageSource";

export default memo(function StatItem({
  statType,
  position,
  label,
  counterEnabled = false,
}) {
  useSignals();

  if (position?.hidden) return null;

  const {
    dx,
    dy,
    width,
    height = 60,
    inactiveImage,
    className,
    backgroundColor,
    borderColor,
    borderWidth,
    borderRadius,
    fontSize,
    fontColor,
    fontFamily,
    idleImageFit,
    imageFit,
    useInlineStyles,
    // 글꼴 스타일
    fontWeight,
    fontItalic,
    fontUnderline,
    fontStrikethrough,
    // 카운터
    counter,
    idleTransparent = false,
  } = position;

  if (idleTransparent) {
    return null;
  }

  const useInline = useInlineStyles === true;
  const labelText = position.displayText || label || "";

  const currentImage = inactiveImage ? inactiveImage : null;
  const currentImageSrc = resolveImageSource(currentImage);
  const effectiveImageFit = idleImageFit || imageFit || "cover";

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
    const defaultBgColor = currentImageSrc
      ? "transparent"
      : "rgba(46, 46, 47, 0.9)";
    const defaultBorderColor = "rgba(113, 113, 113, 0.9)";
    const defaultTextColor = "rgba(121, 121, 121, 0.9)";

    return {
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`,
      backgroundColor:
        useInline && backgroundColor
          ? backgroundColor
          : `var(--key-bg, ${backgroundColor || defaultBgColor})`,
      borderRadius:
        useInline && borderRadius != null
          ? `${borderRadius}px`
          : `var(--key-radius, ${
              borderRadius != null ? `${borderRadius}px` : "10px"
            })`,
      border:
        useInline && (borderColor || borderWidth != null)
          ? `${borderWidth ?? 3}px solid ${borderColor || defaultBorderColor}`
          : `var(--key-border, ${borderWidth ?? 3}px solid ${
              borderColor || defaultBorderColor
            })`,
      color:
        useInline && fontColor
          ? fontColor
          : `var(--key-text-color, ${fontColor || defaultTextColor})`,
      fontSize: fontSize ? `${fontSize}px` : undefined,
      overflow: "hidden",
      willChange: "transform",
      backfaceVisibility: "hidden",
      transformStyle: "preserve-3d",
      contain: "layout style paint",
      imageRendering: "auto",
      isolation: "isolate",
      boxSizing: "border-box",
      zIndex: position.zIndex,
    };
  }, [
    dx,
    dy,
    width,
    height,
    currentImageSrc,
    position.zIndex,
    useInline,
    backgroundColor,
    borderColor,
    borderWidth,
    borderRadius,
    fontSize,
    fontColor,
  ]);

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
    }),
    [effectiveImageFit],
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

  const counterFillColor = counterSettings.fill.idle;
  const counterStrokeColor = counterSettings.stroke.idle;
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
        data-counter-state="inactive"
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
      data-state="inactive"
    >
      {currentImageSrc ? (
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
