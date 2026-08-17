/* eslint-disable react-hooks/set-state-in-effect */
import React, { useEffect, useState, useRef } from 'react';

interface ZoomIndicatorProps {
  zoom: number;
}

const ZoomIndicator = ({ zoom }: ZoomIndicatorProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [displayZoom, setDisplayZoom] = useState(zoom);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 첫 렌더링 시에는 표시하지 않음
    if (isFirstRender.current) {
      isFirstRender.current = false;
      setDisplayZoom(zoom);
      return;
    }

    // 줌이 변경되면 표시
    setDisplayZoom(zoom);
    setIsVisible(true);

    // 이전 타이머 클리어
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // 1.5초 후에 숨김
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 1500);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [zoom]);

  // 미니맵 위에 위치: 미니맵(80px) + gap(8px) + bottom(8px) = 96px
  return (
    <div
      className={`absolute bottom-[96px] left-2 bg-glass-dim-solid rounded-[8px] shadow-elevation-chrome text-fg-muted text-caption tabular-nums px-[8px] py-[4px] select-none pointer-events-none transition-opacity duration-base ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      {Math.round(displayZoom * 100)}%
    </div>
  );
};

export default ZoomIndicator;
