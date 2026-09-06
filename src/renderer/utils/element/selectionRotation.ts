import {
  EDITOR_BOUNDS_LIMITS,
  type EditorDocumentV1,
  type EditorElementTypeV1,
} from '@src/types/editor';
import { ELEMENT_ROTATION_RANGE } from '@src/types/key/rotation';
import {
  SPRITE_CONSTRAINTS,
  type ReactiveSpritePosition,
  type SpriteAnchor,
  type SpriteTransform,
} from '@src/types/key/sprites';
import { placeSpriteVisual, spriteIdleVisual } from '../sprite/spritePlacement';
import {
  pointsAabb,
  rotatePointAround,
  wrapDegrees,
  type Point,
} from './rotation';

export type SelectionRotationDocument = Pick<
  EditorDocumentV1,
  | 'keyPositions'
  | 'statPositions'
  | 'graphPositions'
  | 'knobPositions'
  | 'spritePositions'
>;

type SelectionRotationPosition =
  SelectionRotationDocument[keyof SelectionRotationDocument][string][number];

export interface SelectionRotationTarget {
  type: EditorElementTypeV1;
  id: string;
}

interface SelectionRotationBox {
  id: string;
  dx: number;
  dy: number;
  width: number;
  height: number;
  rotation: number;
}

interface NativeSelectionRotationEntry extends SelectionRotationBox {
  type: Exclude<EditorElementTypeV1, 'sprite'>;
}

// 회전 결과는 dx·dy·rotation만 바꾼다. idle 변환은 선택 틀의 리사이즈 방식 판정에 쓰이고
// 기준점·자세 기하는 서명으로만 남긴다
interface SpriteSelectionRotationEntry extends SelectionRotationBox {
  type: 'sprite';
  idleTransform: SpriteTransform;
}

export type SelectionRotationEntry =
  | NativeSelectionRotationEntry
  | SpriteSelectionRotationEntry;

export interface SelectionRotationSnapshot {
  mode: string;
  targets: readonly SelectionRotationTarget[];
  center: Point;
  bounds: { x: number; y: number; width: number; height: number };
  corners: readonly Point[];
  referenceRotation: number;
  hasRotatedContent: boolean;
  entries: readonly SelectionRotationEntry[];
  geometrySignature: string;
}

export interface SelectionRotationUpdate extends SelectionRotationTarget {
  patch: Record<string, unknown>;
}

const NATIVE_POSITION_FIELDS = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
} as const;

const inRange = (value: number, min: number, max: number): boolean =>
  Number.isFinite(value) && value >= min && value <= max;

const validCoordinate = (value: number): boolean =>
  inRange(
    value,
    -EDITOR_BOUNDS_LIMITS.maxAbsCoordinate,
    EDITOR_BOUNDS_LIMITS.maxAbsCoordinate,
  );

const validBox = (box: Omit<SelectionRotationBox, 'id'>): boolean =>
  validCoordinate(box.dx) &&
  validCoordinate(box.dy) &&
  inRange(box.width, Number.MIN_VALUE, EDITOR_BOUNDS_LIMITS.maxDimension) &&
  inRange(box.height, Number.MIN_VALUE, EDITOR_BOUNDS_LIMITS.maxDimension);

const validRotation = (rotation: number): boolean =>
  inRange(rotation, ELEMENT_ROTATION_RANGE.min, ELEMENT_ROTATION_RANGE.max);

const validAnchor = (anchor: SpriteAnchor): boolean =>
  !!anchor &&
  inRange(
    anchor.x,
    SPRITE_CONSTRAINTS.anchor.min,
    SPRITE_CONSTRAINTS.anchor.max,
  ) &&
  inRange(
    anchor.y,
    SPRITE_CONSTRAINTS.anchor.min,
    SPRITE_CONSTRAINTS.anchor.max,
  );

