import React, { memo, useEffect, useRef } from "react";

export const Note = memo(
  ({ note, registerRef, noteColor, noteOpacity }) => {
    const noteRef = useRef();

    // ref 등록 - 최소한의 effect만 사용
    useEffect(() => {
      if (noteRef.current) {
        registerRef(note.id, noteRef.current);
      }

      return () => {
        registerRef(note.id, null);
      };
    }, [note.id, registerRef]);

    // 초기 스타일 - GPU 가속 최적화
    const initialStyle = {
      position: "absolute",
      bottom: "0px",
      left: "50%",
      width: "100%",
      height: "0px",
      backgroundColor: noteColor || "#ffffff",
      borderRadius: "2px",
      opacity: (noteOpacity || 80) / 100,
      zIndex: 10,
      // GPU 가속 최적화 - 더 강력한 최적화
      willChange: "height, bottom, opacity",
      backfaceVisibility: "hidden",
      transform: "translateX(-50%) translateZ(0)",
      // 추가 GPU 레이어 최적화
      contain: "layout style paint",
      isolation: "isolate",
    };

    return <div ref={noteRef} style={initialStyle} />;
  },
  (prevProps, nextProps) => {
    // 매우 엄격한 메모이제이션 - ID와 색상이 같으면 절대 리렌더링하지 않음
    return (
      prevProps.note.id === nextProps.note.id &&
      prevProps.noteColor === nextProps.noteColor &&
      prevProps.noteOpacity === nextProps.noteOpacity
    );
  }
);
