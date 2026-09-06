import {
  pointsAabb,
  rotatePointAround,
  type Aabb,
  type Point,
} from '@utils/core/rotation';

// 노트 트랙 지오메트리의 단일 정의.
// 좌표계: 캔버스 DOM 좌표 (y 아래 양수). 트랙은 키 로컬 프레임에서 "키 상변에서 위로"
// 계산한 뒤 키 상자 중심 기준으로 요소 회전만큼 함께 돈다.
// d = 진행 방향 단위벡터, p = 교차축 단위벡터 (p = (-d.y, d.x)), origin O = 히트라인의 c=0 코너

export interface TrackGeometryInput {
  keyX: number;
  keyY: number;
  keyWidth: number;
  keyHeight: number;
  // 요소 회전(도). 0이면 기존 '위로 자람'과 픽셀 단위로 같다
  rotation: number;
  trackHeight: number;
  // 미설정/무효 = 키 너비
  noteWidth?: number;
  noteAlignment?: 'left' | 'center' | 'right';
  // 키 로컬 프레임 오프셋 - 회전과 함께 돈다
  noteOffsetX?: number;
  noteOffsetY?: number;
  // 흐름축 히트라인(회전 전 y). 미지정 = 키 상변. 회전 키는 항상 자기 상변을 쓴다
  hitline?: number;
}

export interface TrackGeometry {
  origin: Point;
  direction: Point;
  cross: Point;
  crossSize: number;
  trackHeight: number;
  // O, O+p·C, O+p·C+d·H, O+d·H
  corners: [Point, Point, Point, Point];
  rect: Aabb;
}

export const resolveTrackCrossSize = (
  keyWidth: number,
  noteWidth: number | undefined,
): number =>
  typeof noteWidth === 'number' && Number.isFinite(noteWidth)
    ? Math.max(1, noteWidth)
    : keyWidth;

export const resolveTrackAlignOffset = (
  keyWidth: number,
  crossSize: number,
  alignment: 'left' | 'center' | 'right' | undefined,
): number => {
  const align = alignment ?? 'center';
  if (align === 'left') return 0;
  if (align === 'right') return keyWidth - crossSize;
  return (keyWidth - crossSize) / 2;
};