const validTransform = (transform: SpriteTransform): boolean =>
  !!transform &&
  inRange(
    transform.x,
    SPRITE_CONSTRAINTS.offset.min,
    SPRITE_CONSTRAINTS.offset.max,
  ) &&
  inRange(
    transform.y,
    SPRITE_CONSTRAINTS.offset.min,
    SPRITE_CONSTRAINTS.offset.max,
  ) &&
  validRotation(transform.rotation) &&
  inRange(
    transform.scale,
    SPRITE_CONSTRAINTS.scale.min,
    SPRITE_CONSTRAINTS.scale.max,
  );

const ORIGIN: Point = Object.freeze({ x: 0, y: 0 });

const boxCorners = (
  x: number,
  y: number,
  width: number,
  height: number,
): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const nativeCorners = (entry: NativeSelectionRotationEntry): Point[] => {
  const center = {
    x: entry.dx + entry.width / 2,
    y: entry.dy + entry.height / 2,
  };
  return boxCorners(
    -entry.width / 2,
    -entry.height / 2,
    entry.width,
    entry.height,
  ).map((point) => {
    const rotated = rotatePointAround(point, ORIGIN, entry.rotation);
    return { x: center.x + rotated.x, y: center.y + rotated.y };
  });
};

const spriteIdleCorners = (sprite: ReactiveSpritePosition): Point[] => {
  const { rect } = placeSpriteVisual(sprite, spriteIdleVisual(sprite));
  const axis = {
    x: sprite.pivot.x * sprite.width,
    y: sprite.pivot.y * sprite.height,
  };
  const transform = sprite.idleTransform;
  const center = {
    x: sprite.dx + sprite.width / 2,
    y: sprite.dy + sprite.height / 2,
  };
  return boxCorners(rect.x, rect.y, rect.width, rect.height).map((point) => {
    const rotated = rotatePointAround(
      { x: point.x - axis.x, y: point.y - axis.y },
      ORIGIN,
      transform.rotation,
    );
    const local = {
      x: sprite.dx + axis.x + transform.x + transform.scale * rotated.x,
      y: sprite.dy + axis.y + transform.y + transform.scale * rotated.y,
    };
    return rotatePointAround(local, center, sprite.rotation ?? 0);
  });
};

const transformFields = (transform: SpriteTransform): number[] => [
  transform.x,
  transform.y,
  transform.rotation,
  transform.scale,
];

// 기하 서명 - 회전 결과에 영향을 주는 값만. 이름·트리거·이미지 같은 메타데이터 편집은 통과
const geometryFields = (
  entry: SelectionRotationEntry,
  sprite: ReactiveSpritePosition | null,
): unknown[] => [
  entry.type,
  entry.id,
  entry.dx,
  entry.dy,
  entry.width,
  entry.height,
  entry.rotation,
  ...(sprite
    ? [
        [sprite.pivot.x, sprite.pivot.y],
        transformFields(sprite.idleTransform),
        sprite.poses.map((pose) => [
          pose.poseId,
          pose.pivot ? [pose.pivot.x, pose.pivot.y] : null,
          transformFields(pose.transform),
        ]),
      ]
    : []),
];

