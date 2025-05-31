import React, { memo, useEffect, useRef } from "react";

export const Note = memo(({ note, registerRef }) => {
  const noteRef = useRef();

  // ref 등록
  useEffect(() => {
    registerRef(note.id, noteRef.current);

    return () => {
      registerRef(note.id, null);
    };
  }, [note.id, registerRef]);

  // 초기 스타일
  const initialStyle = {
    position: "absolute",
    bottom: "0px",
    left: "50%",
    transform: "translateX(-50%) translateZ(0)",
    width: "100%",
    height: "6px",
    backgroundColor: note.color || "#ffffff",
    // borderRadius: note.isActive ? "2px 2px 0 0" : "2px",
    borderRadius: "2px",
    opacity: 0.8,
    zIndex: 10,
    // boxShadow: note.isActive
    //   ? "0 0 4px rgba(255, 255, 255, 0.5)"
    //   : "0 0 2px rgba(255, 255, 255, 0.3)",
    // GPU 가속 설정
    willChange: "height, bottom, opacity, border-radius",
    backfaceVisibility: "hidden",
  };

  return <div ref={noteRef} style={initialStyle} />;
});
