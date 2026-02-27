import React from "react";
import { useRestartableCssAnimation } from "@hooks/useRestartableCssAnimation";
import { toCssRgba } from "@utils/colorUtils";

export default function CountDisplay({
  count,
  fillColor,
  strokeColor,
  globalKey,
  active,
  fontSize,
  fontFamily,
  fontWeight,
  fontItalic,
  fontUnderline,
  fontStrikethrough,
}) {
  const displayValue = count || 0;
  const animation = useRestartableCssAnimation(displayValue, {
    activeClassName: "counter-animated",
    durationCssVar: "--counter-animation-duration",
    phaseDataAttribute: "data-counter-animation",
  });
  const fill = toCssRgba(fillColor, "#FFFFFF");
  const stroke = toCssRgba(strokeColor, "transparent");
  const strokeWidth = stroke.alpha > 0 ? "1px" : "0px";

  const textDecorations = [];
  if (fontUnderline) textDecorations.push("underline");
  if (fontStrikethrough) textDecorations.push("line-through");
  const textDecoration =
    textDecorations.length > 0 ? textDecorations.join(" ") : "none";

  return (
    <span
      ref={animation.ref}
      className={`counter ${animation.className}`.trim()}
      data-text={displayValue}
      data-counter-state={active ? "active" : "inactive"}
      style={{
        transformOrigin: "center bottom",
        fontSize: `${Number.isFinite(fontSize) ? fontSize : 16}px`,
        fontFamily: fontFamily
          ? `"${fontFamily}", "SUIT-Regular", sans-serif`
          : undefined,
        fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
        fontStyle: fontItalic ? "italic" : "normal",
        textDecoration,
        textAlign: "center",
        pointerEvents: "none",
        userSelect: "none",
        lineHeight: 1,
        "--counter-color-default": fill.css,
        "--counter-stroke-color-default": stroke.css,
        "--counter-stroke-width-default": strokeWidth,
        ...(animation.style ?? {}),
      }}
    >
      {displayValue}
    </span>
  );
}
