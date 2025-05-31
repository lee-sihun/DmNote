import React, { memo, useEffect, useRef } from "react";
import { Note } from "./Note";
import { FLOW_SPEED } from "@hooks/useNoteSystem";

export const Track = memo(({ notes, width, height, position }) => {
  const trackRef = useRef();
  const animationRef = useRef();
  const noteRefsRef = useRef(new Map());

  // 트랙 전체의 노트들을 한 번에 애니메이션
  useEffect(() => {
    const flowSpeed = FLOW_SPEED;
    const minNoteHeight = 6; // 최소 노트 높이

    const animate = (currentTime) => {
      // 모든 노트들을 한 번에 업데이트
      notes.forEach((note) => {
        const noteElement = noteRefsRef.current.get(note.id);
        if (!noteElement) return;

        const startTime = note.startTime;
        const endTime = note.isActive ? currentTime : note.endTime;

        if (note.isActive) {
          // 활성 노트: 높이만 변경
          const pressDuration = currentTime - startTime;
          const noteLength = Math.max(minNoteHeight, (pressDuration * flowSpeed) / 1000);

          noteElement.style.height = `${Math.round(noteLength)}px`;
          noteElement.style.bottom = "0px";
          // noteElement.style.opacity = "1";
          noteElement.style.opacity = "0.8";
        } else {
          // 완성된 노트: 위치 변경
          const noteDuration = endTime - startTime;
          const noteLength = Math.max(minNoteHeight, (noteDuration * flowSpeed) / 1000);

          const timeSinceCompletion = currentTime - endTime;
          const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

          const opacity =
            yPosition > height ? Math.max(0, 1 - (yPosition - height) / 50) : 1;

          noteElement.style.height = `${Math.round(noteLength)}px`;
          noteElement.style.bottom = `${Math.round(yPosition)}px`;
          // noteElement.style.opacity = opacity;
          noteElement.style.opacity = "0.8";
        }
      });

      // 노트가 있을 때만 계속 애니메이션
      if (notes.length > 0) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    // 노트가 있을 때만 애니메이션 시작
    if (notes.length > 0) {
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [notes, height]); // notes 배열이 변경될 때마다 재시작

  // 노트 ref 등록 함수
  const registerNoteRef = (noteId, element) => {
    if (element) {
      noteRefsRef.current.set(noteId, element);
    } else {
      noteRefsRef.current.delete(noteId);
    }
  };

  const trackStyle = {
    position: "absolute",
    left: `${position.dx}px`,
    top: `${position.dy - height}px`,
    width: `${width}px`,
    height: `${height}px`,
    // backgroundColor: "rgba(255, 255, 255, 0.05)",
    // border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "4px",
    overflow: "hidden",
    pointerEvents: "none",
    willChange: "contents",
    backfaceVisibility: "hidden",
    transform: "translateZ(0)",
  };

  return (
    <div ref={trackRef} style={trackStyle}>
      {notes.map((note) => (
        <Note
          key={note.id}
          note={note}
          trackHeight={height}
          registerRef={registerNoteRef}
        />
      ))}
    </div>
  );
});
