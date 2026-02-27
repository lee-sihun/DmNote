import React, { memo, useMemo } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { getStatValueSignal } from "@stores/statsSignals";
import CountDisplay from "@components/overlay/CountDisplay";
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from "@src/types/keys";

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

const StatCounter = memo(({ position, statType }) => {
  useSignals();

  const dx = Number.isFinite(position?.dx) ? position.dx : 0;
  const dy = Number.isFinite(position?.dy) ? position.dy : 0;
  const width = Number.isFinite(position?.width) ? position.width : 0;
  const height = Number.isFinite(position?.height) ? position.height : 0;

  const counterSettings = useMemo(() => {
    if (position?.counter) {
      return normalizeCounterSettings(position.counter);
    }
    return createDefaultCounterSettings();
  }, [position?.counter]);

  if (!counterSettings.enabled || counterSettings.placement !== "outside") {
    return null;
  }

  const count = (getStatValueSignal(statType).value ?? 0) | 0;

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
  const offsetY =
    counterSettings.align === "top"
      ? -6
      : counterSettings.align === "bottom"
      ? 6
      : 0;

  return (
    <div className="pointer-events-none" style={style}>
      <CountDisplay
        count={count}
        fillColor={fillColor}
        strokeColor={strokeColor}
        globalKey={`stat:${statType}`}
        active={false}
        offsetY={offsetY}
        fontSize={counterSettings.fontSize}
        fontFamily={counterSettings.fontFamily}
        fontWeight={counterSettings.fontWeight}
        fontItalic={counterSettings.fontItalic}
        fontUnderline={counterSettings.fontUnderline}
        fontStrikethrough={counterSettings.fontStrikethrough}
        animationEnabled={counterSettings.animation.enabled}
        animationBezier={counterSettings.animation.bezier}
        animationScale={counterSettings.animation.scale}
        animationDurationMs={counterSettings.animation.durationMs}
      />
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
            statType={position.statType}
          />
        );
      })}
    </div>
  );
}
