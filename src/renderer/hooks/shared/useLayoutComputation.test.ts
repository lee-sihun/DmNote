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
  ...overrides,
});

const makeInput = (sprites: CanonicalReactiveSpritePosition[]) => ({
  currentKeys: [],
  currentPositions: [],
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
