import React, { forwardRef, useMemo } from "react";

function buildLinePoints(history, safeMax) {
  const denominator = Math.max(history.length - 1, 1);
  const points = history
    .map((value, index) => {
      const x = (index / denominator) * 100;
      const y = 100 - Math.min((value / safeMax) * 100, 100);
      return `${x},${y}`;
    })
    .join(" ");

  const fillPoints = [
    "0,100",
    ...history.map((value, index) => {
      const x = (index / denominator) * 100;
      const y = 100 - Math.min((value / safeMax) * 100, 100);
      return `${x},${y}`;
    }),
    "100,100",
  ].join(" ");

  return { points, fillPoints };
}

const GraphPanel = forwardRef(function GraphPanel(
  {
    dx = 0,
    dy = 0,
    width = 200,
    height = 100,
    zIndex = 0,
    className = "",
    graphType = "line",
    graphColor = "#86EFAC",
    backgroundColor = "rgba(17, 17, 20, 0.9)",
    borderColor = "rgba(255, 255, 255, 0.1)",
    borderWidth = 1,
    borderRadius = 8,
    imageSrc = null,
    imageFit = "cover",
    history = [],
    avg = 0,
    maxval = 1,
    uid = "graph",
    withOffsetVars = true,
    interactive = true,
    dataEditing,
    onClick,
    onMouseDown,
    onContextMenu,
    onDragStart,
  },
  ref
) {
  const safeMax = maxval > 0 ? maxval : 1;
  const resolvedGraphType = graphType === "bar" ? "bar" : "line";
  const transform = withOffsetVars
    ? `translate3d(calc(${dx}px + var(--key-offset-x, 0px)), calc(${dy}px + var(--key-offset-y, 0px)), 0)`
    : `translate3d(${dx}px, ${dy}px, 0)`;

  const { points: linePoints, fillPoints } = useMemo(
    () => buildLinePoints(history, safeMax),
    [history, safeMax]
  );

  const resolvedBorderWidth = Number.isFinite(Number(borderWidth))
    ? Math.max(0, Number(borderWidth))
    : 1;
  const resolvedBorderRadius = Number.isFinite(Number(borderRadius))
    ? Math.max(0, Number(borderRadius))
    : 8;
  const resolvedBackgroundColor = backgroundColor || "rgba(17, 17, 20, 0.9)";
  const resolvedBorder =
    resolvedBorderWidth <= 0
      ? "none"
      : `${resolvedBorderWidth}px solid ${borderColor || "rgba(255, 255, 255, 0.1)"}`;

  const avgY = 100 - Math.min((avg / safeMax) * 100, 100);

  return (
    <div
      ref={ref}
      className={`absolute select-none ${className || ""}`}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        transform,
        background: resolvedBackgroundColor,
        color: "#FFFFFF",
        border: resolvedBorder,
        borderRadius: `${resolvedBorderRadius}px`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: interactive ? "pointer" : "default",
        fontFamily:
          "Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, 'Helvetica Neue', sans-serif",
        willChange: "transform",
        backfaceVisibility: "hidden",
        transformStyle: "preserve-3d",
        contain: "layout style paint",
        imageRendering: "auto",
        isolation: "isolate",
        zIndex,
      }}
      data-state="inactive"
      data-editing={dataEditing ? "true" : undefined}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: imageFit || "cover",
            pointerEvents: "none",
            userSelect: "none",
            zIndex: 0,
          }}
        />
      ) : null}
      {resolvedGraphType === "bar" ? (
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            flex: 1,
            minHeight: 0,
            background: "transparent",
            gap: "1px",
            position: "relative",
            zIndex: 1,
          }}
        >
          {history.map((value, index) => {
            const barHeight = Math.min((value / safeMax) * 100, 100);
            const opacity = 0.3 + (index / history.length) * 0.7;
            return (
              <div
                key={`${uid}-bar-${index}`}
                style={{
                  flex: 1,
                  minHeight: "2px",
                  transition: "height 0.15s ease-out",
                  background: graphColor,
                  height: `${barHeight}%`,
                  opacity,
                  clipPath: "inset(0 0 0 0 round 2px 2px 0 0)",
                }}
              />
            );
          })}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flex: 1,
            minHeight: 0,
            background: "transparent",
            gap: "1px",
            position: "relative",
            zIndex: 1,
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              width: "100%",
              height: "100%",
            }}
          >
            <defs>
              <linearGradient
                id={`lineGradient-${uid}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop
                  offset="0%"
                  style={{ stopColor: graphColor, stopOpacity: 0.3 }}
                />
                <stop
                  offset="100%"
                  style={{ stopColor: graphColor, stopOpacity: 1 }}
                />
              </linearGradient>
              <linearGradient
                id={`fillGradient-${uid}`}
                x1="0%"
                y1="0%"
                x2="100%"
                y2="0%"
              >
                <stop
                  offset="0%"
                  style={{ stopColor: graphColor, stopOpacity: 0.05 }}
                />
                <stop
                  offset="100%"
                  style={{ stopColor: graphColor, stopOpacity: 0.15 }}
                />
              </linearGradient>
            </defs>
            <polygon points={fillPoints} fill={`url(#fillGradient-${uid})`} />
            <line
              x1="0"
              y1={avgY}
              x2="100"
              y2={avgY}
              stroke={graphColor}
              strokeWidth="1"
              strokeDasharray="2,2"
              opacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={linePoints}
              fill="none"
              stroke={`url(#lineGradient-${uid})`}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      )}
    </div>
  );
});

export default GraphPanel;
