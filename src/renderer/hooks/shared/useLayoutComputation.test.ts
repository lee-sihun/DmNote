import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { SpriteTransform } from '@src/types/key/sprites';
import { DEFAULT_SPRITE_TRANSITION_EASING } from '@src/types/key/sprites';

import { computeLayout } from './useLayoutComputation';
import {
  computeTrackGeometry,
  trackRectFromOrigin,
} from '@utils/layout/trackGeometry';

const makeTransform = (
  overrides: Partial<SpriteTransform> = {},
): SpriteTransform => ({
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  ...overrides,
});

const makeSprite = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  activation: 'whileHeld',
  pressDurationMs: 300,
  rotation: 0,
  id: 'sprite-1',
  dx: 100,
  dy: 50,
  width: 200,
  height: 200,
  hidden: false,
  zIndex: null,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  baseImage: 'base.png',
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: makeTransform(),
  poses: [],
  transitionMs: 90,
  transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
  referenceNaturalSize: null,
  ...overrides,
});

const makeInput = (
  sprites: CanonicalReactiveSpritePosition[],
  keys: { canonicals: string[]; ids: string[] } = { canonicals: [], ids: [] },
) => ({
  currentKeys: keys.canonicals,
  // 키는 스프라이트 활동 영역과 같은 자리에 둔다 - 콘텐츠 바운즈를 바꾸지 않아야
  // 도달 범위 차이만 검증된다
  currentPositions: keys.ids.map((id) => ({
    id,
    dx: 100,
    dy: 50,
    width: 200,
    height: 200,
  })) as never,
  currentStatPositions: [],
  currentGraphPositions: [],
  currentKnobPositions: [],
  currentSpritePositions: sprites,
  trackHeight: 150,
  noteSettings: DEFAULT_NOTE_SETTINGS,
  selectedKeyType: '4key',
});

// PADDING 30, trackHeight 150 기준 topOffset 180
describe('computeLayout 스프라이트 오버행', () => {
  it('이미지가 없어도 회전한 활동 영역과 히트 상자는 창 안에 남긴다', () => {
    const layout = computeLayout(
      makeInput([
        makeSprite({ width: 200, height: 100, rotation: 90, baseImage: null }),
      ]),
    );
    expect(layout.bounds?.minX).toBeCloseTo(100, 8);
    expect(layout.bounds?.minY).toBeCloseTo(0, 8);
    expect(layout.bounds?.maxX).toBeCloseTo(300, 8);
    expect(layout.bounds?.maxY).toBeCloseTo(200, 8);
  });

  it('배치 회전으로 세로가 된 자세 이동의 도달 끝까지 창을 넓힌다', () => {
    const layout = computeLayout(
      makeInput([
        makeSprite({
          width: 200,
          height: 100,
          rotation: 90,
          idleTransform: makeTransform({ x: 300 }),
        }),
      ]),
    );
    expect(layout.bounds?.minX).toBeCloseTo(100, 8);
    expect(layout.bounds?.minY).toBeCloseTo(0, 8);
    expect(layout.bounds?.maxX).toBeCloseTo(300, 8);
    expect(layout.bounds?.maxY).toBeCloseTo(500, 8);
  });
  it('오버행 없는 스프라이트는 활동 영역이 곧 창 바운즈다', () => {
    const layout = computeLayout(makeInput([makeSprite()]));
    expect(layout.bounds).toEqual({
      minX: 100,
      minY: 50,
      maxX: 300,
      maxY: 250,
    });
    expect(layout.backgroundBox).toEqual({
      x: 0,
      y: 0,
      width: 260,
      height: 410,
    });
    expect(layout.positionOffset).toEqual({ x: -70, y: 130 });
    expect(layout.topMostY).toBe(180);
    expect(layout.leftMostX).toBe(30);
  });

  it('45도 회전 오버행은 창 바운즈만 넓히고 배경 박스 크기는 그대로다', () => {
    const layout = computeLayout(
      makeInput([
        makeSprite({ idleTransform: makeTransform({ rotation: 45 }) }),
      ]),
    );
    // 대각선 오버행 41.42가 활동 영역 사방으로 붙는다
    expect(layout.bounds?.minX).toBeCloseTo(58.5786, 3);
    expect(layout.bounds?.minY).toBeCloseTo(8.5786, 3);
    expect(layout.bounds?.maxX).toBeCloseTo(341.4214, 3);
    expect(layout.bounds?.maxY).toBeCloseTo(291.4214, 3);

    // 배경 박스는 콘텐츠 바운즈 기준 위치·크기 유지
    expect(layout.backgroundBox?.x).toBeCloseTo(41.4214, 3);
    expect(layout.backgroundBox?.y).toBeCloseTo(41.4214, 3);
    expect(layout.backgroundBox?.width).toBe(260);
    expect(layout.backgroundBox?.height).toBe(410);

    // 아이템 오프셋은 창 바운즈 기준이라 콘텐츠가 여유만큼 안쪽으로 밀린다
    expect(layout.positionOffset.x).toBeCloseTo(30 - 58.5786, 3);
    expect(layout.positionOffset.y).toBeCloseTo(180 - 8.5786, 3);
    expect(layout.displaySpritePositions[0].dx).toBeCloseTo(71.4214, 3);

    // 트랙 시작은 콘텐츠 상단을 따라간다
    expect(layout.topMostY).toBeCloseTo(221.4214, 3);
    // 왼쪽 오버행도 같은 방식 - 네이티브 x 보정이 이 delta를 소비한다
    expect(layout.leftMostX).toBeCloseTo(71.4214, 3);
  });

  it('이미지 없는 스프라이트는 회전해도 창을 넓히지 않는다', () => {
    const layout = computeLayout(
      makeInput([
        makeSprite({
          baseImage: null,
          idleTransform: makeTransform({ rotation: 45 }),
        }),
      ]),
    );
    expect(layout.bounds).toEqual({
      minX: 100,
      minY: 50,
      maxX: 300,
      maxY: 250,
    });
    expect(layout.backgroundBox).toEqual({
      x: 0,
      y: 0,
      width: 260,
      height: 410,
    });
  });

  it('숨긴 스프라이트는 바운즈에 참여하지 않는다', () => {
    const layout = computeLayout(
      makeInput([
        makeSprite({
          hidden: true,
          idleTransform: makeTransform({ rotation: 45 }),
        }),
      ]),
    );
    expect(layout.bounds).toBeNull();
    expect(layout.backgroundBox).toBeNull();
  });
});

