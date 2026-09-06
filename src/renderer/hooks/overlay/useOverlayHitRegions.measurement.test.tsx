import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HitRegionRect } from './useOverlayHitRegions';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  invoke: vi.fn((command: string) =>
    Promise.resolve(
      command === 'overlay_hit_renderer_ready'
        ? { epoch: 1 }
        : { accepted: true },
    ),
  ),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@api/modules/shared', () => ({
  subscribe: () => Object.assign(() => {}, { ready: Promise.resolve() }),
}));

const sizes = new Map<Element, { width: number; height: number }>();
const offsets = new Map<Element, number>();
const borders = new Map<Element, number>();
let observers: ResizeObserverModel[] = [];
let animations: Animation[] = [];
let rejectBorderBox = false;
let observedBoxes: (ResizeObserverBoxOptions | undefined)[] = [];
const originalGetAnimations = document.getAnimations;

const movingAnimation = (
  target: Element,
  keyframes: Keyframe[] = [{ transform: 'translateX(0)' }],
  pseudoElement: string | null = null,
) => {
  const state = {
    progress: 0 as number | null,
    currentIteration: 0,
    composite: 'replace',
    iterationComposite: 'replace',
    pseudoElement,
    keyframes,
  };
  const animation = {
    effect: {
      target,
      get pseudoElement() {
        return state.pseudoElement;
      },
      getKeyframes: () => state.keyframes,
      getComputedTiming: () => ({
        progress: state.progress,
        currentIteration: state.currentIteration,
      }),
      get composite() {
        return state.composite;
      },
      get iterationComposite() {
        return state.iterationComposite;
      },
    },
  } as unknown as Animation;
  animations.push(animation);
  return { animation, state };
};

// 관찰 시작 시 최초 크기를 통지하고 이후에는 실제 치수 변화만 통지
class ResizeObserverModel {
  private observed = new Map<
    Element,
    { size: string | null; box: ResizeObserverBoxOptions }
  >();

  constructor(private callback: ResizeObserverCallback) {
    observers.push(this);
  }

  observe(element: Element, options?: ResizeObserverOptions) {
    observedBoxes.push(options?.box);
    if (rejectBorderBox && options?.box === 'border-box') {
      throw new TypeError('border-box unsupported');
    }
    if (!this.observed.has(element)) {
      this.observed.set(element, {
        size: null,
        box: options?.box ?? 'content-box',
      });
    }
  }

  unobserve(element: Element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
  }

  deliver() {
    const changed: Element[] = [];
    for (const [element, previous] of this.observed) {
      const size = sizes.get(element)!;
      const border =
        previous.box === 'border-box' ? borders.get(element) ?? 0 : 0;
      const next = `${size.width + border * 2}x${size.height + border * 2}`;
      if (previous.size === next) continue;
      previous.size = next;
      changed.push(element);
    }
    if (changed.length > 0) {
      this.callback(
        changed.map((target) => ({ target } as ResizeObserverEntry)),
        this as unknown as ResizeObserver,
      );
    }
  }
}

let root: Root | null = null;
let nodes: ReturnType<typeof createHitNode>[] = [];

const createHitNode = (x: number) => {
  const node = document.createElement('div');
  node.dataset.overlayHit = 'true';
  node.style.width = '60px';
  node.style.height = '60px';
  const cos = Math.cos(Math.PI / 12);
  const sin = Math.sin(Math.PI / 12);
  node.style.transform = `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 0, 0)`;
  sizes.set(node, { width: 60, height: 60 });
  const measure = vi
    .spyOn(node, 'getBoundingClientRect')
    .mockImplementation(() => {
      const size = sizes.get(node)!;
      const border = borders.get(node) ?? 0;
      const left = x + (offsets.get(node) ?? 0);
      const width =
        cos * (size.width + border * 2) + sin * (size.height + border * 2);
      const height =
        sin * (size.width + border * 2) + cos * (size.height + border * 2);
      return {
        x: left,
        y: 20,
        left,
        top: 20,
        right: left + width,
        bottom: 20 + height,
        width,
        height,
        toJSON: () => ({}),
      } as DOMRect;
    });
  document.body.appendChild(node);
  return { node, measure };
};

