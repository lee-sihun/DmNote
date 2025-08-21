import React, { memo, useMemo } from "react";
import { useDraggable } from "@hooks/useDraggable";
import { getKeyInfoByGlobalKey } from "@utils/KeyMaps";

export default function DraggableKey({
  index,
  position,
  keyName,
  onPositionChange,
  onClick,
}) {
  const { displayName } = getKeyInfoByGlobalKey(keyName);
  const { dx, dy, width, height = 60, activeImage, inactiveImage } = position;
  const draggable = useDraggable({
    gridSize: 5,
    initialX: dx,
    initialY: dy,
    onPositionChange: (newDx, newDy) => onPositionChange(index, newDx, newDy),
  });

  const handleClick = (e) => {
    if (!draggable.wasMoved) onClick(e);
  };

  // 드래그 중에는 훅의 dx/dy 사용 (부모 리렌더 최소화)
  const renderDx = draggable.dx;
  const renderDy = draggable.dy;

  const keyStyle = useMemo(
    () => ({
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(${renderDx}px, ${renderDy}px, 0)`,
      backgroundImage: inactiveImage ? `url(${inactiveImage})` : "none",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundColor: inactiveImage ? "transparent" : "white",
      willChange: "transform",
      backfaceVisibility: "hidden",
      transformStyle: "preserve-3d",
      contain: "layout style paint",
      imageRendering: "auto",
      isolation: "isolate",
      WebkitFontSmoothing: "antialiased",
      MozOsxFontSmoothing: "grayscale",
    }),
    [renderDx, renderDy, width, height, inactiveImage]
  );

  return (
    <div
      ref={draggable.ref}
      className="absolute rounded-[6px] cursor-pointer"
      style={keyStyle}
      onClick={handleClick}
      onDragStart={(e) => e.preventDefault()}
    >
      {!inactiveImage && (
        <div
          className="flex items-center justify-center h-full font-semibold"
          style={{ willChange: "auto", contain: "layout style paint" }}
        >
          {displayName}
        </div>
      )}
    </div>
  );
}

export const Key = memo(
  ({ keyName, active, position }) => {
    const { dx, dy, width, height = 60, activeImage, inactiveImage } = position;

    const keyStyle = useMemo(
      () => ({
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${dx}px, ${dy}px, 0)`,
        backgroundColor:
          (active && activeImage) || (!active && inactiveImage)
            ? "transparent"
            : active
            ? "#575757"
            : "white",
        borderRadius: active
          ? activeImage ? "0" : "6px"
          : inactiveImage ? "0" : "6px",
        color: active && !activeImage ? "white" : "black",
        backgroundImage:
          active && activeImage
            ? `url(${activeImage})`
            : !active && inactiveImage
            ? `url(${inactiveImage})`
            : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
        // GPU 가속 최적화 강화
        willChange: "transform, background-color, background-image",
        backfaceVisibility: "hidden",
        transformStyle: "preserve-3d",
        contain: "layout style paint",
        // 이미지 렌더링 최적화
        imageRendering: "auto",
        isolation: "isolate",
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
      }),
      [active, activeImage, inactiveImage, dx, dy, width, height]
    );

    return (
      <div className="image-rendering absolute rounded-[6px]" style={keyStyle}>
        {(!active && !inactiveImage) || (active && !activeImage) ? (
          <div 
            className="flex items-center justify-center h-full font-semibold"
            style={{
              willChange: "auto",
              contain: "layout style paint",
            }}
          >
            {keyName}
          </div>
        ) : null}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // position 객체 속성 비교
    return (
      prevProps.active === nextProps.active &&
      prevProps.keyName === nextProps.keyName &&
      prevProps.position.dx === nextProps.position.dx &&
      prevProps.position.dy === nextProps.position.dy &&
      prevProps.position.width === nextProps.position.width &&
      prevProps.position.height === nextProps.position.height &&
      prevProps.position.activeImage === nextProps.position.activeImage &&
      prevProps.position.inactiveImage === nextProps.position.inactiveImage
    );
  }
);