// 열거 게이트는 레이아웃 전체가 함께 켜지고 함께 꺼진다 - 일부만 열거하면
// 스프라이트 순서에 창 크기가 딸려간다
describe('computeLayout 도달 범위 열거 게이트', () => {
  // k1·k2가 같은 물리 키라 두 자세는 평균으로만 도달한다
  const coActivated = () =>
    makeSprite({
      id: 'co',
      poses: [
        {
          imageOverrideMetrics: null,
          poseId: 'a',
          triggers: ['k1'],
          transform: makeTransform({ x: -2000 }),
          imageOverride: null,
        },
        {
          imageOverrideMetrics: null,
          poseId: 'b',
          triggers: ['k2'],
          transform: makeTransform({ x: 2000 }),
          imageOverride: null,
        },
      ],
    });

  // 서로 다른 키 11개 - 스프라이트별 상한을 넘겨 전체 폴백을 유발한다
  const overCap = (overrides: Partial<CanonicalReactiveSpritePosition> = {}) =>
    makeSprite({
      id: 'over-cap',
      poses: Array.from({ length: 11 }, (_, index) => ({
        imageOverrideMetrics: null,
        poseId: `cap-${index}`,
        triggers: [`c${index}`],
        transform: makeTransform(),
        imageOverride: null,
      })),
      ...overrides,
    });

  const keys = {
    canonicals: [
      'KeyA',
      'KeyA',
      ...Array.from({ length: 11 }, (_, i) => `C${i}`),
    ],
    ids: ['k1', 'k2', ...Array.from({ length: 11 }, (_, i) => `c${i}`)],
  };

  it('열거가 켜지면 같은 키에 묶인 자세는 창을 넓히지 않는다', () => {
    const layout = computeLayout(makeInput([coActivated()], keys));
    expect(layout.bounds).toEqual({
      minX: 100,
      minY: 50,
      maxX: 300,
      maxY: 250,
    });
  });

  it('숨긴 고비용 스프라이트는 게이트 판정에 끼지 않는다', () => {
    const layout = computeLayout(
      makeInput([coActivated(), overCap({ hidden: true })], keys),
    );
    expect(layout.bounds).toEqual({
      minX: 100,
      minY: 50,
      maxX: 300,
      maxY: 250,
    });
  });

  // 개별은 상한 안이지만 합계가 예산을 넘는 경우 - 숫자 예산 자체를 고정한다.
  // g=10 스프라이트 하나가 약 31,764이라 16개면 500,000을 넘는다
  const tenGroup = (id: string) =>
    makeSprite({
      id,
      poses: Array.from({ length: 10 }, (_, index) => ({
        imageOverrideMetrics: null,
        poseId: `${id}-${index}`,
        triggers: [`c${index}`],
        transform: makeTransform(),
        imageOverride: null,
      })),
    });

  it('개별은 상한 안이어도 합계가 예산을 넘으면 전부 폴백한다', () => {
    const fill = (count: number) =>
      Array.from({ length: count }, (_, index) => tenGroup(`ten-${index}`));

    // 15개까지는 예산 안이라 열거가 유지된다
    expect(
      computeLayout(makeInput([coActivated(), ...fill(15)], keys)).bounds,
    ).toEqual({ minX: 100, minY: 50, maxX: 300, maxY: 250 });

    // 16개면 합계가 넘어 전부 폴백하고 창이 다시 넓어진다
    expect(
      computeLayout(makeInput([coActivated(), ...fill(16)], keys)).bounds.minX,
    ).toBeLessThan(0);
  });

  it('상한을 넘는 스프라이트가 하나라도 있으면 전부 폴백한다', () => {
    const layout = computeLayout(makeInput([coActivated(), overCap()], keys));
    // 폴백은 두 자세를 개별로 세므로 창이 다시 넓어진다
    expect(layout.bounds.minX).toBeLessThan(0);
  });
});

