import { ELEMENT_ROTATION_RANGE } from '@src/types/key/rotation';
import { clamp } from './clamp';

// 요소 회전 기하 프리미티브. 캔버스 노브·창 크기·노트 트랙이 공유한다.
// 좌표계는 CSS와 같다 - y 아래 양수, 각도 양수 = 시계방향

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export interface Point {
  x: number;
  y: number;
}

export interface Aabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// atan2 차(-360~360도)를 최단 호 표현(-180~180]으로 접는다
export const wrapDegrees = (deg: number): number => {
  const wrapped = ((deg + 540) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
};

export const clampRotation = (deg: number): number =>
  clamp(deg, ELEMENT_ROTATION_RANGE.min, ELEMENT_ROTATION_RANGE.max);

export const ROTATION_SNAP_DEG = 15;

interface RotationDragInput {
  // 드래그 시작 시점의 저장 각도
  base: number;
  // 축 기준 포인터 각도(라디안) - 시작과 현재
  startAngle: number;
  angle: number;
  snap: boolean;
  snapDeg?: number;
}

// 노브 드래그 한 프레임의 결과 각도. 스냅은 wrap 뒤에 적용해 ±180 경계에서도 격자에 맞는다
export const resolveRotationDrag = ({
  base,
  startAngle,
  angle,
  snap,
  snapDeg = ROTATION_SNAP_DEG,
}: RotationDragInput): number => {
  let deg = wrapDegrees(base + (angle - startAngle) * RAD_TO_DEG);
  if (snap) {
    deg = wrapDegrees(Math.round(deg / snapDeg) * snapDeg);
  }
  return clampRotation(deg);
};

// 직각은 정확값 - 좌표 한계 근처에서 삼각함수 오차가 한계를 넘기지 않게
const rotationBasis = (deg: number): { cos: number; sin: number } => {
  const angle = deg % 360;
  if (angle === 0) return { cos: 1, sin: 0 };
  if (angle === 90 || angle === -270) return { cos: 0, sin: 1 };
  if (angle === 180 || angle === -180) return { cos: -1, sin: 0 };
  if (angle === 270 || angle === -90) return { cos: 0, sin: -1 };
  const rad = angle * DEG_TO_RAD;
  return { cos: Math.cos(rad), sin: Math.sin(rad) };
};

// 점을 중심 기준으로 회전
export const rotatePointAround = (
  point: Point,
  center: Point,
  deg: number,
): Point => {
  if (deg === 0) return { x: point.x, y: point.y };
  const { cos, sin } = rotationBasis(deg);
  const vx = point.x - center.x;
  const vy = point.y - center.y;
  return {
    x: center.x + cos * vx - sin * vy,
    y: center.y + sin * vx + cos * vy,
  };
};

// 축 정렬 상자를 중심 기준으로 회전한 네 꼭짓점 (좌상·우상·우하·좌하 순)
export const rotatedRectCorners = (
  x: number,
  y: number,
  width: number,
  height: number,
  deg: number,
): [Point, Point, Point, Point] => {
  const center = { x: x + width / 2, y: y + height / 2 };
  return [
    rotatePointAround({ x, y }, center, deg),
    rotatePointAround({ x: x + width, y }, center, deg),
    rotatePointAround({ x: x + width, y: y + height }, center, deg),
    rotatePointAround({ x, y: y + height }, center, deg),
  ];
};

// 회전한 상자를 감싸는 축 정렬 상자. 닫힌 식이라 꼭짓점 열거 없이 계산한다
export const rotatedRectAabb = (
  x: number,
  y: number,
  width: number,
  height: number,
  deg: number,
): Aabb => {
  if (deg === 0) {
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
  }
  const basis = rotationBasis(deg);
  const cos = Math.abs(basis.cos);
  const sin = Math.abs(basis.sin);
  const halfW = (cos * width + sin * height) / 2;
  const halfH = (sin * width + cos * height) / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return {
    minX: cx - halfW,
    minY: cy - halfH,
    maxX: cx + halfW,
    maxY: cy + halfH,
  };
};

export const pointsAabb = (points: readonly Point[]): Aabb => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

// 루트 transform 뒤에 붙일 회전 조각. 회전 0은 빈 문자열이라 기존 문자열·테스트가 그대로다
export const elementRotationTransform = (
  rotation: number | undefined,
): string =>
  rotation && Number.isFinite(rotation) ? ` rotate(${rotation}deg)` : '';
