import React, { memo, useEffect, useRef } from "react";
import { FLOW_SPEED } from "@hooks/useNoteSystem";

// Web Worker 기반 트랙 (계산 분리)
export const WorkerTrack = memo(
  ({ notes, width, height, position, noteColor, noteOpacity }) => {
    const trackRef = useRef();
    const animationRef = useRef();
    const noteElementsRef = useRef(new Map());
    const workerRef = useRef(null);
    const isAnimatingRef = useRef(false);
    
    // Web Worker 초기화
    useEffect(() => {
      // Web Worker 생성
      const workerCode = `
        let notes = [];
        let flowSpeed = 180;
        let height = 150;

        self.onmessage = function(e) {
          const { type, data } = e.data;
          
          switch (type) {
            case 'UPDATE_NOTES':
              notes = data.notes;
              flowSpeed = data.flowSpeed;
              height = data.height;
              break;
              
            case 'CALCULATE_FRAME':
              const { currentTime, noteColor, baseOpacity } = data;
              const updates = [];
              
              for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                const update = { id: note.id };
                
                if (note.isActive) {
                  const pressDuration = currentTime - note.startTime;
                  const noteLength = Math.max(0, (pressDuration * flowSpeed) / 1000);
                  
                  update.height = noteLength;
                  update.bottom = 0;
                  update.opacity = baseOpacity;
                  update.backgroundColor = noteColor || '#ffffff';
                } else {
                  const noteDuration = note.endTime - note.startTime;
                  const noteLength = Math.max(0, (noteDuration * flowSpeed) / 1000);
                  const timeSinceCompletion = currentTime - note.endTime;
                  const yPosition = (timeSinceCompletion * flowSpeed) / 1000;
                  
                  let opacity = baseOpacity;
                  if (yPosition > height) {
                    const fadeProgress = (yPosition - height) / 50;
                    opacity = baseOpacity * (1 - Math.min(fadeProgress, 1));
                  }
                  
                  update.height = noteLength;
                  update.bottom = yPosition;
                  update.opacity = opacity;
                }
                
                updates.push(update);
              }
              
              self.postMessage({
                type: 'FRAME_CALCULATED',
                data: { updates }
              });
              break;
          }
        };
      `;
      
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      workerRef.current = new Worker(URL.createObjectURL(blob));
      
      workerRef.current.onmessage = (e) => {
        const { type, data } = e.data;
        if (type === 'FRAME_CALCULATED') {
          applyUpdates(data.updates);
        }
      };

      return () => {
        if (workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
      };
    }, []);

    // 업데이트 적용 함수
    const applyUpdates = (updates) => {
      const fragment = document.createDocumentFragment();
      
      for (const update of updates) {
        let element = noteElementsRef.current.get(update.id);
        
        if (!element) {
          element = document.createElement('div');
          element.style.cssText = `
            position: absolute;
            left: 50%;
            width: 100%;
            border-radius: 2px;
            will-change: transform;
            transform: translateX(-50%) translateZ(0);
            backface-visibility: hidden;
            contain: strict;
          `;
          noteElementsRef.current.set(update.id, element);
          fragment.appendChild(element);
        }

        // 스타일 적용
        element.style.height = `${update.height}px`;
        element.style.bottom = `${update.bottom}px`;
        element.style.opacity = update.opacity;
        if (update.backgroundColor) {
          element.style.backgroundColor = update.backgroundColor;
        }
      }
      
      if (fragment.children.length > 0) {
        trackRef.current.appendChild(fragment);
      }
    };

    useEffect(() => {
      const baseOpacity = (noteOpacity || 80) / 100;
      let lastTime = 0;
      let refreshRate = 60;
      
      // Worker에 노트 데이터 전송
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'UPDATE_NOTES',
          data: {
            notes,
            flowSpeed: FLOW_SPEED,
            height
          }
        });
      }

      const animate = (currentTime) => {
        if (isAnimatingRef.current) return;
        isAnimatingRef.current = true;

        const frameInterval = 1000 / refreshRate;
        if (currentTime - lastTime < frameInterval) {
          isAnimatingRef.current = false;
          if (notes.length > 0) {
            animationRef.current = requestAnimationFrame(animate);
          }
          return;
        }
        lastTime = currentTime;

        // Worker에 계산 요청
        if (workerRef.current) {
          workerRef.current.postMessage({
            type: 'CALCULATE_FRAME',
            data: {
              currentTime,
              noteColor,
              baseOpacity
            }
          });
        }

        isAnimatingRef.current = false;

        if (notes.length > 0) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      if (notes.length > 0 && !animationRef.current) {
        animationRef.current = requestAnimationFrame(animate);
      }

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = null;
        }
        
        // 노트 요소 정리
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
