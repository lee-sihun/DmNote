import React, { memo, useMemo } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { getKeyCounterSignal } from "@stores/keyCounterSignals";
import CountDisplay from "@components/overlay/CountDisplay";
import { getKeySignal } from "@stores/keySignals";
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

const KeyCounter = memo(({ globalKey, position, mode }) => {
  useSignals();
  const counterSignal = getKeyCounterSignal(mode ?? "", globalKey);
  const count = counterSignal?.value ?? 0;
  const active = getKeySignal(globalKey).value;

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

  // 개별 키의 카운터가 비활성화되었거나 outside가 아니면 렌더링하지 않음
  if (!counterSettings.enabled || counterSettings.placement !== "outside") {
    return null;
  }

  const style = computeOutsideStyle(
    counterSettings.align,
    dx,
    dy,
    width,
    height,
    counterSettings.gap,
  );

  const fillColor = active
    ? counterSettings.fill.active
    : counterSettings.fill.idle;
  const strokeColor = active
    ? counterSettings.stroke.active
    : counterSettings.stroke.idle;
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
        globalKey={globalKey}
        active={active}
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

export default function KeyCounterLayer({ keys, positions, mode }) {
  if (!keys?.length || !positions?.length) {
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 12 }}
    >
      {keys.map((key, index) => {
        const position = positions[index];
        if (!position) return null;
        if (position.hidden) return null;
        return (
          <KeyCounter
            key={`${mode}-${key}-${index}`}
            globalKey={key}
            position={position}
            mode={mode}
          />
        );
      })}
    </div>
  );
}
