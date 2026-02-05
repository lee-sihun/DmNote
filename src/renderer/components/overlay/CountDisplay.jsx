import React, { useState, useRef, useEffect } from "react";
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
  const [scale, setScale] = useState(1);
  const prevCount = useRef(count);
  const animationRef = useRef(null);

  useEffect(() => {
    if (prevCount.current !== count) {
      prevCount.current = count;

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const startTime = Date.now();
      const duration = 300;
      const maxScale = 1.1;

      const getBounceScale = (elapsed) => {
        if (elapsed > duration) return 1.0;
        const progress = elapsed / duration;

        const easeOutQuad = (t) => t * (2 - t);
        const easeProgress = easeOutQuad(progress);

        return 1.0 + (maxScale - 1.0) * (1 - easeProgress);
      };

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const currentScale = getBounceScale(elapsed);

        setScale(currentScale);

        if (elapsed < duration) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [count]);

  const displayValue = count || 0;
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
      className="counter"
      data-text={displayValue}
      data-counter-state={active ? "active" : "inactive"}
      style={{
        transform: `scale(${scale})`,
        transformOrigin: "center bottom",
        fontSize: `${Number.isFinite(fontSize) ? fontSize : 16}px`,
        fontFamily: fontFamily || undefined,
        fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
        fontStyle: fontItalic ? "italic" : "normal",
        textDecoration,
        textAlign: "center",
        pointerEvents: "none",
        lineHeight: 1,
        "--counter-color-default": fill.css,
        "--counter-stroke-color-default": stroke.css,
        "--counter-stroke-width-default": strokeWidth,
      }}
    >
      {displayValue}
    </span>
  );
}
