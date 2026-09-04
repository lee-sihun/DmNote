// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';
import type { ElementBounds as SmartGuideElementBounds } from '@utils/grid/smartGuides';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import GroupResizeHandles from './GroupResizeHandles';

const SPRITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SPRITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// 폭 28 요소 - 그룹 폭이 30까지 줄면 size matching 임계값(4px) 안에 들어온다.
// 가장자리는 멀리 둬 정렬 스냅은 걸리지 않게 한다
const sizeMatchTarget = (): SmartGuideElementBounds => ({
  id: 'other',
  left: 1000,
  top: 600,
  right: 1028,
  bottom: 1100,
  centerX: 1014,
  centerY: 850,
  width: 28,
  height: 500,
});

describe('GroupResizeHandles 최소 크기', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    callbacks = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.set(1, callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('크기 스냅이 그룹을 더 줄여도 요소는 10px 밑으로 내려가지 않는다', async () => {
    // 100x100 스프라이트 둘이 (0,0)·(200,0)에 놓인 300x100 그룹.
    // maxShrink는 그룹 30까지만 허용하지만 size matching이 28로 다시 당긴다
    const onGroupResize = vi.fn();
    const spritePositions = {
      '4key': [
        makeCanonicalSpritePosition({
          id: SPRITE_A,
          dx: 0,
          dy: 0,
          width: 100,
          height: 100,
        }),
        makeCanonicalSpritePosition({
          id: SPRITE_B,
          dx: 200,
          dy: 0,
          width: 100,
          height: 100,
        }),
      ],
    };
    await act(async () => {
      root.render(
        <GroupResizeHandles
          selectedElements={[
            { type: 'sprite', id: SPRITE_A, index: 0 },
            { type: 'sprite', id: SPRITE_B, index: 1 },
          ]}
          positions={{}}
          statPositions={{}}
          graphPositions={{}}
          knobPositions={{}}
          spritePositions={spritePositions}
          selectedKeyType="4key"
          pluginElements={[]}
          onGroupResize={onGroupResize}
          getOtherElements={() => [sizeMatchTarget()]}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>(
      '[data-group-resize-handle="e"]',
    )!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: 300,
          clientY: 50,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 0, clientY: 50 }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));

    expect(onGroupResize).toHaveBeenCalledTimes(1);
    const result = onGroupResize.mock.calls[0][0];
    expect(result.groupBounds.width).toBe(30);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.height).toBeGreaterThanOrEqual(10);
    }
    // 화면 가이드도 실제 결과를 따른다 - 성립하지 않은 28px 크기 일치가 남으면 안 되고,
    // 되돌린 뒤 남는 스냅이 없으니 가이드는 통째로 비운다
    const guides = useSmartGuidesStore.getState();
    expect(guides.sizeMatchGuides).toEqual([]);
    expect(guides.draggedBounds).toBeNull();
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
  });
});
