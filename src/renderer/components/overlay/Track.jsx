import React, { memo, useEffect, useState } from "react";
import { Note } from "./Note";

export const Track = memo(({ notes, width, height, position }) => {
  const [flowOffset, setFlowOffset] = useState(0);

  // 트랙이 항상 위로 흘러가는 애니메이션
  useEffect(() => {
    let animationId;
    const flowSpeed = 50; // 픽셀/초 (속도 조절 가능)

    const animate = (timestamp) => {
      setFlowOffset((prev) => (prev + flowSpeed / 60) % height); // 60fps 기준
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [height]);

  const trackStyle = {
    position: "absolute",
    left: `${position.dx}px`,
    top: `${position.dy - height}px`,
    width: `${width}px`,
    height: `${height}px`,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "4px",
    overflow: "hidden",
    pointerEvents: "none",
    // 흐르는 효과를 위한 배경 패턴
    // backgroundImage: `
    //   repeating-linear-gradient(
    //     0deg,
    //     rgba(255, 255, 255, 0.1) 0px,
    //     rgba(255, 255, 255, 0.1) 2px,
    //     transparent 2px,
    //     transparent 10px
    //   )
    // `,
    // backgroundSize: "100% 12px",
    // backgroundPosition: `0 ${-flowOffset}px`,
  };

  return (
    <div style={trackStyle}>
      {notes.map((note) => (
        <Note
          key={note.id}
          note={note}
          trackHeight={height}
          flowOffset={flowOffset}
        />
      ))}
    </div>
  );
});
