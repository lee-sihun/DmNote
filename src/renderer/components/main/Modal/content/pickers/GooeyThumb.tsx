import React, { useId, useRef } from 'react';
import { useGooeySpring, type GooeyFrame } from '@hooks/ui/useGooeySpring';

// 흰 링 두께. blur는 반지름의 절반 - 본체와 꼬리가 끊기지 않으면서 원은 유지
const RING_WIDTH = 2;
const GOO_BLUR_RATIO = 0.5;
// 알파 0.3부터 살리고 0.35에서 완전 불투명
const GOO_CONTRAST = 20;
const GOO_OFFSET = -6;
// 안쪽 채움은 실루엣을 작은 blur로 번진 뒤 높은 문턱으로 잘라 얻는다.
// erode의 사각 커널과 달리 방향에 상관없이 링 두께만큼 들어온다
const INSET_BLUR = 1.5;
const INSET_CONTRAST = 20;
// 노브 안쪽 알파 타일. 링이 두 테마 모두 흰색이라 타일도 고정이다 -
// feImage 데이터 URI라 CSS 변수를 못 받는 것도 같은 결론을 가리킨다
const CHECKER_CELL = 4;
const CHECKER_TILE = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${
    CHECKER_CELL * 2
  }" height="${CHECKER_CELL * 2}"><rect width="${CHECKER_CELL * 2}" height="${
    CHECKER_CELL * 2
  }" fill="#fff"/><rect width="${CHECKER_CELL}" height="${CHECKER_CELL}" fill="#ccc"/><rect x="${CHECKER_CELL}" y="${CHECKER_CELL}" width="${CHECKER_CELL}" height="${CHECKER_CELL}" fill="#ccc"/></svg>`,
)}`;

// 반평면 가장자리에서 blur 알파가 안쪽 d px 지점에 갖는 값 - 정규분포 누적
const normalCdf = (z: number) => {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
  const p = 1 - tail * poly;
  return z >= 0 ? p : 1 - p;
};
const INSET_THRESHOLD = normalCdf(RING_WIDTH / INSET_BLUR);
const INSET_OFFSET = 0.5 - INSET_CONTRAST * INSET_THRESHOLD;

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

const writeShape = (
  rect: SVGRectElement | null,
  tail: SVGCircleElement | null,
  frame: GooeyFrame,
  radius: number,
) => {
  if (!rect || !tail) return;
  const d = 2 * radius;
  rect.setAttribute('x', String(frame.cx - radius));
  rect.setAttribute('y', String(frame.cy - radius));
  rect.setAttribute('width', String(d));
  rect.setAttribute('height', String(d));
  rect.setAttribute('rx', String(radius));
  if (frame.stretch > 0) {
    const deg = (frame.angle * 180) / Math.PI;
    const sx = 1 + frame.stretch;
    const sy = 1 / (1 + frame.stretch * 0.65);
    rect.setAttribute(
      'transform',
      `translate(${frame.cx} ${
        frame.cy
      }) rotate(${deg}) scale(${sx} ${sy}) rotate(${-deg}) translate(${-frame.cx} ${-frame.cy})`,
    );
  } else {
    rect.removeAttribute('transform');
  }
  tail.setAttribute('cx', String(frame.tailX));
  tail.setAttribute('cy', String(frame.tailY));
  tail.setAttribute('r', String(frame.tailRadius));
};

/**
 * 스프링으로 뒤따르는 젤리 노브. 흰 도형 하나를 goo 필터로 실루엣화하고
 * 같은 필터 안에서 실루엣을 링 두께만큼 안쪽으로 줄여 색을 채운다.
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
  const filterId = `goo-${id}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const tailRef = useRef<SVGCircleElement>(null);

  const radius = size / 2;

  useGooeySpring({
    measureRef: svgRef,
    x,
    y,
    size,
    apply: (frame) => {
      writeShape(rectRef.current, tailRef.current, frame, radius);
    },
  });

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      style={{ filter: 'drop-shadow(0 0 4px rgba(0, 0, 0, 0.7))' }}
    >
      <defs>
        <filter
          id={filterId}
          x="-200%"
          y="-200%"
          width="500%"
          height="500%"
          colorInterpolationFilters="sRGB"
        >
          {/* 뭉개진 실루엣으로 본체와 꼬리를 잇고 원본을 위에 올려 가장자리는 선명하게 */}
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation={radius * GOO_BLUR_RATIO}
            result="blur"
          />
          <feColorMatrix
            in="blur"
            type="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${GOO_CONTRAST} ${GOO_OFFSET}`}
            result="goo"
          />
          <feComposite
            in="SourceGraphic"
            in2="goo"
            operator="atop"
            result="shape"
          />
          {/* 링 안쪽 마스크 */}
          <feGaussianBlur in="shape" stdDeviation={INSET_BLUR} result="soft" />
          <feColorMatrix
            in="soft"
            type="matrix"
            values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${INSET_CONTRAST} ${INSET_OFFSET}`}
            result="innerMask"
          />
          {checker && (
            <>
              <feImage
                href={CHECKER_TILE}
                width={CHECKER_CELL * 2}
                height={CHECKER_CELL * 2}
                result="checkerTile"
              />
              <feTile in="checkerTile" result="checker" />
              <feComposite
                in="checker"
                in2="innerMask"
                operator="in"
                result="checkerFill"
              />
            </>
          )}
          <feFlood
            floodColor={color}
            floodOpacity={colorOpacity}
            result="fillColor"
          />
          <feComposite
            in="fillColor"
            in2="innerMask"
            operator="in"
            result="fill"
          />
          <feMerge>
            <feMergeNode in="shape" />
            {checker && <feMergeNode in="checkerFill" />}
            <feMergeNode in="fill" />
          </feMerge>
        </filter>
      </defs>
      <g filter={`url(#${filterId})`} fill="var(--ui-handle-fill)">
        <circle ref={tailRef} r={0} />
        <rect ref={rectRef} />
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
