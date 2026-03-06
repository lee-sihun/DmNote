/**
 * z-order 순서 계산 순수 함수
 * Store/React 의존 없음 — 입력과 출력만으로 다음 상태를 결정
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZOrderable {
  zIndex?: number;
}

export interface ZOrderableWithBounds extends ZOrderable {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

/** 두 바운딩 박스가 겹치는지 확인 */
export function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** 외부 요소(플러그인 등)의 zIndex 목록 */
export interface ExternalZIndexSource {
  zIndex: number;
  bounds?: BoundingBox;
}

// ----------------------------------------------------------------------------
// 맨 앞/맨 뒤 이동
// ----------------------------------------------------------------------------

/** 대상 아이템의 zIndex를 전체 최대값+1로 설정한 새 배열 반환 */
export function computeMoveToFront<T extends ZOrderable>(
  items: T[],
  index: number,
  externalZIndexes: number[] = [],
): T[] {
  const itemZIndexes = items.map((p, i) => p.zIndex ?? i);
  const maxZIndex = Math.max(0, ...itemZIndexes, ...externalZIndexes);

  return items.map((p, i) =>
    i === index ? { ...p, zIndex: maxZIndex + 1 } : p,
  );
}

/** 대상 아이템의 zIndex를 전체 최소값-1로 설정한 새 배열 반환 */
export function computeMoveToBack<T extends ZOrderable>(
  items: T[],
  index: number,
  externalZIndexes: number[] = [],
): T[] {
  const itemZIndexes = items.map((p, i) => p.zIndex ?? i);
  const minZIndex = Math.min(0, ...itemZIndexes, ...externalZIndexes);

  return items.map((p, i) =>
    i === index ? { ...p, zIndex: minZIndex - 1 } : p,
  );
}

// ----------------------------------------------------------------------------
// 한 칸 앞/뒤 이동 (겹치는 요소 기반)
// ----------------------------------------------------------------------------

/**
 * 대상 아이템을 한 칸 앞으로 이동 (겹치는 요소 중 바로 위 요소 기준)
 * @param items - 현재 모드의 position 배열
 * @param index - 이동할 아이템의 인덱스
 * @param externalElements - 외부 요소 (플러그인 등)의 zIndex + bounds
 */
export function computeMoveForward<T extends ZOrderableWithBounds>(
  items: T[],
  index: number,
  externalElements: ExternalZIndexSource[] = [],
): T[] {
  const target = items[index];
  if (!target) return items;

  const currentZIndex = target.zIndex ?? index;
  const targetBox: BoundingBox = {
    x: target.dx,
    y: target.dy,
    width: target.width,
    height: target.height,
  };

  // 겹치면서 현재보다 위에 있는 요소들의 zIndex 수집
  const overlappingAbove: number[] = [];

  items.forEach((p, i) => {
    if (i === index) return;
    const z = p.zIndex ?? i;
    if (z <= currentZIndex) return;
    const box: BoundingBox = {
      x: p.dx,
      y: p.dy,
      width: p.width,
      height: p.height,
    };
    if (boxesOverlap(targetBox, box)) {
      overlappingAbove.push(z);
    }
  });

  for (const ext of externalElements) {
    if (ext.zIndex <= currentZIndex) continue;
    if (ext.bounds && boxesOverlap(targetBox, ext.bounds)) {
      overlappingAbove.push(ext.zIndex);
    }
  }

  const newZIndex =
    overlappingAbove.length === 0
      ? currentZIndex + 1
      : Math.min(...overlappingAbove) + 1;

  return items.map((p, i) => (i === index ? { ...p, zIndex: newZIndex } : p));
}

/**
 * 대상 아이템을 한 칸 뒤로 이동 (겹치는 요소 중 바로 아래 요소 기준)
 */
export function computeMoveBackward<T extends ZOrderableWithBounds>(
  items: T[],
  index: number,
  externalElements: ExternalZIndexSource[] = [],
): T[] {
  const target = items[index];
  if (!target) return items;

  const currentZIndex = target.zIndex ?? index;
  const targetBox: BoundingBox = {
    x: target.dx,
    y: target.dy,
    width: target.width,
    height: target.height,
  };

  // 겹치면서 현재보다 아래에 있는 요소들의 zIndex 수집
  const overlappingBelow: number[] = [];

  items.forEach((p, i) => {
    if (i === index) return;
    const z = p.zIndex ?? i;
    if (z >= currentZIndex) return;
    const box: BoundingBox = {
      x: p.dx,
      y: p.dy,
      width: p.width,
      height: p.height,
    };
    if (boxesOverlap(targetBox, box)) {
      overlappingBelow.push(z);
    }
  });

  for (const ext of externalElements) {
    if (ext.zIndex >= currentZIndex) continue;
    if (ext.bounds && boxesOverlap(targetBox, ext.bounds)) {
      overlappingBelow.push(ext.zIndex);
    }
  }

  const newZIndex =
    overlappingBelow.length === 0
      ? currentZIndex - 1
      : Math.max(...overlappingBelow) - 1;

  return items.map((p, i) => (i === index ? { ...p, zIndex: newZIndex } : p));
}
