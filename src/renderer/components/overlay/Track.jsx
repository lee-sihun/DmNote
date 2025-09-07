import React, { memo, useEffect, useRef } from "react";
import { animationScheduler } from "../../utils/animationScheduler";

export const Track = memo(
  ({
    trackKey,
    notesRef,
    subscribe,
    width,
    height,
    position,
    noteColor,
    noteOpacity,
    flowSpeed,
    borderRadius,
  }) => {
    const canvasRef = useRef();
    const trackRef = useRef();

    // 트랙 상단 글로벌 마스크 
    useEffect(() => {
      if (!trackRef.current) return;
      const fadeZoneHeight = 50; // 고정 상단 페이드 영역
      const fadeStartFromBottom = height - fadeZoneHeight; // px 위치
      const defaultMask = `linear-gradient(to top, rgba(0,0,0,1) 0px, rgba(0,0,0,1) ${fadeStartFromBottom}px, rgba(0,0,0,0) ${height}px)`;
      trackRef.current.style.maskImage = `var(--track-mask, ${defaultMask})`;
      trackRef.current.style.webkitMaskImage = `var(--track-mask, ${defaultMask})`;
    }, [height]);

    // 노트
    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const currentSpeed = flowSpeed || 180;
      const minNoteHeight = 0;
      const baseOpacity = (noteOpacity || 80) / 100;
      const color = noteColor || "#FFFFFF";
      const noteRadius = borderRadius ?? 2;

      // roundRect 폴리필
      if (!ctx.roundRect) {
        ctx.roundRect = function (x, y, w, h, r) {
          this.beginPath();
          this.moveTo(x + r, y);
          this.lineTo(x + w - r, y);
          this.quadraticCurveTo(x + w, y, x + w, y + r);
          this.lineTo(x + w, y + h - r);
          this.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          this.lineTo(x + r, y + h);
          this.quadraticCurveTo(x, y + h, x, y + h - r);
          this.lineTo(x, y + r);
          this.quadraticCurveTo(x, y, x + r, y);
          this.closePath();
        };
      }

      let rgbaColor = color;
      if (color.startsWith("#")) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        rgbaColor = `rgba(${r},${g},${b},${baseOpacity})`;
      }

      const draw = (currentTime) => {
        ctx.clearRect(0, 0, width, height);
        const notes = notesRef.current[trackKey] || [];

        ctx.fillStyle = rgbaColor; 

        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          const startTime = note.startTime;
          const endTime = note.isActive ? currentTime : note.endTime;

          let noteLength, yPosition;
          if (note.isActive) {
            const pressDuration = currentTime - startTime;
            noteLength = Math.max(
              minNoteHeight,
              (pressDuration * currentSpeed) / 1000
            );
            yPosition = height - noteLength;
          } else {
            const noteDuration = endTime - startTime;
            noteLength = Math.max(
              minNoteHeight,
              (noteDuration * currentSpeed) / 1000
            );
            const timeSinceCompletion = currentTime - endTime;
            const moveDistance = (timeSinceCompletion * currentSpeed) / 1000;
            yPosition = height - noteLength - moveDistance;
            if (yPosition + noteLength < 0) continue; // 위로 완전히 사라짐
          }
          if (noteLength <= 0) continue;

          if (noteRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(0, yPosition, width, noteLength, noteRadius);
            ctx.fill();
          } else {
            ctx.fillRect(0, yPosition, width, noteLength);
          }
        }
      };

      const handleNotesChange = () => {
        const currentNotes = notesRef.current[trackKey] || [];
        if (currentNotes.length > 0) {
          animationScheduler.add(draw);
        } else {
          animationScheduler.remove(draw);
        }
      };

      handleNotesChange();
      const unsubscribe = subscribe(handleNotesChange);
      return () => {
        unsubscribe();
        animationScheduler.remove(draw); // 컴포넌트 언마운트 시 반드시 제거
      };
    }, [
      trackKey,
      notesRef,
      subscribe,
      width,
      height,
      noteColor,
      noteOpacity,
      flowSpeed,
      borderRadius,
    ]);

    const trackStyle = {
      position: "absolute",
      left: `${position.dx}px`,
      top: `${position.dy - height}px`,
      width: `${width}px`,
      height: `${height}px`,
      backgroundColor: `var(--track-bg, transparent)`,
      border: `var(--track-border, none)`,
      borderRadius: `var(--track-radius, 0px)`,
      overflow: `var(--track-overflow, hidden)`,
      pointerEvents: `var(--track-pointer-events, none)`,
      boxShadow: `var(--track-shadow, none)`,
      willChange: "transform",
      backfaceVisibility: "hidden",
      transform: "translateZ(0)",
    };

    return (
      <div
        ref={trackRef}
        style={trackStyle}
        className={position?.className || ""}
        data-state="track-canvas"
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </div>
    );
  }
);
