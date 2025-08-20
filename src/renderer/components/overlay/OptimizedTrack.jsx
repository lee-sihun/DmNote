import React, { memo, useEffect, useRef } from "react";
import { FLOW_SPEED } from "@hooks/useNoteSystem";

// CSS Transform 기반 극도로 최적화된 트랙
export const OptimizedTrack = memo(
  ({ notes, width, height, position, noteColor, noteOpacity }) => {
    const trackRef = useRef();
    const animationRef = useRef();
    const noteElementsRef = useRef(new Map());
    const isAnimatingRef = useRef(false);
    
    // 성능 측정
    const performanceRef = useRef({
      frameCount: 0,
      totalTime: 0,
      lastLogTime: 0
    });

    useEffect(() => {
      const flowSpeed = FLOW_SPEED;
      const baseOpacity = (noteOpacity || 80) / 100;
      let lastTime = 0;
      let refreshRate = 60;
      let frameTimeHistory = [];

      const detectRefreshRate = (currentTime) => {
        if (lastTime > 0) {
          const frameDelta = currentTime - lastTime;
          frameTimeHistory.push(frameDelta);
          
          if (frameTimeHistory.length > 10) {
            frameTimeHistory.shift();
            const avgFrameTime = frameTimeHistory.reduce((a, b) => a + b) / frameTimeHistory.length;
            const detectedFPS = Math.round(1000 / avgFrameTime);
            
            // 표준 주사율로 스냅
            if (detectedFPS > 200) refreshRate = 240;
            else if (detectedFPS > 120) refreshRate = 144;
            else if (detectedFPS > 80) refreshRate = 120;
            else refreshRate = 60;
          }
        }
      };

      const animate = (currentTime) => {
        const frameStart = performance.now();
        
        if (isAnimatingRef.current) return;
        isAnimatingRef.current = true;

        detectRefreshRate(currentTime);
        const frameInterval = 1000 / refreshRate;

        if (currentTime - lastTime < frameInterval) {
          isAnimatingRef.current = false;
          if (notes.length > 0) {
            animationRef.current = requestAnimationFrame(animate);
          }
          return;
        }
        lastTime = currentTime;

        // 노트 요소들 동기화
        const currentNoteIds = new Set(notes.map(note => note.id));
        
        // 제거된 노트 정리
        for (const [noteId, element] of noteElementsRef.current) {
          if (!currentNoteIds.has(noteId)) {
            element.remove();
            noteElementsRef.current.delete(noteId);
          }
        }

        // 새 노트 생성 또는 업데이트
        for (const note of notes) {
          let element = noteElementsRef.current.get(note.id);
          
          // 새 노트 생성
          if (!element) {
            element = document.createElement('div');
            element.style.cssText = `
              position: absolute;
              left: 50%;
              bottom: 0;
              width: 100%;
              background-color: ${noteColor || '#ffffff'};
              border-radius: 2px;
              opacity: ${baseOpacity};
              will-change: transform;
              transform: translateX(-50%) translateZ(0);
              backface-visibility: hidden;
              contain: layout style paint;
            `;
            trackRef.current.appendChild(element);
            noteElementsRef.current.set(note.id, element);
          }

          // Transform 기반 애니메이션 (레이아웃 리플로우 없음)
          if (note.isActive) {
            const pressDuration = currentTime - note.startTime;
            const noteLength = Math.max(0, (pressDuration * flowSpeed) / 1000);
            
            // CSS Transform으로 스케일 조정 (레이아웃 변경 없음)
            element.style.transform = `translateX(-50%) translateZ(0) scaleY(${noteLength / 10})`;
            element.style.transformOrigin = 'bottom';
          } else {
            const noteDuration = note.endTime - note.startTime;
            const noteLength = Math.max(0, (noteDuration * flowSpeed) / 1000);
            const timeSinceCompletion = currentTime - note.endTime;
            const yPosition = (timeSinceCompletion * flowSpeed) / 1000;

            // Transform으로 위치와 크기 동시 조정
            let opacity = baseOpacity;
            if (yPosition > height) {
              const fadeProgress = (yPosition - height) / 50;
              opacity = baseOpacity * (1 - Math.min(fadeProgress, 1));
            }

            element.style.transform = `translateX(-50%) translateY(-${yPosition}px) translateZ(0) scaleY(${noteLength / 10})`;
            element.style.transformOrigin = 'bottom';
            element.style.opacity = opacity;
          }
        }

        const frameEnd = performance.now();
        const frameTime = frameEnd - frameStart;
        
        // 성능 로깅
        const perf = performanceRef.current;
        perf.frameCount++;
        perf.totalTime += frameTime;
        
        if (currentTime - perf.lastLogTime > 1000) { // 1초마다 로그
          const avgTime = perf.totalTime / perf.frameCount;
          console.log(`OptimizedTrack - Avg Frame: ${avgTime.toFixed(2)}ms, FPS: ${refreshRate}, Notes: ${notes.length}`);
          
          perf.frameCount = 0;
          perf.totalTime = 0;
          perf.lastLogTime = currentTime;
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
      willChange: "contents",
      backfaceVisibility: "hidden",
      transform: "translateZ(0)",
      contain: "layout style paint",
    };

    return <div ref={trackRef} style={trackStyle} />;
  }
);