// 회전 요소·노트 추종. PADDING 30, trackHeight 200
describe('computeLayout 요소 회전', () => {
  const makeKey = (
    id: string,
    dx: number,
    dy: number,
    rotation: number,
    size = 60,
  ) =>
    ({
      id,
      dx,
      dy,
      width: size,
      height: size,
      rotation,
    } as never);
  const makeRotationInput = (
    keys: Array<{ id: string; dx: number; dy: number; rotation: number }>,
  ) => ({
    currentKeys: keys.map((key) => key.id),
    currentPositions: keys.map((key) =>
      makeKey(key.id, key.dx, key.dy, key.rotation),
    ),
    currentStatPositions: [],
    currentGraphPositions: [],
    currentKnobPositions: [],
    currentSpritePositions: [],
    trackHeight: 200,
    noteSettings: DEFAULT_NOTE_SETTINGS,
    selectedKeyType: '4key',
  });

  it('회전 0은 위쪽 트랙 밴드 하나로 예약하고 기존 공식과 같다', () => {
    const layout = computeLayout(
      makeRotationInput([{ id: 'A', dx: 100, dy: 100, rotation: 0 }]),
    );
    expect(layout.bounds).toEqual({
      minX: 100,
      minY: 100,
      maxX: 160,
      maxY: 160,
    });
    expect(layout.contentSize).toEqual({ width: 120, height: 320 });
    expect(layout.positionOffset).toEqual({ x: -70, y: 130 });
    expect(layout.backgroundBox).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 320,
    });
    expect(layout.topMostY).toBe(230);
    const [track] = layout.webglTracks as Array<{
      position: { dx: number; dy: number };
      direction: { x: number; y: number };
      width: number;
    }>;
    expect(track.position).toMatchObject({ dx: 30, dy: 230 });
    expect(track.direction).toEqual({ x: 0, y: -1 });
    expect(track.width).toBe(60);
  });

  it('아주 작은 회전에서 트랙 공간이 이중 예약되지 않는다', () => {
    const layout = computeLayout(
      makeRotationInput([{ id: 'A', dx: 100, dy: 100, rotation: 0.1 }]),
    );
    expect(layout.contentSize?.height).toBeGreaterThan(319);
    expect(layout.contentSize?.height).toBeLessThan(325);
    expect(layout.contentSize?.width).toBeGreaterThan(119);
    expect(layout.contentSize?.width).toBeLessThan(125);
  });

  it('90° 회전 키는 트랙이 오른쪽으로 흐르고 창·배경이 그만큼 넓어진다', () => {
    const layout = computeLayout(
      makeRotationInput([{ id: 'A', dx: 100, dy: 100, rotation: 90 }]),
    );
    expect(layout.contentSize?.width).toBeCloseTo(320, 6);
    expect(layout.contentSize?.height).toBeCloseTo(120, 6);
    expect(layout.positionOffset.x).toBeCloseTo(-70, 6);
    expect(layout.positionOffset.y).toBeCloseTo(-70, 6);
    expect(layout.backgroundBox?.x).toBeCloseTo(0, 6);
    expect(layout.backgroundBox?.y).toBeCloseTo(0, 6);
    expect(layout.backgroundBox?.width).toBeCloseTo(320, 6);
    expect(layout.backgroundBox?.height).toBeCloseTo(120, 6);
    expect(layout.topMostY).toBeCloseTo(30, 6);
    const [track] = layout.webglTracks as Array<{
      position: { dx: number; dy: number };
      direction: { x: number; y: number };
    }>;
    expect(track.position.dx).toBeCloseTo(90, 6);
    expect(track.position.dy).toBeCloseTo(30, 6);
    expect(track.direction.x).toBeCloseTo(1, 6);
    expect(track.direction.y).toBeCloseTo(0, 6);
  });

  it('회전 키와 축 정렬 키가 섞이면 밴드와 회전 트랙 AABB를 합친다', () => {
    const layout = computeLayout(
      makeRotationInput([
        { id: 'A', dx: 100, dy: 100, rotation: 0 },
        { id: 'B', dx: 300, dy: 100, rotation: 90 },
      ]),
    );
    expect(layout.contentSize?.width).toBeCloseTo(520, 6);
    expect(layout.contentSize?.height).toBeCloseTo(320, 6);
    expect(layout.backgroundBox?.width).toBeCloseTo(520, 6);
    expect(layout.backgroundBox?.height).toBeCloseTo(320, 6);
    // 자동 히트라인 기준선은 논리 콘텐츠 상단 그대로
    expect(layout.topMostY).toBe(230);
    const [upright, rotated] = layout.webglTracks as Array<{
      position: { dx: number; dy: number };
      direction: { x: number; y: number };
    }>;
    expect(upright.position).toMatchObject({ dx: 30, dy: 230 });
    expect(rotated.position.dx).toBeCloseTo(290, 6);
    expect(rotated.position.dy).toBeCloseTo(230, 6);
    expect(rotated.direction.x).toBeCloseTo(1, 6);
  });
});