const frames = async (count: number) => {
  for (let index = 0; index < count; index += 1) {
    await act(async () => {
      vi.advanceTimersByTime(16);
      observers.forEach((observer) => observer.deliver());
    });
  }
};

const syncCalls = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === 'overlay_sync_hit_regions',
  );

const mount = async () => {
  const { useOverlayHitRegions } = await import('./useOverlayHitRegions');
  const Probe = () => {
    useOverlayHitRegions(1);
    return null;
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(<Probe />);
  });
};

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', ResizeObserverModel);
  mocks.invoke.mockClear();
  window.localStorage.clear();
  observers = [];
  sizes.clear();
  offsets.clear();
  borders.clear();
  animations = [];
  rejectBorderBox = false;
  observedBoxes = [];
  document.getAnimations = vi.fn(() => animations);
  nodes = [];
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  document.getAnimations = originalGetAnimations;
  vi.useRealTimers();
});

it('안정된 배치에서는 최초 통지 후 재측정과 IPC 발행이 멈춘다', async () => {
  nodes = Array.from({ length: 12 }, (_, index) => createHitNode(index * 70));
  await mount();
  await frames(4);
  const measurements = nodes[0].measure.mock.calls.length;
  const publications = syncCalls().length;
  await frames(60);
  expect(nodes[0].measure.mock.calls.length).toBe(measurements);
  expect(syncCalls()).toHaveLength(publications);
  expect(publications).toBe(1);
});

it('대상 추가·제거와 실제 resize는 반영하고 다시 안정되면 측정을 멈춘다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);

  await act(async () => {
    nodes.push(createHitNode(100));
  });
  await frames(4);
  expect(syncCalls()).toHaveLength(2);

  sizes.set(nodes[1].node, { width: 90, height: 60 });
  nodes[1].node.style.width = '90px';
  await frames(4);
  expect(syncCalls()).toHaveLength(3);

  await act(async () => {
    nodes[0].node.remove();
  });
  await frames(4);
  expect(syncCalls()).toHaveLength(4);
  const remainingMeasurements = nodes[1].measure.mock.calls.length;
  sizes.set(nodes[0].node, { width: 120, height: 60 });
  await frames(30);
  expect(nodes[1].measure.mock.calls.length).toBe(remainingMeasurements);
  expect(syncCalls()).toHaveLength(4);
});

it.each(['data-state', 'class', 'style'])(
  '%s 변경에 따른 크기 없는 이동도 반영한다',
  async (attribute) => {
    nodes = [createHitNode(10)];
    await mount();
    await frames(4);
    offsets.set(nodes[0].node, 4);
    await act(async () => {
      nodes[0].node.setAttribute(
        attribute,
        attribute === 'style'
          ? 'width:60px;height:60px;transform:translateX(4px)'
          : 'active',
      );
    });
    await frames(4);
    expect(syncCalls()).toHaveLength(2);
    const measured = nodes[0].measure.mock.calls.length;
    await frames(20);
    expect(nodes[0].measure.mock.calls.length).toBe(measured);
  },
);

it.each([
  ['animationstart', 'animationend'],
  ['transitionrun', 'transitionend'],
  ['animationstart', 'animationcancel'],
])(
  '%s 기하 애니메이션 중간 위치와 %s 최종 위치를 반영한다',
  async (startEvent, endEvent) => {
    nodes = [createHitNode(10)];
    await mount();
    await frames(4);
    const measured = nodes[0].measure.mock.calls.length;
    const { state } = movingAnimation(nodes[0].node);
    nodes[0].node.dispatchEvent(new Event(startEvent, { bubbles: true }));
    for (let frame = 1; frame <= 5; frame += 1) {
      offsets.set(nodes[0].node, frame * 4);
      state.progress = frame / 5;
      await frames(2);
    }
    expect(nodes[0].measure.mock.calls.length).toBeGreaterThan(measured);
    expect(syncCalls()).toHaveLength(6);
    animations = [];
    if (endEvent === 'animationcancel') offsets.set(nodes[0].node, 0);
    nodes[0].node.dispatchEvent(new Event(endEvent, { bubbles: true }));
    await frames(2);
    expect(syncCalls()).toHaveLength(endEvent === 'animationcancel' ? 7 : 6);
    const settled = nodes[0].measure.mock.calls.length;
    await frames(20);
    expect(nodes[0].measure.mock.calls.length).toBe(settled);
  },
);

