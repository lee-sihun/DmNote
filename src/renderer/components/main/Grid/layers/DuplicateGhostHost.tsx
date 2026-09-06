import React from 'react';
import { elementRotationTransform } from '@utils/core/rotation';

// 복제 배치 미리보기의 공통 껍데기 - 커서를 중심에 둔 배치, 반투명, 드래그 프리뷰 층.
// 배경·보더·라운딩 같은 표면 표현은 요소 종류마다 달라 호출부가 넘긴다
interface DuplicateGhostHostProps {
  width: number;
  height: number;
  /** 커서 위치 (그리드 좌표) */
  cursor: { x: number; y: number };
  /** 요소 배치 회전 - 상자 중심 기준 */
  rotation?: number;
  surfaceStyle?: React.CSSProperties;
  /** 요소의 사용자 클래스 - 커스텀 CSS가 고스트에도 닿게 한다 */
  className?: string;
  dataAttributes?: Record<string, string>;
  children?: React.ReactNode;
}

const DuplicateGhostHost = ({
  width,
  height,
  cursor,
  rotation = 0,
  surfaceStyle,
  className,
  dataAttributes,
  children,
}: DuplicateGhostHostProps) => (
  <div
    className={`absolute pointer-events-none select-none ${className || ''}`}
    {...dataAttributes}
    style={{
      width: `${width}px`,
      height: `${height}px`,
      transform: `translate3d(${cursor.x - width / 2}px, ${
        cursor.y - height / 2
      }px, 0)${elementRotationTransform(rotation)}`,
      ...(rotation !== 0 ? { transformOrigin: '50% 50%' } : {}),
      opacity: 0.5,
      zIndex: 'var(--z-canvas-drag-preview)',
      ...surfaceStyle,
    }}
  >
    {children}
  </div>
);

export default DuplicateGhostHost;
