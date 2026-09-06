import { describe, expect, it } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type { KeyPosition } from '@src/types/key/keys';
import type {
  ReactiveSpritePosition,
  SpritePose,
  SpriteTransform,
} from '@src/types/key/sprites';
import { makeSpritePose, makeSpritePosition } from '../sprite/spriteFixtures';
import {
  placeSpriteVisual,
  spriteIdleVisual,
  spritePoseVisual,
} from '../sprite/spritePlacement';
import { rotatePointAround, rotatedRectCorners, type Point } from './rotation';
import {
  createSelectionRotationSnapshot,
  rotateSelection,
  type SelectionRotationDocument,
  type SelectionRotationTarget,
  type SelectionRotationUpdate,
} from './selectionRotation';

const MODE = '4key';
const key = (overrides: Partial<KeyPosition> = {}): KeyPosition => ({
  ...createDefaultKeyPosition(),
  id: 'key-1',
  ...overrides,
});
const documentWith = (
  overrides: Partial<SelectionRotationDocument> = {},
): SelectionRotationDocument => ({
  keyPositions: {},
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: {},
  ...overrides,
});
const fields = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
  sprite: 'spritePositions',
} as const;
const applyUpdates = (
  document: SelectionRotationDocument,
  updates: SelectionRotationUpdate[],
): SelectionRotationDocument => {
  const result = structuredClone(document);
  for (const update of updates) {
    const position = result[fields[update.type]][MODE].find(
      (item) => item.id === update.id,
    );
    Object.assign(position, update.patch);
  }
  return result;
};
const nearPoint = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x, 8);
  expect(actual.y).toBeCloseTo(expected.y, 8);
};
const expectWorldRotation = (
  before: readonly Point[],
  after: readonly Point[],
  center: Point,
  angle: number,
) => {
  expect(after).toHaveLength(before.length);
  before.forEach((point, index) => {
    nearPoint(after[index], rotatePointAround(point, center, angle));
  });
};
const mixedDocument = () =>
  documentWith({
    keyPositions: {
      [MODE]: [key({ dx: -25, dy: 10, width: 60, height: 40, rotation: 170 })],
    },
    statPositions: {
      [MODE]: [
        {
          ...key({
            id: 'stat-1',
            dx: 210,
            dy: 150,
            width: 110,
            height: 25,
            rotation: -175,
          }),
          statType: 'kps',
        },
      ],
    },
    graphPositions: {
      [MODE]: [
        {
          ...key({
            id: 'graph-1',
            dx: 110,
            dy: -55,
            width: 160,
            height: 80,
            rotation: 30,
          }),
          statType: 'kps',
          graphType: 'line',
          graphColor: '#ffffff',
          graphSpeed: 1,
        },
      ],
    },
    knobPositions: {
      [MODE]: [
        {
          ...key({
            id: 'knob-1',
            dx: 90,
            dy: 230,
            width: 30,
            height: 30,
            rotation: -50,
          }),
          axisId: 'axis-1',
          sensitivity: 1,
          reverse: false,
        },
      ],
    },
  });
const mixedTargets: SelectionRotationTarget[] = [
  { type: 'key', id: 'key-1' },
  { type: 'stat', id: 'stat-1' },
  { type: 'graph', id: 'graph-1' },
  { type: 'knob', id: 'knob-1' },
];

