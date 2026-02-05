import React, { memo, useMemo } from "react";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";
import { toCssRgba } from "@utils/colorUtils";

const OUTSIDE_OFFSET = 5;

const computeOutsideStyle = (align, dx, dy, width, height, gap) => {
  const base = {
    position: "absolute",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
  };

  const offset = Number.isFinite(gap) ? gap : OUTSIDE_OFFSET;

  switch (align) {
    case "bottom":
      return {
        ...base,
        left: `${dx + width / 2}px`,
        top: `${dy + height + offset}px`,
        transform: "translate(-50%, 0)",
        minWidth: `${width}px`,
      };
    case "left":
      return {
        ...base,
        left: `${dx - offset}px`,
        top: `${dy + height / 2}px`,
        transform: "translate(-100%, -50%)",
      };
    case "right":
      return {
        ...base,
        left: `${dx + width + offset}px`,
        top: `${dy + height / 2}px`,
        transform: "translate(0, -50%)",
      };
    case "top":
    default:
      return {
        ...base,
        left: `${dx + width / 2}px`,
        top: `${dy - offset}px`,
        transform: "translate(-50%, -100%)",
        minWidth: `${width}px`,
      };
  }
};

const StatCounter = memo(({ position, previewValue = 0 }) => {
  const dx = Number.isFinite(position?.dx) ? position.dx : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy : 0;
  const width = Number.isFinite(position?.width) ? position.width : 60;
  const height = Number.isFinite(position?.height) ? position.height : 60;

  const counterSettings = useMemo(() => {
    if (position?.counter) {
      return normalizeCounterSettings(position.counter);
    }
    return createDefaultCounterSettings();
  }, [position?.counter]);

  if (!counterSettings.enabled || counterSettings.placement !== "outside") {
    return null;
  }

  const count = (previewValue ?? 0) | 0;

  const style = computeOutsideStyle(
    counterSettings.align,
    dx,
    dy,
    width,
    height,
    counterSettings.gap,
  );

  const fillColor = counterSettings.fill.idle;
  const strokeColor = counterSettings.stroke.idle;

  const fill = toCssRgba(fillColor, "#FFFFFF");
  const stroke = toCssRgba(strokeColor, "transparent");
  const strokeWidth = stroke.alpha > 0 ? "1px" : "0px";

  const textDecorations = [];
  if (counterSettings.fontUnderline) textDecorations.push("underline");
  if (counterSettings.fontStrikethrough) textDecorations.push("line-through");
  const textDecoration =
    textDecorations.length > 0 ? textDecorations.join(" ") : "none";

  return (
    <div className="pointer-events-none" style={style}>
      <span
        className="counter pointer-events-none select-none"
        data-text={count}
        data-counter-state="inactive"
        style={{
          fontSize: `${counterSettings.fontSize ?? 16}px`,
          fontFamily: counterSettings.fontFamily
            ? `"${counterSettings.fontFamily}", "SUIT-Regular", sans-serif`
            : undefined,
          fontWeight: counterSettings.fontWeight ?? 400,
          fontStyle: counterSettings.fontItalic ? "italic" : "normal",
          textDecoration,
          lineHeight: 1,
          "--counter-color-default": fill.css,
          "--counter-stroke-color-default": stroke.css,
          "--counter-stroke-width-default": strokeWidth,
        }}
      >
        {count}
      </span>
    </div>
  );
});

export default function StatCounterLayer({ positions }) {
  if (!positions?.length) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 12 }}
    >
      {positions.map((position, index) => {
        if (!position) return null;
        if (position.hidden) return null;
        return (
          <StatCounter
            key={`stat-counter-${index}`}
            position={position}
            previewValue={0}
          />
        );
      })}
    </div>
  );
}
