import React, { memo, useEffect, useRef } from "react";
import { FLOW_SPEED } from "@hooks/useNoteSystem";

export const Track = memo(
  ({ notes, width, height, position, noteColor, noteOpacity }) => {
    const trackRef = useRef();
    const animationRef = useRef();
    const noteElementsRef = useRef(new Map());
    const isAnimatingRef = useRef(false);
    
    useEffect(() => {
      const flowSpeed = FLOW_SPEED;
      const baseOpacity = (noteOpacity || 80) / 100;
      let lastTime = 0;
      
      // 고정 240Hz - 최고 성능 타겟
      const TARGET_FPS = 240;
      const frameInterval = 1000 / TARGET_FPS;
      
      // DOM 요소 직접 생성 (React 우회)
      const createNoteElement = (note) => {
        const element = document.createElement('div');
        element.style.cssText = `
          position: absolute;
          left: 0;
          width: 100%;
          background-color: ${noteColor || '#ffffff'};
          border-radius: 2px;
          will-change: transform;
          backface-visibility: hidden;
          contain: strict;
          transform-origin: bottom;
        `;
        noteElementsRef.current.set(note.id, element);
        if (trackRef.current) {
          trackRef.current.appendChild(element);
        }
        return element;
      };

      const animate = (currentTime) => {
        // 중복 실행 방지
        if (isAnimatingRef.current) return;
        
        // 고정 프레임 제한
        if (currentTime - lastTime < frameInterval) {
          if (notes.length > 0) {
            animationRef.current = requestAnimationFrame(animate);
          }
          return;
        }
        
        isAnimatingRef.current = true;
        lastTime = currentTime;

        // 현재 노트 ID 집합
        const currentNoteIds = new Set(notes.map(note => note.id));
        
        // 제거된 노트 정리
        for (const [noteId, element] of noteElementsRef.current) {
          if (!currentNoteIds.has(noteId)) {
            element.remove();
            noteElementsRef.current.delete(noteId);
          }
        }

        // 노트 업데이트 (최적화된 루프)
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          let element = noteElementsRef.current.get(note.id);
          
          if (!element) {
            element = createNoteElement(note);
          }

          // Transform만 사용 (레이아웃 리플로우 없음)
          if (note.isActive) {
            const pressDuration = currentTime - note.startTime;
            const noteLength = Math.max(2, (pressDuration * flowSpeed) / 1000);
            
            element.style.transform = `translateY(${-noteLength}px) translateZ(0)`;
            element.style.height = `${noteLength}px`;
            element.style.opacity = baseOpacity;
          } else {
            const noteDuration = note.endTime - note.startTime;
            const noteLength = Math.max(2, (noteDuration * flowSpeed) / 1000);
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
            
            let opacity = baseOpacity;
            if (yPosition > height) {
              const fadeProgress = Math.min((yPosition - height) / 50, 1);
              opacity = baseOpacity * (1 - fadeProgress);
            }
            
            element.style.transform = `translateY(${yPosition}px) translateZ(0)`;
            element.style.height = `${noteLength}px`;
            element.style.opacity = opacity;
          }
        }

        isAnimatingRef.current = false;
        
        if (notes.length > 0) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      // 애니메이션 시작
      if (notes.length > 0 && !animationRef.current) {
        animationRef.current = requestAnimationFrame(animate);
      }

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        
        // 모든 노트 요소 정리
        for (const element of noteElementsRef.current.values()) {
          element.remove();
        }
        noteElementsRef.current.clear();
        isAnimatingRef.current = false;
      };
    }, [notes, height, noteColor, noteOpacity]);

    const trackStyle = {
      position: "absolute",
      left: `${position.dx}px`,
      top: `${position.dy - height}px`,
      width: `${width}px`,
      height: `${height}px`,
      overflow: "hidden",
      pointerEvents: "none",
      willChange: "transform",
      backfaceVisibility: "hidden",
      transform: "translateZ(0)",
      contain: "layout style paint",
    };

    // React 컴포넌트 제거, DOM 직접 조작만 사용
    return <div ref={trackRef} style={trackStyle} />;
  }
);