const spriteWorldCorners = (
  sprite: ReactiveSpritePosition,
  pose?: SpritePose,
  transform: SpriteTransform = pose?.transform ?? sprite.idleTransform,
): Point[] => {
  const { rect } = placeSpriteVisual(
    sprite,
    pose ? spritePoseVisual(sprite, pose) : spriteIdleVisual(sprite),
  );
  const axis = {
    x: sprite.pivot.x * sprite.width,
    y: sprite.pivot.y * sprite.height,
  };
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((point) => {
    const rotated = rotatePointAround(point, axis, transform.rotation);
    const local = {
      x:
        sprite.dx +
        axis.x +
        transform.x +
        (rotated.x - axis.x) * transform.scale,
      y:
        sprite.dy +
        axis.y +
        transform.y +
        (rotated.y - axis.y) * transform.scale,
    };
    return rotatePointAround(
      local,
      { x: sprite.dx + sprite.width / 2, y: sprite.dy + sprite.height / 2 },
      sprite.rotation ?? 0,
    );
  });
};
const detailedSprite = () =>
  makeSpritePosition({
    dx: 300,
    dy: -90,
    width: 100,
    height: 70,
    rotation: -40,
    pivot: { x: 0.15, y: 0.8 },
    baseImage: 'base.png',
    referenceNaturalSize: { source: 'base.png', width: 640, height: 480 },
    idleTransform: { x: 43, y: -29, rotation: 20, scale: 1.4 },
    poses: [
      makeSpritePose({
        poseId: 'pose-other-pivot',
        name: '다른 기준점',
        triggers: ['key-1'],
        pivot: { x: 0.9, y: 0.1 },
        transform: { x: -35, y: 54, rotation: -55, scale: 0.6 },
        imageOverride: 'pose.png',
        imageOverrideMetrics: {
          source: 'pose.png',
          width: 1280,
          height: 320,
        },
      }),
      makeSpritePose({
        poseId: 'pose-inherit',
        pivot: null,
        transform: { x: 110, y: -130, rotation: 160, scale: 2 },
      }),
    ],
  });

