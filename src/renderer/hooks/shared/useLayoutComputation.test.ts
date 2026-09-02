import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTE_SETTINGS } from '@constants/overlayDefaults';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { SpriteTransform } from '@src/types/key/sprites';
import { DEFAULT_SPRITE_TRANSITION_EASING } from '@src/types/key/sprites';

import { computeLayout } from './useLayoutComputation';

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
  imageFit: null,
  imageRect: { x: 0, y: 0, width: 200, height: 200 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: makeTransform(),
  poses: [],
  transitionMs: 90,
  transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
  imagePlacement: 'box',
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
          contactPoint: { x: 0.5, y: 1 },
          imagePivot: null,
          imageOverrideMetrics: null,
          poseId: 'a',
          triggers: ['k1'],
          transform: makeTransform({ x: -2000 }),
          imageOverride: null,
        },
        {
          contactPoint: { x: 0.5, y: 1 },
          imagePivot: null,
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
        contactPoint: { x: 0.5, y: 1 },
        imagePivot: null,
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
        contactPoint: { x: 0.5, y: 1 },
        imagePivot: null,
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