it('조상의 전환이 끝나도 히트 노드를 다시 잰다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  offsets.set(nodes[0].node, 10);
  document.body.dispatchEvent(new Event('transitionend', { bubbles: true }));
  await frames(2);
  expect(syncCalls()).toHaveLength(2);
});

it('DOM 이벤트 없는 WAAPI 시작·진행·일시정지·마지막 유지 프레임도 반영한다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  const { state } = movingAnimation(nodes[0].node);
  offsets.set(nodes[0].node, 120);
  state.progress = 0.5;
  await frames(2);
  expect(syncCalls()).toHaveLength(2);
  const pausedMeasurements = nodes[0].measure.mock.calls.length;
  await frames(30);
  expect(nodes[0].measure.mock.calls.length).toBe(pausedMeasurements);
  offsets.set(nodes[0].node, 240);
  state.progress = 1;
  await frames(2);
  expect(syncCalls()).toHaveLength(3);
  const finishedMeasurements = nodes[0].measure.mock.calls.length;
  await frames(30);
  expect(nodes[0].measure.mock.calls.length).toBe(finishedMeasurements);
});

it('WAAPI의 키프레임 교체와 취소를 DOM 변이 없이 반영한다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  const { state } = movingAnimation(nodes[0].node, [{ opacity: 0.5 }]);
  await frames(2);
  expect(syncCalls()).toHaveLength(1);
  state.keyframes = [{ transform: 'translateX(100px)' }];
  offsets.set(nodes[0].node, 100);
  await frames(2);
  expect(syncCalls()).toHaveLength(2);
  state.keyframes = [{ transform: 'translateX(200px)' }];
  offsets.set(nodes[0].node, 200);
  await frames(2);
  expect(syncCalls()).toHaveLength(3);
  animations = [];
  offsets.set(nodes[0].node, 0);
  await frames(2);
  expect(syncCalls()).toHaveLength(4);
});

it('일시정지한 WAAPI의 합성 방식이 바뀌면 진행도가 같아도 재측정한다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  const { state } = movingAnimation(nodes[0].node);
  state.progress = 0.5;
  offsets.set(nodes[0].node, 50);
  await frames(2);
  state.composite = 'add';
  offsets.set(nodes[0].node, 150);
  await frames(2);
  expect(syncCalls()).toHaveLength(3);
});

it.each(['currentIteration', 'iterationComposite', 'pseudoElement'] as const)(
  '진행도가 같아도 WAAPI의 %s 변경을 반영한다',
  async (field) => {
    nodes = [createHitNode(10)];
    await mount();
    await frames(4);
    const { state } = movingAnimation(nodes[0].node);
    state.progress = 0.5;
    offsets.set(nodes[0].node, 50);
    await frames(2);
    if (field === 'currentIteration') state.currentIteration = 1;
    else if (field === 'iterationComposite')
      state.iterationComposite = 'accumulate';
    else state.pseudoElement = '::before';
    offsets.set(nodes[0].node, 150);
    await frames(2);
    expect(syncCalls()).toHaveLength(3);
  },
);

it('히트 대상의 부모가 바뀌면 새 조상의 무한 기하 애니메이션도 추적한다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  const parent = document.createElement('section');
  await act(async () => {
    document.body.append(parent);
    parent.append(nodes[0].node);
  });
  await frames(4);
  const { state } = movingAnimation(parent);
  for (let frame = 1; frame <= 3; frame += 1) {
    state.progress = frame / 10;
    offsets.set(nodes[0].node, frame * 20);
    await frames(2);
  }
  expect(syncCalls()).toHaveLength(4);
});