describe('createSelectionRotationSnapshot', () => {
  it('시각 꼭짓점의 공통 범위와 안정적인 대표 각도를 사용한다', () => {
    const document = mixedDocument();
    const snapshot = createSelectionRotationSnapshot(
      document,
      mixedTargets,
      MODE,
    )!;
    const reordered = createSelectionRotationSnapshot(
      document,
      [...mixedTargets].reverse(),
      MODE,
    )!;
    expect(snapshot).toEqual(reordered);
    expect(snapshot.referenceRotation).toBe(30);
    expect(snapshot.hasRotatedContent).toBe(true);
    const corners = snapshot.targets.flatMap((target) => {
      const position = document[fields[target.type]][MODE][0] as KeyPosition;
      return rotatedRectCorners(
        position.dx,
        position.dy,
        position.width,
        position.height,
        position.rotation,
      );
    });
    const minX = Math.min(...corners.map((point) => point.x));
    const minY = Math.min(...corners.map((point) => point.y));
    const maxX = Math.max(...corners.map((point) => point.x));
    const maxY = Math.max(...corners.map((point) => point.y));
    nearPoint(snapshot.center, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    nearPoint(snapshot.bounds, { x: minX, y: minY });
    expect(snapshot.bounds.width).toBeCloseTo(maxX - minX, 8);
    expect(snapshot.bounds.height).toBeCloseTo(maxY - minY, 8);
    expectWorldRotation(corners, snapshot.corners, snapshot.center, 0);
  });

  it('스프라이트의 논리 상자가 아닌 실제 idle 얼굴로 범위를 계산한다', () => {
    const sprite = detailedSprite();
    const snapshot = createSelectionRotationSnapshot(
      documentWith({ spritePositions: { [MODE]: [sprite] } }),
      [{ type: 'sprite', id: sprite.id }],
      MODE,
    )!;
    const corners = spriteWorldCorners(sprite);
    expectWorldRotation(corners, snapshot.corners, snapshot.center, 0);
    expect(snapshot.bounds.width).not.toBe(sprite.width);
    expect(snapshot.referenceRotation).toBe(sprite.rotation);
    expect(snapshot.hasRotatedContent).toBe(true);
  });

  it('구형 native 각도 부재를 0으로 읽고 pose 회전만 있으면 idle은 회전하지 않은 것으로 본다', () => {
    const position = key({ rotation: undefined });
    const sprite = makeSpritePosition({
      poses: [
        makeSpritePose({ transform: { x: 0, y: 0, rotation: 90, scale: 1 } }),
      ],
    });
    const snapshot = createSelectionRotationSnapshot(
      documentWith({
        keyPositions: { [MODE]: [position] },
        spritePositions: { [MODE]: [sprite] },
      }),
      [
        { type: 'key', id: position.id },
        { type: 'sprite', id: sprite.id },
      ],
      MODE,
    )!;
    expect(snapshot.hasRotatedContent).toBe(false);
    expect(snapshot.referenceRotation).toBe(0);
  });

  it.each([
    [],
    [{ type: 'plugin', id: 'plugin-1' }],
    [{ type: 'key', id: 'missing' }],
    [{ type: 'key', id: '' }],
    [
      { type: 'key', id: 'key-1' },
      { type: 'key', id: 'key-1' },
    ],
    [
      { type: 'key', id: 'key-1' },
      { type: 'stat', id: 'key-1' },
    ],
  ])('잘못된 대상 집합 %j를 거부한다', (...targets) => {
    expect(
      createSelectionRotationSnapshot(mixedDocument(), targets, MODE),
    ).toBeNull();
  });

  it('선택한 mode의 누락과 문서 내 대상 중복을 거부한다', () => {
    const document = mixedDocument();
    expect(
      createSelectionRotationSnapshot(document, mixedTargets, 'other'),
    ).toBeNull();
    document.keyPositions[MODE].push({ ...document.keyPositions[MODE][0] });
    expect(
      createSelectionRotationSnapshot(document, mixedTargets, MODE),
    ).toBeNull();
  });

  it('많은 요소를 선택해도 domain을 한 번만 탐색한다', () => {
    const count = 2048;
    let idReads = 0;
    const targets = Array.from({ length: count }, (_, index) => ({
      type: 'key',
      id: `key-${index}`,
    }));
    const positions = targets.map((target, index) => {
      const position = key({ dx: index * 4 });
      Object.defineProperty(position, 'id', {
        enumerable: true,
        get: () => {
          idReads += 1;
          return target.id;
        },
      });
      return position;
    });
    const snapshot = createSelectionRotationSnapshot(
      documentWith({ keyPositions: { [MODE]: positions } }),
      targets,
      MODE,
    );
    expect(snapshot.entries).toHaveLength(count);
    expect(idReads).toBeLessThanOrEqual(count * 4);
  });

  it.each([
    { dx: NaN },
    { dy: Infinity },
    { dx: 32769 },
    { dy: -32769 },
    { width: 0 },
    { height: -1 },
    { width: 32769 },
    { rotation: NaN },
    { rotation: 181 },
    { rotation: -181 },
    { rotation: null },
  ])('잘못된 시작 기하 %j를 거부한다', (patch) => {
    const document = documentWith({ keyPositions: { [MODE]: [key(patch)] } });
    expect(
      createSelectionRotationSnapshot(
        document,
        [{ type: 'key', id: 'key-1' }],
        MODE,
      ),
    ).toBeNull();
  });

  it('기하 서명은 스타일·자세 메타데이터 편집을 허용하고 기준점·위치 변경을 구분한다', () => {
    const sprite = detailedSprite();
    const document = documentWith({ spritePositions: { [MODE]: [sprite] } });
    const targets = [{ type: 'sprite', id: sprite.id }];
    const original = createSelectionRotationSnapshot(document, targets, MODE)!;
    sprite.poses[0].name = '이름 변경';
    sprite.poses[0].triggers.push('key-2');
    sprite.poses[0].imageOverride = 'latest.png';
    sprite.poses[0].imageOverrideMetrics.source = 'latest.png';
    sprite.className = 'latest-style';
    const latest = createSelectionRotationSnapshot(document, targets, MODE)!;
    expect(latest.geometrySignature).toBe(original.geometrySignature);
    const rotated = applyUpdates(document, rotateSelection(latest, 20)!);
    expect(rotated.spritePositions[MODE][0].poses[0]).toMatchObject({
      name: '이름 변경',
      triggers: ['key-1', 'key-2'],
      imageOverride: 'latest.png',
    });
    sprite.poses[0].pivot.x += 0.01;
    expect(
      createSelectionRotationSnapshot(document, targets, MODE)!
        .geometrySignature,
    ).not.toBe(original.geometrySignature);
    sprite.poses[0].pivot.x -= 0.01;
    sprite.dx += 1;
    expect(
      createSelectionRotationSnapshot(document, targets, MODE)!
        .geometrySignature,
    ).not.toBe(original.geometrySignature);
  });
});

describe('rotateSelection', () => {
  it.each([0, 45, 90, -90, 180, -180])(
    '%s°에서 네 종류의 모든 꼭짓점과 중심 사이 거리를 보존한다',
    (delta) => {
      const document = mixedDocument();
      const snapshot = createSelectionRotationSnapshot(
        document,
        mixedTargets,
        MODE,
      )!;
      const updates = rotateSelection(snapshot, delta)!;
      const after = createSelectionRotationSnapshot(
        applyUpdates(document, updates),
        mixedTargets,
        MODE,
      )!;
      expectWorldRotation(
        snapshot.corners,
        after.corners,
        snapshot.center,
        delta,
      );
      for (const update of updates) {
        expect(Object.keys(update.patch).sort()).toEqual([
          'dx',
          'dy',
          'rotation',
        ]);
      }
      const centers = (data: typeof snapshot) =>
        data.entries.map((entry) => ({
          x: entry.dx + entry.width / 2,
          y: entry.dy + entry.height / 2,
        }));
      const beforeCenters = centers(snapshot);
      const afterCenters = centers(after);
      beforeCenters.forEach((a, i) =>
        beforeCenters.forEach((b, j) => {
          expect(
            Math.hypot(
              afterCenters[i].x - afterCenters[j].x,
              afterCenters[i].y - afterCenters[j].y,
            ),
          ).toBeCloseTo(Math.hypot(a.x - b.x, a.y - b.y), 8);
        }),
      );
      expect(document).toEqual(mixedDocument());
    },
  );

  it.each([0, 45, 90, -180])(
    '%s°에서 스프라이트의 custom pivot과 모든 자세 이미지의 세계 좌표를 보존한다',
    (delta) => {
      const sprite = detailedSprite();
      const document = documentWith({
        keyPositions: { [MODE]: [key({ dx: -90, dy: 70, rotation: -70 })] },
        spritePositions: { [MODE]: [sprite] },
      });
      const targets = [
        { type: 'key', id: 'key-1' },
        { type: 'sprite', id: sprite.id },
      ];
      const snapshot = createSelectionRotationSnapshot(
        document,
        targets,
        MODE,
      )!;
      const updates = rotateSelection(snapshot, delta)!;
      const after = applyUpdates(document, updates).spritePositions[MODE][0];
      expectWorldRotation(
        spriteWorldCorners(sprite),
        spriteWorldCorners(after),
        snapshot.center,
        delta,
      );
      sprite.poses.forEach((pose, index) => {
        expectWorldRotation(
          spriteWorldCorners(sprite, pose),
          spriteWorldCorners(after, after.poses[index]),
          snapshot.center,
          delta,
        );
        expect(after.poses[index].pivot).toEqual(pose.pivot);
        expect(after.poses[index].transform.scale).toBe(pose.transform.scale);
        expect(after.poses[index].imageOverrideMetrics).toEqual(
          pose.imageOverrideMetrics,
        );
      });
      expect(after.width).toBe(sprite.width);
      expect(after.height).toBe(sprite.height);
      expect(after.pivot).toEqual(sprite.pivot);
      expect(after.idleTransform.scale).toBe(sprite.idleTransform.scale);
      expect(after.idleTransform).toEqual(sprite.idleTransform);
      expect(after.poses).toEqual(sprite.poses);
      expect(
        Object.keys(
          updates.find((update) => update.type === 'sprite')!.patch,
        ).sort(),
      ).toEqual(['dx', 'dy', 'rotation']);
    },
  );

  it('±180 경계에서도 기존 자세 전환의 회전 경로와 중간 translate를 보존한다', () => {
    const sprite = detailedSprite();
    sprite.rotation = 175;
    sprite.idleTransform.rotation = 170;
    sprite.poses[0].transform.rotation = -170;
    const snapshot = createSelectionRotationSnapshot(
      documentWith({ spritePositions: { [MODE]: [sprite] } }),
      [{ type: 'sprite', id: sprite.id }],
      MODE,
    )!;
    const delta = 20;
    const after = {
      ...sprite,
      ...rotateSelection(snapshot, delta)![0].patch,
    } as ReactiveSpritePosition;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    expect(after.rotation).toBe(-165);
    expect(after.idleTransform).toEqual(sprite.idleTransform);
    expect(after.poses).toEqual(sprite.poses);
    for (const t of [0, 0.2, 0.5, 0.85, 1]) {
      const interpolated = {
        x: lerp(sprite.idleTransform.x, sprite.poses[0].transform.x, t),
        y: lerp(sprite.idleTransform.y, sprite.poses[0].transform.y, t),
        rotation: lerp(
          sprite.idleTransform.rotation,
          sprite.poses[0].transform.rotation,
          t,
        ),
        scale: lerp(
          sprite.idleTransform.scale,
          sprite.poses[0].transform.scale,
          t,
        ),
      };
      expectWorldRotation(
        spriteWorldCorners(sprite, sprite.poses[0], interpolated),
        spriteWorldCorners(after, after.poses[0], interpolated),
        snapshot.center,
        delta,
      );
    }
  });

  it.each([
    [170, 20, -170],
    [-170, -20, 170],
    [180, 180, 0],
    [-180, 0, -180],
    [-180, 360, -180],
    [15, -1000000000000, 95],
  ])('시작 %s°와 delta %s°를 %s°로 저장한다', (rotation, delta, expected) => {
    const snapshot = createSelectionRotationSnapshot(
      documentWith({ keyPositions: { [MODE]: [key({ rotation })] } }),
      [{ type: 'key', id: 'key-1' }],
      MODE,
    )!;
    expect(rotateSelection(snapshot, delta)![0].patch.rotation).toBe(expected);
  });

  it('같은 시작 스냅샷에 반복 적용해도 누적 오차나 원본 변경이 없다', () => {
    const document = mixedDocument();
    document.spritePositions[MODE] = [detailedSprite()];
    const targets = [...mixedTargets, { type: 'sprite', id: 'sprite-1' }];
    const snapshot = createSelectionRotationSnapshot(document, targets, MODE)!;
    const first = rotateSelection(snapshot, 45)!;
    rotateSelection(snapshot, 80);
    expect(rotateSelection(snapshot, 45)).toEqual(first);
    const spritePatch = first.find((update) => update.type === 'sprite')!.patch;
    expect(spritePatch).not.toHaveProperty('poses');
    const oldDx = spritePatch.dx;
    spritePatch.dx = 123;
    expect(
      rotateSelection(snapshot, 45)!.find((update) => update.type === 'sprite')!
        .patch.dx,
    ).toBe(oldDx);
    const zero = applyUpdates(document, rotateSelection(snapshot, -720)!);
    expect(zero).toEqual(document);
    expect(first[0].patch.dx).not.toBe(Math.round(first[0].patch.dx as number));
  });

  it('직각은 좌표 한계 그대로 통과하고 45°가 한 요소라도 한계를 넘으면 전체 거부한다', () => {
    const document = documentWith({
      keyPositions: {
        [MODE]: [
          key({ id: 'a', dx: 32768, dy: 32768, width: 20, height: 20 }),
          key({ id: 'b', dx: -32768, dy: -32768, width: 20, height: 20 }),
        ],
      },
    });
    const snapshot = createSelectionRotationSnapshot(
      document,
      [
        { type: 'key', id: 'a' },
        { type: 'key', id: 'b' },
      ],
      MODE,
    )!;
    expect(
      rotateSelection(snapshot, 90)!.map((update) => update.patch),
    ).toEqual([
      { dx: -32768, dy: 32768, rotation: 90 },
      { dx: 32768, dy: -32768, rotation: 90 },
    ]);
    expect(rotateSelection(snapshot, 45)).toBeNull();
  });

  it.each(['idle', 'pose'])(
    '%s의 기존 translation 한계값을 변경하지 않고 회전한다',
    (state) => {
      const transform = { x: 2000, y: 2000, rotation: 0, scale: 1 };
      const sprite = makeSpritePosition(
        state === 'idle'
          ? { idleTransform: transform }
          : { poses: [makeSpritePose({ transform })] },
      );
      const document = documentWith({
        keyPositions: { [MODE]: [key()] },
        spritePositions: { [MODE]: [sprite] },
      });
      const snapshot = createSelectionRotationSnapshot(
        document,
        [
          { type: 'key', id: 'key-1' },
          { type: 'sprite', id: sprite.id },
        ],
        MODE,
      )!;
      const rotated = applyUpdates(document, rotateSelection(snapshot, 45)!);
      expect(rotated.spritePositions[MODE][0].idleTransform).toEqual(
        sprite.idleTransform,
      );
      expect(rotated.spritePositions[MODE][0].poses).toEqual(sprite.poses);
      expect(rotateSelection(snapshot, 90)).not.toBeNull();
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    '유한하지 않은 delta %s를 거부한다',
    (delta) => {
      const snapshot = createSelectionRotationSnapshot(
        mixedDocument(),
        mixedTargets,
        MODE,
      )!;
      expect(rotateSelection(snapshot, delta)).toBeNull();
    },
  );
});
