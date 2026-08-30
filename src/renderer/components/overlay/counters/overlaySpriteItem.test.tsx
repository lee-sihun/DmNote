/**
 * 반응형 스프라이트 잎 렌더
 * - 트리거 눌림이 transform과 data-state를 바꾸고, 미눌림이면 idle을 유지한다
 * - 매핑에 없는 트리거는 무시되고, 실패한 이미지 src는 baseImage로 폴백한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { SpritePose } from '@src/types/key/sprites';
import { resetAllKeySignals, setKeyActive } from '@stores/signals/keySignals';

import OverlaySpriteItem from './OverlaySpriteItem';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_IMAGE = 'data:image/png;base64,base';
const OVERRIDE_IMAGE = 'data:image/png;base64,override';

const makePose = (
  poseId: string,
  triggers: string[],
  overrides: Partial<SpritePose> = {},
): SpritePose => ({
  poseId,
  triggers,
  matchMode: 'exact',
  transform: { x: 10, y: -6, rotation: 15, scale: 1.2 },
  imageOverride: null,
  ...overrides,
});

const makeSprite = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  id: 'sprite-1',
  dx: 12,
  dy: 24,
  width: 300,
  height: 200,
  hidden: false,
  zIndex: 5,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  baseImage: BASE_IMAGE,
  imageFit: null,
  imageRect: { x: 10, y: 20, width: 120, height: 80 },
  pivot: { x: 0.5, y: 1 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [makePose('p1', ['el-a'])],
  activation: 'whileHeld',
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  ...overrides,
});

const keyCanonicalMap: ReadonlyMap<string, string> = new Map([
  ['el-a', 'KeyA'],
]);

describe('OverlaySpriteItem', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (
    position: CanonicalReactiveSpritePosition,
    map: ReadonlyMap<string, string> = keyCanonicalMap,
  ) => {
    act(() => {
      root.render(
        <OverlaySpriteItem position={position} keyCanonicalMap={map} />,
      );
    });
  };

  const spriteEl = () =>
    container.querySelector<HTMLElement>('[data-sprite-element="true"]');
  const imgEl = () => spriteEl()?.querySelector('img') ?? null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    resetAllKeySignals();
  });

  it('idle 상태를 idleTransform과 baseImage로 그린다', () => {
    render(makeSprite());

    const el = spriteEl();
    expect(el).not.toBeNull();
    expect(el?.dataset.state).toBe('idle');
    expect(el?.style.transform).toBe('translate3d(12px, 24px, 0)');
    expect(el?.style.width).toBe('300px');
    expect(el?.style.height).toBe('200px');
    expect(el?.style.zIndex).toBe('5');
    expect(el?.style.pointerEvents).toBe('none');
    // 시각 전용 - 히트 마커 없음
    expect(el?.hasAttribute('data-overlay-hit')).toBe(false);

    const img = imgEl();
    expect(img?.getAttribute('src')).toBe(BASE_IMAGE);
    expect(img?.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.style.transformOrigin).toBe('50% 100%');
    expect(img?.style.transition).toBe(
      'transform 90ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
  });

  it('트리거 눌림이 pose transform과 active 상태로 바꾸고, 뗌은 idle로 되돌린다', () => {
    render(makeSprite());

    act(() => setKeyActive('KeyA', true));
    expect(spriteEl()?.dataset.state).toBe('active');
    expect(imgEl()?.style.transform).toBe(
      'translate(10px, -6px) rotate(15deg) scale(1.2)',
    );

    act(() => setKeyActive('KeyA', false));
    expect(spriteEl()?.dataset.state).toBe('idle');
    expect(imgEl()?.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
  });

  it('매핑에 없는 트리거는 눌림을 무시한다', () => {
    render(makeSprite(), new Map());

    act(() => setKeyActive('KeyA', true));
    expect(spriteEl()?.dataset.state).toBe('idle');
  });

  it('imageOverride pose는 눌림에서 이미지를 교체한다', () => {
    render(
      makeSprite({
        poses: [makePose('p1', ['el-a'], { imageOverride: OVERRIDE_IMAGE })],
      }),
    );

    expect(imgEl()?.getAttribute('src')).toBe(BASE_IMAGE);
    act(() => setKeyActive('KeyA', true));
    expect(imgEl()?.getAttribute('src')).toBe(OVERRIDE_IMAGE);
  });

  it('실패한 override src는 baseImage로 폴백하고, base도 실패하면 img를 내리지 않는다', () => {
    render(
      makeSprite({
        poses: [makePose('p1', ['el-a'], { imageOverride: OVERRIDE_IMAGE })],
      }),
    );

    act(() => setKeyActive('KeyA', true));
    const img = imgEl();
    expect(img?.getAttribute('src')).toBe(OVERRIDE_IMAGE);

    act(() => {
      img?.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(imgEl()?.getAttribute('src')).toBe(BASE_IMAGE);

    act(() => {
      imgEl()?.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(imgEl()).toBeNull();
    // 이미지가 없어도 요소 자체는 남는다
    expect(spriteEl()?.dataset.state).toBe('active');
  });

  it('hidden이면 아무것도 그리지 않는다', () => {
    render(makeSprite({ hidden: true }));
    expect(spriteEl()).toBeNull();
  });
});
