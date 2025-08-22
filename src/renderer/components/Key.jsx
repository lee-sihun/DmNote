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
      backgroundColor: inactiveImage ? "transparent" : "rgba(46, 46, 47, 0.9)",
      borderRadius: inactiveImage ? "0" : "10px",
      border: inactiveImage ? "none" : "3px solid rgba(113, 113, 113, 0.9)",
      overflow: inactiveImage ? "visible" : "hidden",
      willChange: "transform",
      backfaceVisibility: "hidden",
      transformStyle: "preserve-3d",
      contain: "layout style paint",
      imageRendering: "auto",
      isolation: "isolate",
      boxSizing: "border-box",
    }),
    [renderDx, renderDy, width, height, inactiveImage]
  );

  const imageStyle = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      pointerEvents: "none",
      userSelect: "none",
    }),
    []
  );

  const textStyle = useMemo(
    () => ({
      willChange: "auto",
      contain: "layout style paint",
    }),
    []
  );

  return (
    <div
      ref={draggable.ref}
      className="absolute cursor-pointer"
      style={keyStyle}
      onClick={handleClick}
      onDragStart={(e) => e.preventDefault()}
    >
      {inactiveImage ? (
        <img src={inactiveImage} alt="" style={imageStyle} draggable={false} />
      ) : (
        <div
          className="flex items-center justify-center h-full font-bold text-[#717171]"
          style={textStyle}
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

    const currentImage =
      active && activeImage
        ? activeImage
        : !active && inactiveImage
        ? inactiveImage
        : null;

    const keyStyle = useMemo(
      () => ({
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate3d(${dx}px, ${dy}px, 0)`,
        backgroundColor:
          (active && activeImage) || (!active && inactiveImage)
            ? "transparent"
            : active
            ? "rgba(121, 121, 121, 0.9)"
            : "rgba(46, 46, 47, 0.9)",
        borderRadius: active
          ? activeImage
            ? "0"
            : "10px"
          : inactiveImage
          ? "0"
          : "10px",
        border:
          activeImage || inactiveImage
            ? "none" 
            : active
            ? "3px solid rgba(255, 255, 255, 0.9)"
            : "3px solid rgba(113, 113, 113, 0.9)",
        color: active && !activeImage ? "#FFFFFF" : "rgba(121, 121, 121, 0.9)",
        overflow: currentImage ? "visible" : "hidden",
        // GPU 가속 최적화 강화
        willChange: "transform, background-color",
        backfaceVisibility: "hidden",
        transformStyle: "preserve-3d",
        contain: "layout style paint",
        // 이미지 렌더링 최적화
        imageRendering: "auto",
        isolation: "isolate",
        boxSizing: "border-box",
      }),
      [active, activeImage, inactiveImage, dx, dy, width, height, currentImage]
    );

    const imageStyle = useMemo(
      () => ({
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
        pointerEvents: "none",
        userSelect: "none",
      }),
      []
    );

    const textStyle = useMemo(
      () => ({
        willChange: "auto",
        contain: "layout style paint",
      }),
      []
    );

    // 텍스트 표시 조건
    const showText = (!active && !inactiveImage) || (active && !activeImage);

    return (
      <div className="absolute" style={keyStyle}>
        {currentImage ? (
          <img src={currentImage} alt="" style={imageStyle} draggable={false} />
        ) : showText ? (
          <div
            className="flex items-center justify-center h-full font-bold"
            style={textStyle}
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