describe('computeLayout 회전 키 자동 시작선', () => {
  const makeInput = (
    keys: Array<{
      id: string;
      dx: number;
      dy: number;
      rotation: number;
      noteAutoYCorrection?: boolean;
    }>,
  ) => ({
    currentKeys: keys.map((key) => key.id),
    currentPositions: keys.map(
      (key) =>
        ({
          id: key.id,
          dx: key.dx,
          dy: key.dy,
          width: 60,
          height: 60,
          rotation: key.rotation,
          noteAutoYCorrection: key.noteAutoYCorrection,
        } as never),
    ),
    currentStatPositions: [],
    currentGraphPositions: [],
    currentKnobPositions: [],
    currentSpritePositions: [],
    trackHeight: 200,
    noteSettings: DEFAULT_NOTE_SETTINGS,
    selectedKeyType: '4key',
  });
  const tracksOf = (layout: ReturnType<typeof computeLayout>) =>
    layout.webglTracks as Array<{ position: { dx: number; dy: number } }>;

  it('혼자 돌린 키는 자기 상변에서 시작하고 다른 각도 키는 기준에 안 들어간다', () => {
    const layout = computeLayout(
      makeInput([
        { id: 'A', dx: 100, dy: 100, rotation: 0 },
        { id: 'B', dx: 300, dy: 200, rotation: -51.4 },
      ]),
    );
    const [, rotated] = tracksOf(layout);
    const own = computeTrackGeometry({
      keyX: 300 + layout.positionOffset.x,
      keyY: 200 + layout.positionOffset.y,
      keyWidth: 60,
      keyHeight: 60,
      rotation: -51.4,
      trackHeight: 200,
    });
    expect(rotated.position.dx).toBeCloseTo(own.origin.x, 6);
    expect(rotated.position.dy).toBeCloseTo(own.origin.y, 6);
  });

  it('같은 각도의 키는 같은 시작선에 선다', () => {
    const layout = computeLayout(
      makeInput([
        { id: 'A', dx: 100, dy: 100, rotation: 90 },
        { id: 'B', dx: 140, dy: 200, rotation: 90 },
      ]),
    );
    const [a, b] = tracksOf(layout);
    expect(a.position.dx).toBeCloseTo(b.position.dx, 6);
    expect(layout.contentSize?.width).toBeCloseTo(360, 6);
  });

  it('손으로 돌려 각도가 조금 다른 키도 한 줄로 맞춘다', () => {
    const [a, b] = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 100, dy: 100, rotation: -51.4 },
          { id: 'B', dx: 200, dy: 100, rotation: -51.1 },
        ]),
      ),
    );
    const d = computeTrackGeometry({
      keyX: 0,
      keyY: 0,
      keyWidth: 60,
      keyHeight: 60,
      rotation: -51.4,
      trackHeight: 200,
    }).direction;
    const projectionA = a.position.dx * d.x + a.position.dy * d.y;
    const projectionB = b.position.dx * d.x + b.position.dy * d.y;
    // 방향이 0.3° 차이라 투영도 소수점 아래에서만 갈린다
    expect(Math.abs(projectionA - projectionB)).toBeLessThan(0.5);
  });

  it('보정을 끈 키는 자기 상변에서 시작하되 다른 키의 기준에는 참여한다', () => {
    const layout = computeLayout(
      makeInput([
        { id: 'A', dx: 100, dy: 100, rotation: 90, noteAutoYCorrection: false },
        { id: 'B', dx: 140, dy: 200, rotation: 90 },
      ]),
    );
    const [a, b] = tracksOf(layout);
    // A는 자기 오른쪽 변(160), B는 자기 변(200)이 더 앞서 있어 그대로
    expect(b.position.dx - a.position.dx).toBeCloseTo(40, 6);
  });

  it('각도가 다르면 서로 영향을 주지 않는다', () => {
    const layout = computeLayout(
      makeInput([
        { id: 'A', dx: 100, dy: 100, rotation: 90 },
        { id: 'B', dx: 300, dy: 100, rotation: -90 },
      ]),
    );
    const [a, b] = tracksOf(layout);
    // A는 자기 오른쪽 변(160), B는 자기 왼쪽 변(300)에서 출발
    expect(b.position.dx - a.position.dx).toBeCloseTo(140, 6);
  });
});