export const trackDirectionVector = (rotation: number): Point => {
  if (rotation === 0) return { x: 0, y: -1 };
  const rad = (rotation * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
};

export const computeTrackGeometry = (
  input: TrackGeometryInput,
): TrackGeometry => {
  const {
    keyX,
    keyY,
    keyWidth,
    keyHeight,
    rotation,
    trackHeight,
    noteWidth,
    noteAlignment,
    noteOffsetX,
    noteOffsetY,
    hitline,
  } = input;

  const crossSize = resolveTrackCrossSize(keyWidth, noteWidth);
  const alignOffset = resolveTrackAlignOffset(
    keyWidth,
    crossSize,
    noteAlignment,
  );
  const offsetX = noteOffsetX ?? 0;
  const offsetY = noteOffsetY ?? 0;

  const localOrigin: Point = {
    x: keyX + alignOffset + offsetX,
    y: (rotation === 0 && hitline !== undefined ? hitline : keyY) + offsetY,
  };
  const center: Point = { x: keyX + keyWidth / 2, y: keyY + keyHeight / 2 };
  const origin = rotatePointAround(localOrigin, center, rotation);
  const direction = trackDirectionVector(rotation);
  const corners = trackCorners(origin, direction, trackHeight, crossSize);

  return {
    origin,
    direction,
    cross: crossVector(direction),
    crossSize,
    trackHeight,
    corners,
    rect: pointsAabb(corners),
  };
};

const crossVector = (direction: Point): Point => ({
  x: -direction.y,
  y: direction.x,
});

// O, O+p·C, O+p·C+d·H, O+d·H
const trackCorners = (
  origin: Point,
  direction: Point,
  trackHeight: number,
  crossSize: number,
): [Point, Point, Point, Point] => {
  const cross = crossVector(direction);
  const far: Point = {
    x: origin.x + direction.x * trackHeight,
    y: origin.y + direction.y * trackHeight,
  };
  return [
    origin,
    { x: origin.x + cross.x * crossSize, y: origin.y + cross.y * crossSize },
    { x: far.x + cross.x * crossSize, y: far.y + cross.y * crossSize },
    far,
  ];
};

// origin·방향·크기만 아는 소비처(캔버스 crop)용 AABB 복원
export const trackRectFromOrigin = (
  origin: Point,
  direction: Point,
  trackHeight: number,
  crossSize: number,
): Aabb => pointsAabb(trackCorners(origin, direction, trackHeight, crossSize));

// 트랙을 진행 방향으로 distance만큼 옮긴다 (자동 시작선 보정용)
export const translateTrackGeometry = (
  geometry: TrackGeometry,
  distance: number,
): TrackGeometry => {
  if (distance === 0) return geometry;
  const { direction } = geometry;
  const shift = (point: Point): Point => ({
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
  });
  const corners: [Point, Point, Point, Point] = [
    shift(geometry.corners[0]),
    shift(geometry.corners[1]),
    shift(geometry.corners[2]),
    shift(geometry.corners[3]),
  ];
  return {
    ...geometry,
    origin: shift(geometry.origin),
    corners,
    rect: pointsAabb(corners),
  };
};

// 회전 키의 자동 시작선 보정. 같은 방향으로 흐르는 키들의 오프셋 없는 상변을
// 진행축에 투영해 가장 앞선 값에 맞춘다 - 회전 0의 "한 줄에서 시작"을 방향별로
// 일반화한 것. 다른 방향 키와 통계·그래프 같은 요소는 기준에 넣지 않아 비스듬한
// 각도에서 레이아웃 반대편 모서리까지 밀리지 않는다. 혼자면 자기 상변(이동 0).
// 사용자 노트 오프셋은 이 보정 뒤에 로컬 프레임으로 얹어야 상쇄되지 않는다
export const sameFlowStartShift = (
  origin: Point,
  direction: Point,
  sameFlowOrigins: readonly Point[],
): number => {
  const project = (point: Point) =>
    point.x * direction.x + point.y * direction.y;
  let extent = project(origin);
  for (const point of sameFlowOrigins) {
    extent = Math.max(extent, project(point));
  }
  return extent - project(origin);
};

// 손으로 돌린 키는 각도가 조금씩 다르다. 이 오차 안이면 같은 방향으로 본다
export const SAME_FLOW_ANGLE_TOLERANCE_DEG = 0.5;

// 각도를 오차 안에서 묶는다. 가장 큰 각도 간격에서 원을 펼쳐 ±180 경계를 보존하고
// 그룹 첫 각도와의 차로 판정해 연쇄 병합으로 오차가 늘어나지 않게 한다
// 반환은 입력 인덱스의 그룹 배열
export const groupSameFlowAngles = (
  rotations: readonly number[],
  tolerance: number = SAME_FLOW_ANGLE_TOLERANCE_DEG,
): number[][] => {
  const order = rotations
    .map((rotation, index) => ({ rotation, index }))
    .sort((a, b) => a.rotation - b.rotation);
  if (order.length === 0) return [];

  let start = 0;
  let largestGap = order[0].rotation + 360 - order[order.length - 1].rotation;
  for (let index = 1; index < order.length; index += 1) {
    const gap = order[index].rotation - order[index - 1].rotation;
    if (gap > largestGap) {
      largestGap = gap;
      start = index;
    }
  }

  const groups: number[][] = [];
  let current: number[] = [];
  let anchor = Number.NaN;
  for (let offset = 0; offset < order.length; offset += 1) {
    const sortedIndex = (start + offset) % order.length;
    const { index, rotation: angle } = order[sortedIndex];
    const rotation = angle + (sortedIndex < start ? 360 : 0);
    if (current.length > 0 && rotation - anchor <= tolerance) {
      current.push(index);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = [index];
    anchor = rotation;
  }
  if (current.length > 0) groups.push(current);
  return groups;
};
