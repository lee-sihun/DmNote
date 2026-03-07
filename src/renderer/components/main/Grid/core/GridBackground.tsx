/* eslint-disable react-hooks/purity */
import React, { useRef } from 'react';

interface GridBackgroundProps {
  gridSize?: number;
  zoom?: number;
  panX?: number;
  panY?: number;
  color?: string;
  lineColor?: string;
}

/**
 * 정확한 그리드 배경을 SVG 패턴으로 렌더링하는 컴포넌트
 * 줌/팬에 맞춰 정확하게 그리드가 표시됩니다.
 */
export const GridBackground: React.FC<GridBackgroundProps> = ({
  gridSize = 5,
  zoom = 1,
  panX = 0,
  panY = 0,
  color: _color = '#3A3943',
  lineColor = 'rgb(25, 25, 28)',
}) => {
  // 실제 화면에 그려질 그리드 크기 (줌 적용)
  const scaledGridSize = gridSize * zoom;

  // 패턴 오프셋 계산 (팬 위치에 맞춰 그리드 이동)
  const offsetX = panX % scaledGridSize;
  const offsetY = panY % scaledGridSize;

  // 고유 패턴 ID (여러 그리드가 있을 경우 충돌 방지)
  const patternIdRef = useRef(
    `grid-pattern-${Math.random().toString(36).substr(2, 9)}`,
  );
  const patternId = patternIdRef.current;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      <defs>
        <pattern
          id={patternId}
          width={scaledGridSize}
          height={scaledGridSize}
          patternUnits="userSpaceOnUse"
          x={offsetX}
          y={offsetY}
        >
          {/* 수직선 */}
          <line
            x1="0"
            y1="0"
            x2="0"
            y2={scaledGridSize}
            stroke={lineColor}
            strokeWidth="1"
          />
          {/* 수평선 */}
          <line
            x1="0"
            y1="0"
            x2={scaledGridSize}
            y2="0"
            stroke={lineColor}
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
};

export default GridBackground;
