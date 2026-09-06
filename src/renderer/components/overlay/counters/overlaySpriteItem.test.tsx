/**
 * 반응형 스프라이트 잎 렌더
 * - 트리거 눌림이 transform과 data-sprite-state를 바꾸고, 미눌림이면 inactive를 유지한다
 * - 매핑에 없는 트리거는 무시되고, 실패한 이미지 src는 baseImage로 폴백한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  // 위치·히트는 래퍼, 상태 표식은 안쪽 표면 (노브와 같은 배치)
  const wrapperEl = () =>
    container.querySelector<HTMLElement>('[data-overlay-hit="true"]');
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
    expect(el?.dataset.spriteState).toBe('inactive');

    // 히트 마커로 네이티브 히트 패널에 참여 - 상호작용은 패널 몫이라 pointer-events는 none 유지
    const wrapper = wrapperEl();
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toBe(el);
    expect(wrapper?.contains(el!)).toBe(true);
    expect(wrapper?.style.transform).toBe('translate3d(12px, 24px, 0)');
    expect(wrapper?.style.width).toBe('300px');
    expect(wrapper?.style.height).toBe('200px');
    expect(wrapper?.style.zIndex).toBe('5');
    expect(wrapper?.style.pointerEvents).toBe('none');

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

  it('배치 회전은 히트 상자에만 적용하고 whileHeld 전환 각도는 보존한다', () => {
    const position = makeSprite({
      rotation: 179,
      idleTransform: { x: 0, y: 0, rotation: -179, scale: 1 },
      poses: [
        makePose('p1', ['el-a'], {
          transform: { x: 10, y: -6, rotation: 179, scale: 1.2 },
        }),
      ],
    });
    render(position);
    const idle = imgEl()!.style.getPropertyValue(
      '--dmn-sprite-transform-default',
    );
    act(() => setKeyActive('KeyA', true));
    const active = imgEl()!.style.getPropertyValue(
      '--dmn-sprite-transform-default',
    );
    render({ ...position, rotation: -179 });
    expect(
      imgEl()!.style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe(active);
    expect(wrapperEl()!.style.transform).toBe(
      'translate3d(12px, 24px, 0) rotate(-179deg)',
    );
    expect(wrapperEl()!.style.transformOrigin).toBe('50% 50%');
    act(() => setKeyActive('KeyA', false));
    expect(
      imgEl()!.style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe(idle);
    expect(active).toContain('rotate(179deg)');
    expect(idle).toContain('rotate(-179deg)');
  });

  it('트리거 눌림이 pose transform과 active 상태로 바꾸고, 뗌은 idle로 되돌린다', () => {
    render(makeSprite());

    act(() => setKeyActive('KeyA', true));
    expect(spriteEl()?.dataset.spriteState).toBe('active');
    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe('translate(10px, -6px) rotate(15deg) scale(1.2)');

    act(() => setKeyActive('KeyA', false));
    expect(spriteEl()?.dataset.spriteState).toBe('inactive');
    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe('translate(0px, 0px) rotate(0deg) scale(1)');
  });

  it('useInlineStyles=false는 외관 채널을 인라인 선언 없이 변수로만 싣는다', () => {
    render(makeSprite({ useInlineStyles: false }));

    const img = imgEl();
    // 인라인 선언이 비어야 사용자 CSS가 !important 없이 이긴다
    expect(img?.style.transform).toBe('');
    expect(img?.style.transition).toBe('');
    expect(img?.style.objectFit).toBe('');
    expect(img?.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.style.getPropertyValue('--dmn-sprite-transition-default')).toBe(
      'transform 90ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
    // 배치·기준점은 모드와 무관하게 인라인
    expect(img?.style.width).toBe('300px');
    expect(img?.style.transformOrigin).toBe('50% 100%');
  });

  it('발산 easing은 전환에서 폴백 곡선으로 강등된다', () => {
    render(makeSprite({ transitionEasing: 'cubic-bezier(0.5, 10, 0.5, -9)' }));

    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transition-default'),
    ).toBe('transform 90ms ease');
  });

  // whileHeld의 보간자는 CSS transition이라 onPress의 WAAPI try/catch가 닿지 않는다.
  // 엔진이 모르는 timing-function은 선언 전체가 버려져 0ms 스냅이 되므로,
  // 문법 게이트를 통과한 값도 선언 전에 엔진 지원을 확인해야 한다
  it('엔진이 거부하는 easing은 whileHeld 전환에서도 폴백 곡선으로 강등된다', () => {
    const unsupported = 'linear(0, 0.25 75%, 1)';
    const supports = vi
      .spyOn(CSS, 'supports')
      .mockImplementation((...args: unknown[]) =>
        args[0] === 'transition-timing-function' && args[1] === unsupported
          ? false
          : true,
      );

    render(makeSprite({ transitionEasing: unsupported }));

    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transition-default'),
    ).toBe('transform 90ms ease');
    supports.mockRestore();
  });

  // 강등 게이트가 지원되는 곡선까지 삼키면 whileHeld가 통째로 기본 곡선이 된다.
  // 폴백만 검사하면 그 회귀를 못 잡는다
  it('엔진이 지원하는 easing은 원문 그대로 전환에 실린다', () => {
    const supported = 'linear(0, 0.5 50%, 1)';
    const supports = vi.spyOn(CSS, 'supports').mockReturnValue(true);

    render(makeSprite({ transitionEasing: supported }));

    expect(
      imgEl()?.style.getPropertyValue('--dmn-sprite-transition-default'),
    ).toBe(`transform 90ms ${supported}`);
    supports.mockRestore();
  });

  it('useInlineStyles=true는 외관 채널을 인라인 선언으로 승격한다', () => {
    render(makeSprite({ useInlineStyles: true }));

    const img = imgEl();
    expect(img?.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.style.transition).toBe(
      'transform 90ms cubic-bezier(0.4, 0, 0.2, 1)',
    );
    expect(img?.style.objectFit).toBe('fill');
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
    expect(spriteEl()?.dataset.spriteState).toBe('inactive');
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
    expect(spriteEl()?.dataset.spriteState).toBe('active');
  });

  // 문서가 안내하는 선택자 형태 - 에디터에서만 먹고 오버레이에서 빗나가면
  // 사용자가 편집창에서 확인한 CSS가 실제 화면에서 조용히 사라진다
  it('문서의 클래스 한정 선택자가 오버레이에서 매치된다', () => {
    render(makeSprite({ className: 'left-hand' }));
    expect(
      container.querySelector('.left-hand [data-sprite-element] > img'),
    ).not.toBeNull();
  });

  it('hidden이면 아무것도 그리지 않는다', () => {
    render(makeSprite({ hidden: true }));
    expect(spriteEl()).toBeNull();
    // 래퍼가 남으면 보이지 않는 히트 영역이 생긴다
    expect(wrapperEl()).toBeNull();
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
    vi.restoreAllMocks();
  });

  // 사용자 CSS가 공개 변수로 자세 transform을 대체한 상태
  const stubTransformOverride = (value: string) => {
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (name: string) =>
        name === '--sprite-transform' ? value : '',
    } as unknown as CSSStyleDeclaration);
  };

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

  it('배치 ±180도 전환은 진행 중 WAAPI를 끊거나 자세 각도 경로를 바꾸지 않는다', () => {
    const position = oneShotSprite({
      rotation: 179,
      idleTransform: { x: 0, y: 0, rotation: -179, scale: 1 },
      poses: [
        makePose('p1', ['el-a'], {
          transform: { x: 10, y: -6, rotation: 179, scale: 1.2 },
        }),
      ],
    });
    render(position);
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
    const frames = structuredClone(animations[0].keyframes);
    for (const rotation of [180, -180, -179]) {
      render({ ...position, rotation });
      expect(animations).toHaveLength(1);
      expect(animations[0].cancelled).toBe(false);
      expect(animations[0].keyframes).toEqual(frames);
    }
    expect(frames[0].transform).toContain('rotate(179deg)');
    expect(frames[1].transform).toContain('rotate(-179deg)');
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

  // 스키마가 빈 문자열을 막지 않아 플러그인·임포트로 들어온다. 렌더러가 이걸
  // 이미지 없음으로 보는 이상 마운트 판정도 같아야 한다 - 아니면 재생할 것이
  // 없는 노드에 대고 WAAPI와 타이머만 돌린다
  it('공백 override만 있고 기본 이미지가 없으면 재생 노드를 만들지 않는다', () => {
    render(
      oneShotSprite({
        baseImage: null,
        poses: [makePose('p1', ['el-a'], { imageOverride: '   ' })],
      }),
    );

    expect(imgEl()).toBeNull();

    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(0);
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

  // 문서 편집 커밋은 coordinator가 문서를 통째로 clone해 모든 스프라이트 객체와
  // 키 맵이 새 identity를 받는다. 내용이 같으면 재구독하지 않아야 재생이 살아남는다
  it('같은 내용의 새 키 맵으로 리렌더돼도 진행 중 재생을 끊지 않는다', () => {
    const sprite = oneShotSprite();
    render(sprite);
    const img = imgEl()!;
    act(() => applyEventKeyState('KeyA', true));
    expect(img.src).toContain(OVERRIDE_IMAGE);

    render(sprite, new Map(keyCanonicalMap));
    expect(animations[0].cancelled).toBe(false);
    expect(img.src).toContain(OVERRIDE_IMAGE);
  });

  it('문서 복제로 자세 배열 identity가 바뀌어도 진행 중 재생을 끊지 않는다', () => {
    const sprite = oneShotSprite();
    render(sprite);
    const img = imgEl()!;
    act(() => applyEventKeyState('KeyA', true));

    render(structuredClone(sprite));
    expect(animations[0].cancelled).toBe(false);
    expect(img.src).toContain(OVERRIDE_IMAGE);
  });

  it('재생 중 배치 내용이 바뀌면 진행 중 재생을 끊고 기본 이미지·배치로 되돌린다', () => {
    const sprite = oneShotSprite();
    render(sprite);
    const img = imgEl()!;
    act(() => applyEventKeyState('KeyA', true));
    expect(img.src).toContain(OVERRIDE_IMAGE);

    // 상자가 바뀌면 React는 idle 스타일 차이만 다시 쓴다 - 직접 쓴 자세 배치가 남지 않게
    // 재생을 취소하고 한 벌로 복원한다
    render({ ...sprite, width: sprite.width + 10 });
    expect(animations[0].cancelled).toBe(true);
    expect(img.src).not.toContain(OVERRIDE_IMAGE);
    expect(img.style.width).toBe(`${sprite.width + 10}px`);
  });

  it('재생 중 자세 기준점·이동값이 바뀌면 진행 중 재생을 끊고 기본 이미지로 되돌린다', () => {
    const sprite = oneShotSprite();
    render(sprite);
    const img = imgEl()!;
    act(() => applyEventKeyState('KeyA', true));
    expect(img.src).toContain(OVERRIDE_IMAGE);

    // 이미지·상자는 그대로, 자세 기준점과 보정 이동값만 바뀐 문서 - 재생이 직접 쓴
    // 축·transform이 낡으므로 상자 변경과 같은 규칙으로 재생을 끊는다
    const pose = sprite.poses[0];
    render({
      ...sprite,
      poses: [
        {
          ...pose,
          pivot: { x: 0.25, y: 0.75 },
          transform: { ...pose.transform, x: pose.transform.x + 12 },
        },
      ],
    });
    expect(animations[0].cancelled).toBe(true);
    expect(img.src).not.toContain(OVERRIDE_IMAGE);
  });

  it('트리거의 canonical이 실제로 바뀌면 새 키로 재구독한다', () => {
    const sprite = oneShotSprite();
    render(sprite);
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
    act(() => applyEventKeyState('KeyA', false));

    render(sprite, new Map([['el-a', 'KeyB']]));
    expect(animations[0].cancelled).toBe(true);
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
    act(() => applyEventKeyState('KeyB', true));
    expect(animations).toHaveLength(2);
  });

  // 기본 모드의 외관 채널은 변수라 사용자 --sprite-transform이 자세 transform을
  // 대체한다. 애니메이션 원점은 사용자 CSS를 이기므로 재생 전에 걸러야 whileHeld와
  // 같은 결과(이미지만 교체)가 된다
  it('기본 모드에서 사용자 --sprite-transform이 잡혀 있으면 transform을 움직이지 않고 이미지만 재생한다', () => {
    vi.useFakeTimers();
    stubTransformOverride('rotate(0deg)');
    render(oneShotSprite());
    const img = imgEl()!;

    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(0);
    expect(img.style.transform).toBe('');
    expect(img.src).toContain(OVERRIDE_IMAGE);

    act(() => vi.advanceTimersByTime(300));
    expect(img.src).toContain(BASE_IMAGE);
    vi.useRealTimers();
  });

  it('오버라이드 중 재트리거는 이전 복원을 걷고 다시 예약한다', () => {
    vi.useFakeTimers();
    stubTransformOverride('rotate(0deg)');
    render(oneShotSprite());
    const img = imgEl()!;

    act(() => applyEventKeyState('KeyA', true));
    act(() => vi.advanceTimersByTime(200));
    act(() => applyEventKeyState('KeyA', false));
    act(() => applyEventKeyState('KeyA', true));
    act(() => vi.advanceTimersByTime(200));
    // 첫 재생 기준 400ms가 지났지만 두 번째 재생이 소유권을 가져 아직 자세 이미지다
    expect(img.src).toContain(OVERRIDE_IMAGE);
    act(() => vi.advanceTimersByTime(100));
    expect(img.src).toContain(BASE_IMAGE);
    vi.useRealTimers();
  });

  it('인라인 우선 모드는 사용자 변수와 무관하게 transform을 보간한다', () => {
    stubTransformOverride('rotate(0deg)');
    render(oneShotSprite({ useInlineStyles: true }));
    act(() => applyEventKeyState('KeyA', true));
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes[0]).toHaveProperty('transform');
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

  it('실패한 기본 이미지는 idle에서 숨기고 재생 복원도 숨김으로 끝낸다', () => {
    render(oneShotSprite());
    const img = imgEl()!;
    expect(img.src).toContain(BASE_IMAGE);

    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: false }));
    });
    // 깨진 노드를 남기면 투명 오버레이 위에 대체 박스가 상주한다
    expect(imgEl()!.hasAttribute('src')).toBe(false);
    expect(imgEl()!.style.visibility).toBe('hidden');

    // 자세 이미지는 멀쩡하므로 재생은 그대로 되고, 복원만 숨김으로 간다
    act(() => applyEventKeyState('KeyA', true));
    expect(imgEl()!.src).toContain(OVERRIDE_IMAGE);
    act(() => animations[0].onfinish?.());
    expect(imgEl()!.hasAttribute('src')).toBe(false);
    expect(imgEl()!.style.visibility).toBe('hidden');
  });

  it('재생 중 자세 이미지가 실패하면 그 자리에서 기본 이미지로 되돌린다', () => {
    render(oneShotSprite());
    act(() => applyEventKeyState('KeyA', true));
    const img = imgEl()!;
    expect(img.getAttribute('src')).toBe(OVERRIDE_IMAGE);

    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: false }));
    });
    // 직접 쓴 src라 React prop이 그대로다 - 리렌더를 기다리면 재생이 끝날 때까지
    // (최대 pressDurationMs) 깨진 이미지가 남는다
    expect(imgEl()!.getAttribute('src')).toBe(BASE_IMAGE);
    expect(imgEl()!.style.visibility).toBe('');
  });

  it('기본 이미지도 실패한 상태면 자세 실패 즉시 노드를 숨긴다', () => {
    render(oneShotSprite());
    act(() => {
      imgEl()!.dispatchEvent(new Event('error', { bubbles: false }));
    });

    act(() => applyEventKeyState('KeyA', true));
    expect(imgEl()!.getAttribute('src')).toBe(OVERRIDE_IMAGE);
    act(() => {
      imgEl()!.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(imgEl()!.hasAttribute('src')).toBe(false);
    expect(imgEl()!.style.visibility).toBe('hidden');
  });

  it('자세 이미지도 실패하면 실패한 base로 폴백하지 않는다', () => {
    render(oneShotSprite());
    act(() => {
      imgEl()!.dispatchEvent(new Event('error', { bubbles: false }));
    });

    act(() => applyEventKeyState('KeyA', true));
    expect(imgEl()!.src).toContain(OVERRIDE_IMAGE);
    act(() => {
      imgEl()!.dispatchEvent(new Event('error', { bubbles: false }));
    });

    act(() => applyEventKeyState('KeyA', false));
    act(() => applyEventKeyState('KeyA', true));
    expect(imgEl()!.hasAttribute('src')).toBe(false);
    expect(imgEl()!.style.visibility).toBe('hidden');
  });

  // jsdom은 실패 로드에 currentSrc를 채우지 않아 가드가 항상 통과한다.
  // 실기 엔진의 불일치를 재현해야 검증이 성립한다
  it('늦게 도착한 이전 src의 오류는 재생 중 이미지를 낙인찍지 않는다', () => {
    render(oneShotSprite());
    act(() => applyEventKeyState('KeyA', true));
    const img = imgEl()!;
    expect(img.getAttribute('src')).toBe(OVERRIDE_IMAGE);

    // 직전 base 요청의 오류가 자세 이미지로 갈아탄 뒤에 도착한 상황
    Object.defineProperty(img, 'currentSrc', {
      value: BASE_IMAGE,
      configurable: true,
    });
    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: false }));
    });

    act(() => applyEventKeyState('KeyA', false));
    act(() => applyEventKeyState('KeyA', true));
    expect(imgEl()!.getAttribute('src')).toBe(OVERRIDE_IMAGE);
  });

  // 문법 게이트는 엔진 지원까지 알 수 없다 - macOS 11 WebKit과 OBS의 CEF는
  // linear()를 거부한다. 던지는 자리가 src 교체 뒤라 복원이 없으면 고착된다.
  // 거부 easing은 모듈 수준에 기억되므로 케이스마다 다른 값을 쓴다
  const rejectAnimate = () => {
    proto.animate = function animate() {
      throw new TypeError('unsupported easing');
    };
  };

  it('엔진이 easing을 거부하면 스냅 폴백으로 재생하고 복원한다', () => {
    vi.useFakeTimers();
    rejectAnimate();
    render(oneShotSprite({ transitionEasing: 'linear(0, 0.25 25%, 1)' }));
    const img = imgEl()!;

    act(() => applyEventKeyState('KeyA', true));
    expect(img.src).toContain(OVERRIDE_IMAGE);
    expect(img.style.transform).toBe(
      'translate(10px, -6px) rotate(15deg) scale(1.2)',
    );

    act(() => vi.advanceTimersByTime(300));
    // 기본 모드는 transform을 비워야 CSS 변수 채널이 idle을 되찾는다
    expect(img.style.transform).toBe('');
    expect(img.src).toContain(BASE_IMAGE);
    vi.useRealTimers();
  });

  it('인라인 우선 모드의 스냅 폴백은 idle transform을 직접 되돌린다', () => {
    vi.useFakeTimers();
    rejectAnimate();
    render(
      oneShotSprite({
        useInlineStyles: true,
        transitionEasing: 'linear(0, 0.75 75%, 1)',
      }),
    );
    const img = imgEl()!;

    act(() => applyEventKeyState('KeyA', true));
    act(() => vi.advanceTimersByTime(300));
    // 비우면 React가 인라인으로 쓴 idle transform까지 사라진다 (prop 동일이라 복구 없음)
    expect(img.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    vi.useRealTimers();
  });

  it('폴백 재생 중 재구독되면 자세 transform도 함께 걷는다', () => {
    vi.useFakeTimers();
    rejectAnimate();
    const sprite = oneShotSprite({
      useInlineStyles: true,
      transitionEasing: 'linear(0, 0.4 40%, 1)',
    });
    render(sprite);
    const img = imgEl()!;

    act(() => applyEventKeyState('KeyA', true));
    expect(img.style.transform).toBe(
      'translate(10px, -6px) rotate(15deg) scale(1.2)',
    );

    // 트리거 canonical 교체로 구독 effect가 다시 돈다 - 타이머만 지우면 각도가 남는다
    render(sprite, new Map([['el-a', 'KeyB']]));
    expect(imgEl()!.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    vi.useRealTimers();
  });

  it('폴백 만료는 캡처값이 아니라 최신 idle transform으로 되돌린다', () => {
    vi.useFakeTimers();
    rejectAnimate();
    const sprite = oneShotSprite({
      useInlineStyles: true,
      transitionEasing: 'linear(0, 0.6 60%, 1)',
    });
    render(sprite);

    act(() => applyEventKeyState('KeyA', true));
    // 재생 중 idle이 바뀐다 - React가 최신 값을 쓴 뒤 타이머가 옛 값을 덮으면 안 된다
    render({
      ...sprite,
      idleTransform: { x: 4, y: 8, rotation: 30, scale: 2 },
    });

    act(() => vi.advanceTimersByTime(300));
    expect(imgEl()!.style.transform).toBe(
      'translate(4px, 8px) rotate(30deg) scale(2)',
    );
    vi.useRealTimers();
  });

  it('기본 이미지만 있고 그마저 실패하면 노드를 내린다', () => {
    render(oneShotSprite({ poses: [makePose('p1', ['el-a'])] }));
    act(() => {
      imgEl()!.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(imgEl()).toBeNull();
  });
});