it.each([
  ['조상의 in-flow 가상 요소', [{ width: '300px' }], '::before'],
  ['조상의 filter containing block', [{ filter: 'blur(2px)' }], null],
  [
    '조상의 backdrop-filter containing block',
    [{ backdropFilter: 'blur(2px)' }],
    null,
  ],
] as const)(
  '%s이 크기 변화 없이 자식 위치를 옮겨도 추적한다',
  async (_name, keyframes, pseudoElement) => {
    nodes = [createHitNode(10)];
    await mount();
    await frames(4);
    const { state } = movingAnimation(
      document.body,
      [...keyframes],
      pseudoElement,
    );
    offsets.set(nodes[0].node, 90);
    state.progress = 0.5;
    await frames(2);
    expect(syncCalls()).toHaveLength(2);
    offsets.set(nodes[0].node, 180);
    state.progress = 1;
    await frames(2);
    expect(syncCalls()).toHaveLength(3);
  },
);

it('내용 크기가 같아도 border-box 변화는 측정한다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  expect(observedBoxes).toEqual(['border-box']);
  borders.set(nodes[0].node, 20);
  await frames(3);
  expect(syncCalls()).toHaveLength(2);
});

it('resize 통지와 애니메이션 조회가 겹쳐도 다음 프레임 측정이 취소되지 않는다', async () => {
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  const { state } = movingAnimation(nodes[0].node, [{ width: '60px' }]);
  for (let frame = 1; frame <= 8; frame += 1) {
    state.progress = frame / 10;
    sizes.set(nodes[0].node, { width: 60 + frame * 5, height: 60 });
    await frames(1);
  }
  expect(syncCalls().length).toBeGreaterThan(4);
});

it('border-box 관찰을 거부하는 구현에서도 기본 resize 관찰을 유지한다', async () => {
  rejectBorderBox = true;
  nodes = [createHitNode(10)];
  await mount();
  await frames(4);
  expect(observedBoxes).toEqual(['border-box', undefined]);
  sizes.set(nodes[0].node, { width: 120, height: 60 });
  await frames(3);
  expect(syncCalls()).toHaveLength(2);
});

it('복원한 꼭짓점이 실측 상자와 어긋나면 띠 대신 AABB를 보낸다', async () => {
  nodes = [createHitNode(10)];
  // 원근 배율처럼 선형부로 읽지 못한 변환 - 실측 상자만 두 배로 커진다
  const { node } = nodes[0];
  const plain = node.getBoundingClientRect();
  node.getBoundingClientRect = () =>
    ({
      ...plain,
      x: plain.x,
      y: plain.y,
      left: plain.left,
      top: plain.top,
      width: plain.width * 2,
      height: plain.height * 2,
      right: plain.left + plain.width * 2,
      bottom: plain.top + plain.height * 2,
      toJSON: () => ({}),
    } as DOMRect);
  await mount();
  await frames(4);
  const [, { payload }] = syncCalls()[0] as unknown as [
    string,
    { payload: { rects: HitRegionRect[] } },
  ];
  expect(payload.rects).toHaveLength(1);
  expect(payload.rects[0]).toMatchObject({
    x: plain.left,
    y: plain.top,
    width: plain.width * 2,
    height: plain.height * 2,
  });
});

it('하위 카운터와 가상 요소의 무한 장식 애니메이션은 지속 측정을 만들지 않는다', async () => {
  nodes = [createHitNode(10)];
  const decoration = document.createElement('span');
  nodes[0].node.appendChild(decoration);
  await mount();
  await frames(4);
  const measured = nodes[0].measure.mock.calls.length;
  const effects = [
    movingAnimation(decoration),
    movingAnimation(nodes[0].node, [{ opacity: 0.5 }], '::after'),
    movingAnimation(nodes[0].node, [{ opacity: 0.5 }]),
    movingAnimation(nodes[0].node, [{ boxShadow: '0 0 10px red' }]),
  ];
  decoration.dispatchEvent(new Event('animationend', { bubbles: true }));
  await act(async () => {
    decoration.style.transform = 'scale(1.2)';
  });
  for (let frame = 0; frame < 20; frame += 1) {
    effects.forEach(({ state }) => {
      state.progress = frame / 20;
    });
    await frames(1);
  }
  expect(nodes[0].measure.mock.calls.length).toBe(measured);
  expect(syncCalls()).toHaveLength(1);
});
