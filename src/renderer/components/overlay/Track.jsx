import React, { memo, useEffect, useRef } from "react";
import { Note } from "./Note";

export const Track = memo(({ notes, width, height, position }) => {
  // const animationRef = useRef();
  // const trackRef = useRef();
  // const flowOffsetRef = useRef(0);
  // const lastTimeRef = useRef(0);

  // // CSS Transform을 사용한 애니메이션 (React 상태 없이)
  // useEffect(() => {
  //   const flowSpeed = 50; // 픽셀/초

  //   const animate = (currentTime) => {
  //     if (lastTimeRef.current === 0) {
  //       lastTimeRef.current = currentTime;
  //     }

  //     const deltaTime = currentTime - lastTimeRef.current;
  //     lastTimeRef.current = currentTime;

  //     // 직접 DOM 조작으로 부드러운 애니메이션
  //     flowOffsetRef.current =
  //       (flowOffsetRef.current + (flowSpeed * deltaTime) / 1000) % 12;

  //     if (trackRef.current) {
  //       // CSS transform을 사용해서 GPU 가속 활용
  //       trackRef.current.style.backgroundPosition = `0 ${
  //         -Math.round(flowOffsetRef.current * 10) / 10
  //       }px`;
  //     }

  //     animationRef.current = requestAnimationFrame(animate);
  //   };

  //   animationRef.current = requestAnimationFrame(animate);

  //   return () => {
  //     if (animationRef.current) {
  //       cancelAnimationFrame(animationRef.current);
  //     }
  //   };
  // }, []);

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
    // GPU 레이어 강제 생성
    willChange: "background-position",
    backfaceVisibility: "hidden",
    transform: "translateZ(0)", // GPU 레이어 활성화
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
  };

  return (
    // <div ref={trackRef} style={trackStyle}>
    <div style={trackStyle}>
      {notes.map((note) => (
        <Note key={note.id} note={note} trackHeight={height} />
      ))}
    </div>
  );
});