Track.displayName = "Track";// 트랙에 페이드 마스크 적용 (한 번만)
      if (trackRef.current && !trackRef.current.maskApplied) {
        const fadeStartFromBottom = height - fadeZoneHeight;
        const trackMask = `linear-gradient(to top, 
        rgba(0,0,0,1) 0%, 
        rgba(0,0,0,1) ${fadeStartFromBottom}px,
        rgba(0,0,0,0) ${height}px)`;

        trackRef.current.style.mask = trackMask;
        trackRef.current.maskApplied = true;
      }      const animate = (currentTime) => {
        const frameStart = performance.now();
        
        // 애니메이션이 이미 실행 중이면 중복 실행 방지
        if (isAnimatingRef.current) return;
        isAnimatingRef.current = true;

        // 동적 주사율 감지
        updateRefreshRate(currentTime);
        const frameInterval = 1000 / detectedRefreshRate;

        // 적응형 프레임 레이트 제한
        if (currentTime - lastTime < frameInterval) {
          isAnimatingRef.current = false;
          if (notes.length > 0) {
            animationRef.current = requestAnimationFrame(animate);
          }
          return;
        }
        lastTime = currentTime;

        const calcStart = performance.now();
        
        // 노트 업데이트 - 더 간단한 접근
        const updates = new Map();
        
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          const noteElement = noteRefsRef.current.get(note.id);
          if (!noteElement) continue;

          const lastData = lastFrameDataRef.current.get(note.id);
          let needsUpdate = false;
          const newStyle = {};

          if (note.isActive) {
            // 활성 노트
            const pressDuration = currentTime - note.startTime;
            const noteLength = Math.max(minNoteHeight, (pressDuration * flowSpeed) / 1000);
            const roundedLength = Math.round(noteLength);

            if (!lastData || Math.abs(lastData.height - roundedLength) > 0) {
              newStyle.height = `${roundedLength}px`;
              needsUpdate = true;
            }
            if (!lastData || lastData.bottom !== 0) {
              newStyle.bottom = "0px";
              needsUpdate = true;
            }
            if (!lastData || Math.abs(lastData.opacity - baseOpacity) > 0.01) {
              newStyle.opacity = baseOpacity;
              needsUpdate = true;
            }
            if (!lastData || lastData.backgroundColor !== noteColor) {
              newStyle.backgroundColor = noteColor || "#FFFFFF";
              needsUpdate = true;
            }

            if (needsUpdate) {
              updates.set(noteElement, newStyle);
              lastFrameDataRef.current.set(note.id, {
                height: roundedLength,
                bottom: 0,
                opacity: baseOpacity,
                backgroundColor: noteColor || "#FFFFFF",
              });
            }
          } else {
            // 완성된 노트
            const noteDuration = note.endTime - note.startTime;
            const noteLength = Math.max(minNoteHeight, (noteDuration * flowSpeed) / 1000);
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

            const roundedLength = Math.round(noteLength);
            const roundedPosition = Math.round(yPosition);

            // 페이드아웃 계산
            let opacity = baseOpacity;
            if (yPosition > height) {
              const fadeProgress = (yPosition - height) / 50;
              opacity = baseOpacity * (1 - Math.min(fadeProgress, 1));
            }

            if (!lastData || 
                Math.abs(lastData.height - roundedLength) > 0 ||
                Math.abs(lastData.bottom - roundedPosition) > 0 ||
                Math.abs(lastData.opacity - opacity) > 0.01) {
              
              newStyle.height = `${roundedLength}px`;
              newStyle.bottom = `${roundedPosition}px`;
              newStyle.opacity = opacity;
              
              updates.set(noteElement, newStyle);
              lastFrameDataRef.current.set(note.id, {
                height: roundedLength,
                bottom: roundedPosition,
                opacity: opacity,
              });
            }
          }
        }

        const calcEnd = performance.now();

        // 배치 DOM 업데이트
        const domStart = performance.now();
        if (updates.size > 0) {
          updates.forEach((style, element) => {
            Object.assign(element.style, style);
          });
        }
        const domEnd = performance.now();

        const frameEnd = performance.now();
        
        // 성능 로깅 (100프레임마다)
        if (logCount++ % 100 === 0) {
          const totalTime = frameEnd - frameStart;
          const calcTime = calcEnd - calcStart;
          const domTime = domEnd - domStart;
          
          console.log(`Frame: ${totalTime.toFixed(2)}ms (calc: ${calcTime.toFixed(2)}ms, dom: ${domTime.toFixed(2)}ms), FPS: ${detectedRefreshRate}, Updates: ${updates.size}`);
        }

        isAnimatingRef.current = false;

        if (notes.length > 0) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };// 노트가 있을 때만 애니메이션 시작
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
