import React, { memo, useEffect, useRef } from "react";

export const Note = memo(
  ({ note, registerRef, noteColor, noteOpacity, borderRadius }) => {
    const noteRef = useRef();

    // ref 등록
    useEffect(() => {
      registerRef(note.id, noteRef.current);

      return () => {
        registerRef(note.id, null);
      };
    }, [note.id, registerRef]);

    // 초기 스타일
    const br =
      Number.isFinite(Number(borderRadius)) && Number(borderRadius) >= 0
        ? Number(borderRadius)
        : 2;

    const initialStyle = {
      position: "absolute",
      bottom: "0px",
      left: "50%",
      transform: "translateX(-50%) translateZ(0)",
      width: "100%",
      height: "0px",
      backgroundColor: noteColor || "#ffffff",
      borderRadius: `${br}px`,
      opacity: (noteOpacity || 80) / 100,
      zIndex: 10,
      // GPU 가속 설정
      willChange: "height, bottom, opacity, border-radius",
      backfaceVisibility: "hidden",
    };

    return <div ref={noteRef} style={initialStyle} />;
  }
);