describe('computeLayout 회전 키 자동 시작선 세부', () => {
  const makeInput = (
    keys: Array<{
      id: string;
      dx: number;
      dy: number;
      width?: number;
      height?: number;
      rotation: number;
      noteOffsetX?: number;
      noteOffsetY?: number;
      noteWidth?: number;
      noteAlignment?: 'left' | 'center' | 'right';
    }>,
    trackHeight = 200,
  ) => ({
    currentKeys: keys.map((key) => key.id),
    currentPositions: keys.map(
      (key) =>
        ({
          id: key.id,
          dx: key.dx,
          dy: key.dy,
          width: key.width ?? 60,
          height: key.height ?? 60,
          rotation: key.rotation,
          noteOffsetX: key.noteOffsetX,
          noteOffsetY: key.noteOffsetY,
          noteWidth: key.noteWidth,
          noteAlignment: key.noteAlignment,
        } as never),
    ),
    currentStatPositions: [],
    currentGraphPositions: [],
    currentKnobPositions: [],
    currentSpritePositions: [],
    trackHeight,
    noteSettings: DEFAULT_NOTE_SETTINGS,
    selectedKeyType: '4key',
  });
  const tracksOf = (layout: ReturnType<typeof computeLayout>) =>
    layout.webglTracks as Array<{ position: { dx: number; dy: number } }>;

  it.each([
    { noteOffsetY: -100 },
    { noteWidth: 200, noteAlignment: 'left' as const },
    { noteWidth: 200, noteAlignment: 'center' as const },
    { noteWidth: 200, noteAlignment: 'right' as const },
  ])('0°와 미세 회전 모두 실제 노트 영역을 창 안에 둔다: %j', (extra) => {
    for (const rotation of [0, 0.0001, 0.1, -0.1]) {
      const layout = computeLayout(
        makeInput([
          { id: 'A', dx: 100, dy: 100, rotation, ...extra },
          { id: 'B', dx: 200, dy: 100, rotation: 0 },
        ]),
      );
      for (const track of layout.webglTracks) {
        if (!track) throw new Error('트랙 누락');
        const rect = trackRectFromOrigin(
          { x: track.position.dx, y: track.position.dy },
          track.direction,
          track.height,
          track.width,
        );
        expect(rect.minX).toBeGreaterThanOrEqual(30 - 1e-8);
        expect(rect.minY).toBeGreaterThanOrEqual(30 - 1e-8);
        expect(rect.maxX).toBeLessThanOrEqual(
          layout.contentSize!.width - 30 + 1e-8,
        );
        expect(rect.maxY).toBeLessThanOrEqual(
          layout.contentSize!.height - 30 + 1e-8,
        );
      }
    }
  });

  it('노트 X 오프셋 키를 미세하게 돌려도 콘텐츠 기준점은 그대로다', () => {
    // 오프셋 확장이 회전 여부로 갈리면 창 원점이 뛰어 다른 요소까지 화면에서 움직인다
    const flat = computeLayout(
      makeInput([
        { id: 'A', dx: 100, dy: 100, rotation: 0, noteOffsetX: -100 },
        { id: 'B', dx: 250, dy: 100, rotation: 0 },
      ]),
    );
    const tilted = computeLayout(
      makeInput([
        { id: 'A', dx: 100, dy: 100, rotation: 0.1, noteOffsetX: -100 },
        { id: 'B', dx: 250, dy: 100, rotation: 0 },
      ]),
    );
    expect(tilted.contentBounds).toEqual(flat.contentBounds);
    expect(tilted.leftMostX).toBe(flat.leftMostX);
    expect(tilted.displayPositions[1].dx).toBe(flat.displayPositions[1].dx);
  });

  it('0° 키 옆의 오차 안 미세 회전 키는 같은 히트라인에서 시작한다', () => {
    const [flatA, flatB] = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 0, dy: 100, rotation: 0 },
          { id: 'B', dx: 100, dy: 0, rotation: 0 },
        ]),
      ),
    );
    const [tiltedA, tiltedB] = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 0, dy: 100, rotation: 0.3 },
          { id: 'B', dx: 100, dy: 0, rotation: 0 },
        ]),
      ),
    );
    expect(flatA.position.dy).toBe(flatB.position.dy);
    // 기울어진 트랙이 위로 0.5px쯤 더 뻗어 창이 그만큼 자라는 것 외에는
    // A가 자기 상변(100px 아래)이 아니라 0° 키 B의 히트라인에서 시작한다
    expect(Math.abs(tiltedA.position.dy - tiltedB.position.dy)).toBeLessThan(1);
    expect(Math.abs(tiltedB.position.dy - flatB.position.dy)).toBeLessThan(1);
  });

  it('노트 Y 오프셋은 보정 뒤 로컬 프레임으로 얹혀 상쇄되지 않는다', () => {
    const base = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 100, dy: 100, rotation: 0 },
          { id: 'B', dx: 100, dy: 200, rotation: 90 },
        ]),
      ),
    );
    const offset = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 100, dy: 100, rotation: 0 },
          { id: 'B', dx: 100, dy: 200, rotation: 90, noteOffsetY: 20 },
        ]),
      ),
    );
    // 90°에서 로컬 +y(오프셋)는 화면 -x - 시작선이 왼쪽으로 20 이동
    expect(offset[1].position.dx - base[1].position.dx).toBeCloseTo(-20, 6);
    expect(offset[1].position.dy - base[1].position.dy).toBeCloseTo(0, 6);
  });

  it('같은 각도의 키·작은 키는 큰 키의 상변에 맞춰 공통선에 선다', () => {
    const [tall, short] = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 100, dy: 100, width: 20, height: 300, rotation: 90 },
          { id: 'B', dx: 100, dy: 100, width: 20, height: 20, rotation: 90 },
        ]),
      ),
    );
    expect(short.position.dx).toBeCloseTo(tall.position.dx, 6);
  });

  it('±180으로 저장된 두 키도 같은 아래쪽 시작선에 선다', () => {
    const [upper, lower] = tracksOf(
      computeLayout(
        makeInput([
          { id: 'A', dx: 100, dy: 100, rotation: -180 },
          { id: 'B', dx: 200, dy: 250, rotation: 180 },
        ]),
      ),
    );
    expect(upper.position.dy).toBeCloseTo(lower.position.dy, 6);
  });

  it('노트 효과가 꺼지면(트랙 높이 0) 회전 키가 창을 넓히지 않는다', () => {
    const layout = computeLayout(
      makeInput(
        [
          { id: 'A', dx: 0, dy: 0, rotation: 45 },
          { id: 'B', dx: 1000, dy: 1000, rotation: 45 },
        ],
        0,
      ),
    );
    // 회전 얼굴 AABB만큼만 커진다: 60×60 45° → 84.85
    expect(layout.contentSize?.width).toBeLessThan(1060 + 60 + 30);
    expect(layout.contentSize?.height).toBeLessThan(1060 + 60 + 30);
  });
});
