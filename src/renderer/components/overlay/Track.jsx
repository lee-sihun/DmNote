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
    const fadeZoneHeight = 50; // 페이드 아웃 시작 높이

    // 트랙에 페이드 마스크 적용
    if (trackRef.current) {
      const fadeStartFromBottom = height - fadeZoneHeight;
      const trackMask = `linear-gradient(to top, 
        rgba(0,0,0,1) 0%, 
        rgba(0,0,0,1) ${fadeStartFromBottom}px, 
        rgba(0,0,0,0) ${height}px)`;

      trackRef.current.style.mask = trackMask;
    }

    const animate = (currentTime) => {
      notes.forEach((note) => {
        const noteElement = noteRefsRef.current.get(note.id);
        if (!noteElement) return;

        const startTime = note.startTime;
        const endTime = note.isActive ? currentTime : note.endTime;

        if (note.isActive) {
          // 활성 노트
          const pressDuration = currentTime - startTime;
          const noteLength = Math.max(
            minNoteHeight,
            (pressDuration * flowSpeed) / 1000
          );

          noteElement.style.height = `${Math.round(noteLength)}px`;
          noteElement.style.bottom = "0px";
          noteElement.style.opacity = "0.8";
          noteElement.style.borderRadius = "2px";
          // 개별 노트 마스크 제거 (트랙 마스크 사용)
          noteElement.style.mask = "none";
        } else {
          // 완성된 노트
          const noteDuration = endTime - startTime;
          const noteLength = Math.max(
            minNoteHeight,
            (noteDuration * flowSpeed) / 1000
          );

          const timeSinceCompletion = currentTime - endTime;
          const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

          noteElement.style.height = `${Math.round(noteLength)}px`;
          noteElement.style.bottom = `${Math.round(yPosition)}px`;

          // 화면 밖으로 나가는 추가 페이드아웃만 적용
          const screenFadeStart = height;
          let opacity = 0.8;

          if (yPosition > screenFadeStart) {
            const fadeProgress = (yPosition - screenFadeStart) / 50;
            opacity = 0.8 * (1 - Math.min(fadeProgress, 1));
          }

          noteElement.style.opacity = opacity;
          noteElement.style.mask = "none";
          noteElement.style.borderRadius = "2px";
        }
      });

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
    // borderRadius: "4px",
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
