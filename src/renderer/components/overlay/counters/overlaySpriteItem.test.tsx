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
import {
  applyEventKeyState,
  resetAllKeySignals,
  setKeyActive,
} from '@stores/signals/keySignals';

import OverlaySpriteItem from './OverlaySpriteItem';
import {
  makeCanonicalSpritePosition,
  makeSpritePose,
} from '@utils/sprite/spriteFixtures';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BASE_IMAGE = 'data:image/png;base64,base';
const OVERRIDE_IMAGE = 'data:image/png;base64,override';

const makePose = (
  poseId: string,
  triggers: string[],
  overrides: Partial<SpritePose> = {},
): SpritePose =>
  makeSpritePose({
    poseId,
    triggers,
    transform: { x: 10, y: -6, rotation: 15, scale: 1.2 },
    ...overrides,
  });

const makeSprite = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition =>
  makeCanonicalSpritePosition({
    dx: 12,
    dy: 24,
    width: 300,
    height: 200,
    zIndex: 5,
    layerName: null,
    groupId: null,
    baseImage: BASE_IMAGE,
    imageRect: { x: 10, y: 20, width: 120, height: 80 },
    pivot: { x: 0.5, y: 1 },
    poses: [makePose('p1', ['el-a'])],
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
    // 히트 마커로 네이티브 히트 패널에 참여 - 상호작용은 패널 몫이라 pointer-events는 none 유지
    expect(el?.dataset.overlayHit).toBe('true');

    const img = imgEl();
    expect(img?.getAttribute('src')).toBe(BASE_IMAGE);
    // 기본 모드는 외관 채널을 변수로만 싣는다 - 전역 :where 규칙 소비
    expect(img?.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.style.transformOrigin).toBe('50% 100%');
    expect(img?.style.getPropertyValue('--dmn-sprite-transition-default')).toBe(
      'transform 90ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
  });

  it('트리거 눌림이 pose transform과 active 상태로 바꾸고, 뗌은 idle로 되돌린다', () => {
    render(makeSprite());

    act(() => setKeyActive('KeyA', true));
    expect(spriteEl()?.dataset.state).toBe('active');
    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe('translate(10px, -6px) rotate(15deg) scale(1.2)');

    act(() => setKeyActive('KeyA', false));
    expect(spriteEl()?.dataset.state).toBe('idle');
    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
  });

  it('useInlineStyles=false는 외관 채널을 인라인 선언 없이 변수로만 싣는다', () => {
    render(makeSprite({ useInlineStyles: false, imageFit: 'cover' }));

    const img = imgEl();
    // 인라인 선언이 비어야 사용자 CSS가 !important 없이 이긴다
    expect(img?.style.transform).toBe('');
    expect(img?.style.transition).toBe('');
    expect(img?.style.objectFit).toBe('');
    expect(img?.style.getPropertyValue('--dmn-sprite-fit-default')).toBe(
      'cover',
    );
    expect(img?.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.style.getPropertyValue('--dmn-sprite-transition-default')).toBe(
      'transform 90ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
    // 배치·기준점은 모드와 무관하게 인라인
    expect(img?.style.left).toBe('10px');
    expect(img?.style.transformOrigin).toBe('50% 100%');
  });

  it('발산 easing은 전환에서 폴백 곡선으로 강등된다', () => {
    render(makeSprite({ transitionEasing: 'cubic-bezier(0.5, 10, 0.5, -9)' }));

    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transition-default'),
    ).toBe('transform 90ms ease');
  });

  it('useInlineStyles=true는 외관 채널을 인라인 선언으로 승격한다', () => {
    render(makeSprite({ useInlineStyles: true, imageFit: 'cover' }));

    const img = imgEl();
    expect(img?.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.style.transition).toBe(
      'transform 90ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
    expect(img?.style.objectFit).toBe('cover');
    expect(img?.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      '',
    );

    // 눌림 전환도 인라인 transform으로 반영
    act(() => setKeyActive('KeyA', true));
    expect(imgEl()?.style.transform).toBe(
      'translate(10px, -6px) rotate(15deg) scale(1.2)',
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

// onPress 단발 재생 - edge 채널·WAAPI 소유권·이미지 수명주기
describe('OverlaySpriteItem onPress', () => {
  interface MockAnimation {
    keyframes: Array<Record<string, string>>;
    options: KeyframeAnimationOptions;
    cancel: () => void;
    cancelled: boolean;
    onfinish: (() => void) | null;
    oncancel: (() => void) | null;
  }

  let container: HTMLDivElement;
  let root: Root;
  let animations: MockAnimation[];
  const proto = HTMLImageElement.prototype as unknown as { animate?: unknown };
  const originalAnimate = proto.animate;

  const oneShotSprite = (
    overrides: Partial<CanonicalReactiveSpritePosition> = {},
  ) =>
    makeSprite({
      activation: 'onPress',
      pressDurationMs: 300,
      poses: [makePose('p1', ['el-a'], { imageOverride: OVERRIDE_IMAGE })],
      ...overrides,
    });

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

  const imgEl = () => container.querySelector('img');

  beforeEach(() => {
    animations = [];
    proto.animate = function animate(
      keyframes: Array<Record<string, string>>,
      options: KeyframeAnimationOptions,
    ) {
      const animation: MockAnimation = {
        keyframes,
        options,
        cancelled: false,
        cancel: () => {
          animation.cancelled = true;
          animation.oncancel?.();
        },
        onfinish: null,
        oncancel: null,
      };
      animations.push(animation);
      return animation;
    };
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
    if (originalAnimate === undefined) delete proto.animate;
    else proto.animate = originalAnimate;
  });

  it('실입력 DOWN edge가 자세→idle 재생을 시작하고 종료 시 기본 이미지로 복원한다', () => {
    render(oneShotSprite());
    const img = imgEl()!;
    expect(img.src).toContain(BASE_IMAGE);

    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes[0].transform).toBe(
      'translate(10px, -6px) rotate(15deg) scale(1.2)',
    );
    expect(animations[0].keyframes[1].transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(animations[0].options.duration).toBe(300);
    expect(animations[0].options.fill).toBe('none');
    expect(img.src).toContain(OVERRIDE_IMAGE);

    act(() => animations[0].onfinish?.());
    expect(img.src).toContain(BASE_IMAGE);
  });

  it('하이드레이션 레벨 세팅은 재생을 트리거하지 않는다 - 유령 단발 방지', () => {
    render(oneShotSprite());
    act(() => setKeyActive('KeyA', true));
    act(() => setKeyActive('KeyA', false));
    expect(animations).toHaveLength(0);
  });

  it('이미 눌린 키의 반복 DOWN은 edge가 아니다', () => {
    render(oneShotSprite());
    act(() => applyEventKeyState('KeyA', true));
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
  });

  it('재트리거는 이전 재생을 취소하고, 늦은 복원 콜백이 새 이미지를 덮지 않는다', () => {
    render(oneShotSprite());
    act(() => applyEventKeyState('KeyA', true));
    const first = animations[0];
    // 소유권 검증 대상 - 재트리거 전에 콜백을 캡처해 지연 호출을 재현한다
    const lateRestore = first.onfinish;

    act(() => applyEventKeyState('KeyA', false));
    act(() => applyEventKeyState('KeyA', true));
    expect(first.cancelled).toBe(true);
    expect(first.onfinish).toBeNull();
    expect(animations).toHaveLength(2);

    lateRestore?.();
    expect(imgEl()!.src).toContain(OVERRIDE_IMAGE);

    act(() => animations[1].onfinish?.());
    expect(imgEl()!.src).toContain(BASE_IMAGE);
  });

  it('기본 이미지 없이 자세 이미지만 있어도 재생 순간에만 표시된다', () => {
    render(oneShotSprite({ baseImage: null }));
    const img = imgEl()!;
    expect(img.style.visibility).toBe('hidden');
    expect(img.hasAttribute('src')).toBe(false);

    act(() => applyEventKeyState('KeyA', true));
    expect(img.style.visibility).toBe('');
    expect(img.src).toContain(OVERRIDE_IMAGE);

    act(() => animations[0].onfinish?.());
    expect(img.style.visibility).toBe('hidden');
    expect(img.hasAttribute('src')).toBe(false);
  });

  it('리싱크가 레벨을 선점해도 실제 DOWN edge는 재생된다', () => {
    render(oneShotSprite());
    // OBS 대조·하이드레이션이 이벤트보다 먼저 레벨을 true로 올린 상황
    act(() => setKeyActive('KeyA', true));
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
  });

  it('이미지 없는 자세로 재트리거하면 이전 자세 이미지 잔상을 걷어낸다', () => {
    render(
      oneShotSprite({
        baseImage: null,
        poses: [
          makePose('p1', ['el-a'], { imageOverride: OVERRIDE_IMAGE }),
          makePose('p2', ['el-b']),
        ],
      }),
      new Map([
        ['el-a', 'KeyA'],
        ['el-b', 'KeyB'],
      ]),
    );
    const img = imgEl()!;

    act(() => applyEventKeyState('KeyA', true));
    expect(img.src).toContain(OVERRIDE_IMAGE);
    act(() => applyEventKeyState('KeyA', false));

    act(() => applyEventKeyState('KeyB', true));
    expect(animations).toHaveLength(2);
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.style.visibility).toBe('hidden');
  });

  it('whileHeld로 전환하면 진행 중 재생이 취소된다', () => {
    const sprite = oneShotSprite();
    render(sprite);
    act(() => applyEventKeyState('KeyA', true));
    expect(animations[0].cancelled).toBe(false);

    act(() => applyEventKeyState('KeyA', false));
    render({ ...sprite, activation: 'whileHeld' });
    expect(animations[0].cancelled).toBe(true);
    // 재생 중 직접 쓴 override src가 새 모드로 새지 않는다 (분기 key 재마운트)
    expect(imgEl()!.src).toContain(BASE_IMAGE);
  });

  it('외부 취소도 기본 이미지 복원 계약을 지킨다', () => {
    render(oneShotSprite());
    const img = imgEl()!;
    act(() => applyEventKeyState('KeyA', true));
    expect(img.src).toContain(OVERRIDE_IMAGE);

    // 우리 재트리거·정리가 아닌 외부 cancel (콜백이 붙은 채로 취소됨)
    act(() => animations[0].cancel());
    expect(img.src).toContain(BASE_IMAGE);
  });

  it('whileHeld 스프라이트는 edge 채널로 재생되지 않는다', () => {
    render(makeSprite());
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(0);
  });

  // WAAPI는 무효 easing을 TypeError로 거부한다 - 강등 없이 넘기면 재생이 끊기고
  // 복원 콜백이 붙지 않아 자세 이미지가 그대로 고착된다
  it('무효 easing은 폴백 곡선으로 강등해 재생에 넘긴다', () => {
    render(oneShotSprite({ transitionEasing: 'cubic-bezier(2, 0, 0.5, 1)' }));
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
    expect(animations[0].options.easing).toBe('ease');
  });
});
