import React, { useId, useRef } from 'react';
import { useGooeySpring, type GooeyFrame } from '@hooks/ui/useGooeySpring';
import { createGooeyPath } from '@utils/ui/gooeyPath';

const RING_WIDTH = 2;
const SHADOW_BLUR = 2;
const CHECKER_CELL = 4;

interface GooeyThumbProps {
  /** 트랙 폭 대비 0~1 */
  x: number;
  /** 트랙 높이 대비 0~1 */
  y: number;
  size: number;
  /** 안쪽 채움색 - 불투명 CSS color. 투명도는 colorOpacity가 맡는다 */
  color: string;
  colorOpacity?: number;
  /** 반투명 색 아래에 체커 바탕을 깐다 */
  checker?: boolean;
}

const inverseStretchPoint = (
  x: number,
  y: number,
  angle: number,
  scaleX: number,
  scaleY: number,
) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = (x * cos + y * sin) / scaleX;
  const across = (-x * sin + y * cos) / scaleY;
  return {
    x: along * cos - across * sin,
    y: along * sin + across * cos,
  };
};

// 이동은 완성된 벡터 경로의 합성 transform으로 처리하고, 꼬리가 보일 때만
// 경로를 다시 계산한다. 필터 임계값을 거치지 않아 본체 외곽선은 항상 벡터다
const writeShape = (
  movingGroup: SVGGElement | null,
  stretchGroup: SVGGElement | null,
  shape: SVGPathElement | null,
  radius: number,
  frame: GooeyFrame,
) => {
  if (!movingGroup || !stretchGroup || !shape) return;
  movingGroup.style.visibility = 'visible';
  movingGroup.style.transform = `translate(${frame.cx}px, ${frame.cy}px)`;

  let tailX = frame.tailX - frame.cx;
  let tailY = frame.tailY - frame.cy;
  if (frame.stretch > 0) {
    const deg = (frame.angle * 180) / Math.PI;
    const scaleX = 1 + frame.stretch;
    const scaleY = 1 / (1 + frame.stretch * 0.65);
    stretchGroup.setAttribute(
      'transform',
      `rotate(${deg}) scale(${scaleX} ${scaleY}) rotate(${-deg})`,
    );
    const localTail = inverseStretchPoint(
      tailX,
      tailY,
      frame.angle,
      scaleX,
      scaleY,
    );
    tailX = localTail.x;
    tailY = localTail.y;
  } else if (stretchGroup.hasAttribute('transform')) {
    stretchGroup.removeAttribute('transform');
  }

  shape.setAttribute(
    'd',
    createGooeyPath({
      bodyRadius: radius - RING_WIDTH / 2,
      tailX,
      tailY,
      tailRadius: Math.max(0, frame.tailRadius - RING_WIDTH / 2),
    }),
  );
};

/**
 * 스프링으로 뒤따르는 젤리 노브. 본체와 꼬리를 하나의 SVG path로 연결해
 * fill과 흰 stroke를 직접 렌더링하고, 필터는 뒤쪽 그림자에만 사용한다.
 * 부모는 position 기준 컨테이너여야 한다
 */
const GooeyThumb = ({
  x,
  y,
  size,
  color,
  colorOpacity = 1,
  checker = false,
}: GooeyThumbProps) => {
  const id = useId().replace(/:/g, '');
  const shapeId = `goo-shape-${id}`;
  const shadowId = `goo-shadow-${id}`;
  const checkerId = `goo-checker-${id}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const movingGroupRef = useRef<SVGGElement>(null);
  const stretchGroupRef = useRef<SVGGElement>(null);
  const shapeRef = useRef<SVGPathElement>(null);

  const radius = size / 2;
  const bodyRadius = radius - RING_WIDTH / 2;

  useGooeySpring({
    measureRef: svgRef,
    x,
    y,
    size,
    apply: (frame) => {
      writeShape(
        movingGroupRef.current,
        stretchGroupRef.current,
        shapeRef.current,
        radius,
        frame,
      );
    },
  });

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
    >
      <defs>
        <path
          ref={shapeRef}
          id={shapeId}
          d={createGooeyPath({
            bodyRadius,
            tailX: 0,
            tailY: 0,
            tailRadius: 0,
          })}
        />
        <filter
          id={shadowId}
          x="-200%"
          y="-200%"
          width="500%"
          height="500%"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow
            dx={0}
            dy={0}
            stdDeviation={SHADOW_BLUR}
            floodColor="#000"
            floodOpacity={0.7}
          />
        </filter>
        {checker && (
          <pattern
            id={checkerId}
            width={CHECKER_CELL * 2}
            height={CHECKER_CELL * 2}
            patternUnits="userSpaceOnUse"
          >
            <rect
              width={CHECKER_CELL * 2}
              height={CHECKER_CELL * 2}
              fill="#fff"
            />
            <rect width={CHECKER_CELL} height={CHECKER_CELL} fill="#ccc" />
            <rect
              x={CHECKER_CELL}
              y={CHECKER_CELL}
              width={CHECKER_CELL}
              height={CHECKER_CELL}
              fill="#ccc"
            />
            <rect
              width={CHECKER_CELL * 2}
              height={CHECKER_CELL * 2}
              fill={color}
              fillOpacity={colorOpacity}
            />
          </pattern>
        )}
      </defs>
      {/* 첫 스프링 프레임 전에는 원점의 도형이 비치지 않게 숨김 */}
      <g
        ref={movingGroupRef}
        data-dmn-gooey-shape="true"
        style={{ visibility: 'hidden' }}
      >
        <g ref={stretchGroupRef}>
          {/* 그림자만 래스터 필터 처리하고 보이는 경로는 필터 밖에 유지 */}
          <use
            href={`#${shapeId}`}
            fill="#000"
            stroke="#000"
            strokeWidth={RING_WIDTH}
            vectorEffect="non-scaling-stroke"
            filter={`url(#${shadowId})`}
          />
          <use
            data-dmn-gooey-body="true"
            href={`#${shapeId}`}
            fill={checker ? `url(#${checkerId})` : color}
            fillOpacity={checker ? 1 : colorOpacity}
            stroke="#fff"
            strokeWidth={RING_WIDTH}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            shapeRendering="geometricPrecision"
          />
        </g>
      </g>
      {/* 실제 값 위치의 히트 영역 - 트랙 밖으로 삐져나온 부분도 잡히도록.
          이벤트는 트랙으로 버블되고 그림은 스프링이 따라온다 */}
      <circle
        cx={`${x * 100}%`}
        cy={`${y * 100}%`}
        r={radius}
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'inherit' }}
      />
    </svg>
  );
};

export default GooeyThumb;
