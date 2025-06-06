import React, { memo, useEffect, useRef } from "react";
import { Note } from "./Note";
import { FLOW_SPEED } from "@hooks/useNoteSystem";

export const Track = memo(
  ({ notes, width, height, position, noteColor, noteOpacity }) => {
    const trackRef = useRef();
    const animationRef = useRef();
    const noteRefsRef = useRef(new Map());
    const lastFrameDataRef = useRef(new Map()); // 이전 프레임 데이터 캐시
    const isAnimatingRef = useRef(false); // 애니메이션 상태 추적    // 트랙 전체의 노트들을 한 번에 애니메이션
    useEffect(() => {
      const flowSpeed = FLOW_SPEED;
      const minNoteHeight = 0;
      const fadeZoneHeight = 50;
      const baseOpacity = (noteOpacity || 80) / 100;
      let lastTime = 0;
      let frameCount = 0;

      // 동적 프레임 레이트 감지 (모니터 주사율에 자동 대응)
      let detectedRefreshRate = 144; // 기본값을 144Hz로 설정
      let frameTimeSum = 0;
      let lastFrameTime = 0;

      // 객체 풀링으로 메모리 할당 최소화
      const updatePool = Array.from({ length: 50 }, () => ({}));
      let poolIndex = 0;

      // 모니터 주사율 자동 감지 (최적화된 버전)
      const detectRefreshRate = (currentTime) => {
        if (lastFrameTime > 0) {
          const frameDelta = currentTime - lastFrameTime;
          frameTimeSum += frameDelta;
          frameCount++;

          // 30프레임마다 주사율 재계산
          if (frameCount >= 30) {
            const avgFrameTime = frameTimeSum / frameCount;
            const newRefreshRate = Math.round(1000 / avgFrameTime);

            // 일반적인 주사율 범위로 제한하고 300Hz 상한 적용
            if (newRefreshRate >= 60 && newRefreshRate <= 300) {
              detectedRefreshRate = newRefreshRate;
            }

            frameTimeSum = 0;
            frameCount = 0;
          }
        }
        lastFrameTime = currentTime;
      }; // 트랙에 페이드 마스크 적용 (한 번만)
      if (trackRef.current && !trackRef.current.maskApplied) {
        const fadeStartFromBottom = height - fadeZoneHeight;
        const trackMask = `linear-gradient(to top, 
        rgba(0,0,0,1) 0%, 
        rgba(0,0,0,1) ${fadeStartFromBottom}px,
        rgba(0,0,0,0) ${height}px)`;

        trackRef.current.style.mask = trackMask;
        trackRef.current.maskApplied = true;
      }

      const animate = (currentTime) => {
        // 애니메이션이 이미 실행 중이면 중복 실행 방지
        if (isAnimatingRef.current) return;
        isAnimatingRef.current = true;

        // 동적 주사율 감지
        detectRefreshRate(currentTime);
        const frameInterval = 1000 / (detectedRefreshRate + 10); // 약간의 여유 추가

        // 적응형 프레임 레이트 제한
        if (currentTime - lastTime < frameInterval) {
          isAnimatingRef.current = false;
          if (notes.length > 0) {
            animationRef.current = requestAnimationFrame(animate);
          }
          return;
        }
        lastTime = currentTime;

        // 객체 풀 초기화
        poolIndex = 0;
        const notesToUpdate = [];

        // 고성능 루프로 노트 처리
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          const noteElement = noteRefsRef.current.get(note.id);
          if (!noteElement) continue;

          const lastData = lastFrameDataRef.current.get(note.id) || {};

          // 객체 풀에서 재사용
          let updates =
            poolIndex < updatePool.length ? updatePool[poolIndex++] : {};

          // 객체 초기화
          for (let key in updates) {
            delete updates[key];
          }

          if (note.isActive) {
            // 활성 노트 - 계산 최적화
            const pressDuration = currentTime - note.startTime;
            const noteLength = Math.max(
              minNoteHeight,
              (pressDuration * flowSpeed) / 1000
            );
            const roundedLength = Math.round(noteLength * 10) / 10;

            // 변경된 값만 추적
            if (Math.abs(lastData.height - roundedLength) > 0.05) {
              updates.height = `${roundedLength}px`;
            }
            if (lastData.bottom !== "0px") {
              updates.bottom = "0px";
            }
            if (Math.abs(lastData.opacity - baseOpacity) > 0.01) {
              updates.opacity = baseOpacity;
            }
            if (lastData.backgroundColor !== noteColor) {
              updates.backgroundColor = noteColor || "#FFFFFF";
            }

            if (Object.keys(updates).length > 0) {
              notesToUpdate.push({ element: noteElement, updates });

              // 캐시 업데이트
              lastFrameDataRef.current.set(note.id, {
                height: roundedLength,
                bottom: "0px",
                opacity: baseOpacity,
                backgroundColor: noteColor || "#FFFFFF",
              });
            }
          } else {
            // 완성된 노트 - 계산 최적화
            const noteDuration = note.endTime - note.startTime;
            const noteLength = Math.max(
              minNoteHeight,
              (noteDuration * flowSpeed) / 1000
            );
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

            const roundedLength = Math.round(noteLength * 10) / 10;
            const roundedPosition = Math.round(yPosition * 10) / 10;

            // 화면 밖으로 나가는 추가 페이드아웃
            let opacity = baseOpacity;
            const screenFadeStart = height;
            if (yPosition > screenFadeStart) {
              const fadeProgress = (yPosition - screenFadeStart) / 50;
              opacity = baseOpacity * (1 - Math.min(fadeProgress, 1));
            }

            // 변경된 값만 추적
            if (Math.abs(lastData.height - roundedLength) > 0.05) {
              updates.height = `${roundedLength}px`;
            }
            if (Math.abs(lastData.bottom - roundedPosition) > 0.05) {
              updates.bottom = `${roundedPosition}px`;
            }
            if (Math.abs(lastData.opacity - opacity) > 0.01) {
              updates.opacity = opacity;
            }

            if (Object.keys(updates).length > 0) {
              notesToUpdate.push({ element: noteElement, updates });

              // 캐시 업데이트
              lastFrameDataRef.current.set(note.id, {
                height: roundedLength,
                bottom: roundedPosition,
                opacity: opacity,
              });
            }
          }
        }

        // 배치 DOM 업데이트 실행 - Object.assign 사용으로 최적화
        if (notesToUpdate.length > 0) {
          for (let i = 0; i < notesToUpdate.length; i++) {
            const { element, updates } = notesToUpdate[i];
            Object.assign(element.style, updates);
          }
        }

        isAnimatingRef.current = false;

        if (notes.length > 0) {
          animationRef.current = requestAnimationFrame(animate);
        }
      }; // 노트가 있을 때만 애니메이션 시작
      if (notes.length > 0 && !animationRef.current) {
        animationRef.current = requestAnimationFrame(animate);
      }

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        // 정리 시 캐시도 초기화
        lastFrameDataRef.current.clear();
        isAnimatingRef.current = false;
      };
    }, [notes, height, noteColor, noteOpacity]);

    // 노트 ref 등록 함수
    const registerNoteRef = (noteId, element) => {
      if (element) {
        noteRefsRef.current.set(noteId, element);
      } else {
        noteRefsRef.current.delete(noteId);
        lastFrameDataRef.current.delete(noteId); // 캐시도 정리
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
            noteColor={noteColor}
            noteOpacity={noteOpacity}
          />
        ))}
      </div>
    );
  }
);