export const createSelectionRotationSnapshot = (
  document: SelectionRotationDocument,
  targets: readonly { type: string; id: string }[],
  mode: string,
): SelectionRotationSnapshot | null => {
  if (targets.length === 0) return null;
  const ids = new Set<string>();
  const sorted: SelectionRotationTarget[] = [];
  for (const target of targets) {
    if (
      !['key', 'stat', 'graph', 'knob', 'sprite'].includes(target.type) ||
      !target.id ||
      ids.has(target.id)
    ) {
      return null;
    }
    ids.add(target.id);
    sorted.push({ type: target.type as EditorElementTypeV1, id: target.id });
  }
  sorted.sort((a, b) => {
    const left = `${a.type}:${a.id}`;
    const right = `${b.type}:${b.id}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });

  const positionsByType = new Map<
    EditorElementTypeV1,
    Map<string, SelectionRotationPosition | null>
  >();
  for (const target of sorted) {
    if (positionsByType.has(target.type)) continue;
    const field =
      target.type === 'sprite'
        ? 'spritePositions'
        : NATIVE_POSITION_FIELDS[target.type];
    const positions = new Map<string, SelectionRotationPosition | null>();
    for (const position of document[field][mode] ?? []) {
      if (!position.id) continue;
      positions.set(position.id, positions.has(position.id) ? null : position);
    }
    positionsByType.set(target.type, positions);
  }

  const entries: SelectionRotationEntry[] = [];
  const signature: unknown[] = [];
  const corners: Point[] = [];
  for (const target of sorted) {
    const position = positionsByType.get(target.type)?.get(target.id);
    if (!position) return null;
    if (target.type === 'sprite') {
      const sprite = position as ReactiveSpritePosition;
      const rotation = sprite.rotation === undefined ? 0 : sprite.rotation;
      if (
        !validBox(sprite) ||
        !validRotation(rotation) ||
        !validAnchor(sprite.pivot) ||
        !validTransform(sprite.idleTransform) ||
        !Array.isArray(sprite.poses) ||
        sprite.poses.some(
          (pose) =>
            !validTransform(pose.transform) ||
            (pose.pivot != null && !validAnchor(pose.pivot)),
        )
      ) {
        return null;
      }
      const entry: SpriteSelectionRotationEntry = {
        ...target,
        type: 'sprite',
        dx: sprite.dx,
        dy: sprite.dy,
        width: sprite.width,
        height: sprite.height,
        rotation,
        idleTransform: { ...sprite.idleTransform },
      };
      entries.push(entry);
      signature.push(geometryFields(entry, sprite));
      corners.push(...spriteIdleCorners(sprite));
    } else {
      const rotation = position.rotation === undefined ? 0 : position.rotation;
      if (!validBox(position) || !validRotation(rotation)) return null;
      const entry: NativeSelectionRotationEntry = {
        ...target,
        type: target.type,
        dx: position.dx,
        dy: position.dy,
        width: position.width,
        height: position.height,
        rotation,
      };
      entries.push(entry);
      signature.push(geometryFields(entry, null));
      corners.push(...nativeCorners(entry));
    }
  }
  if (corners.some((point) => !Number.isFinite(point.x + point.y))) return null;
  const { minX, minY, maxX, maxY } = pointsAabb(corners);
  return {
    mode,
    targets: sorted,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    corners,
    referenceRotation: entries[0].rotation,
    hasRotatedContent: entries.some(
      (entry) =>
        entry.rotation !== 0 ||
        (entry.type === 'sprite' && entry.idleTransform.rotation !== 0),
    ),
    entries,
    geometrySignature: JSON.stringify([mode, signature]),
  };
};

export const rotateSelection = (
  snapshot: SelectionRotationSnapshot,
  deltaDegrees: number,
): SelectionRotationUpdate[] | null => {
  if (!Number.isFinite(deltaDegrees)) return null;
  const delta = deltaDegrees % 360;
  const updates: SelectionRotationUpdate[] = [];
  for (const entry of snapshot.entries) {
    const fromCenter = rotatePointAround(
      {
        x: entry.dx + entry.width / 2 - snapshot.center.x,
        y: entry.dy + entry.height / 2 - snapshot.center.y,
      },
      ORIGIN,
      delta,
    );
    const dx =
      delta === 0
        ? entry.dx
        : snapshot.center.x + fromCenter.x - entry.width / 2;
    const dy =
      delta === 0
        ? entry.dy
        : snapshot.center.y + fromCenter.y - entry.height / 2;
    if (!validCoordinate(dx) || !validCoordinate(dy)) return null;
    updates.push({
      type: entry.type,
      id: entry.id,
      patch: {
        dx,
        dy,
        rotation:
          delta === 0 ? entry.rotation : wrapDegrees(entry.rotation + delta),
      },
    });
  }
  return updates;
};
