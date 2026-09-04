// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type { ElementBounds as SmartGuideElementBounds } from '@utils/grid/smartGuides';
import { useSmartGuidesStore } from '@stores/grid/useSmartGuidesStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import GroupResizeHandles from './GroupResizeHandles';
import { isBoundsWithinEditorLimits } from './resizeLimits';

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
  let initialSnapSize: number;

  beforeEach(() => {
    initialSnapSize = useSettingsStore.getState().gridSettings.gridSnapSize;
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
    useSettingsStore.setState((state) => ({
      gridSettings: { ...state.gridSettings, gridSnapSize: initialSnapSize },
    }));
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
  // 그룹 리사이즈 한 번을 돌리고 첫 onGroupResize 결과를 돌려준다
  const dragGroup = async (
    spritePositions: Record<
      string,
      ReturnType<typeof makeCanonicalSpritePosition>[]
    >,
    handleId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    getOtherElements: () => SmartGuideElementBounds[] = () => [],
  ) => {
    const onGroupResize = vi.fn();
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
          getOtherElements={getOtherElements}
        />,
      );
    });
    const handle = host.querySelector<HTMLElement>(
      `[data-group-resize-handle="${handleId}"]`,
    )!;
    act(() =>
      handle.dispatchEvent(
        new MouseEvent('mousedown', {
          clientX: from.x,
          clientY: from.y,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientX: to.x, clientY: to.y }),
    );
    const callback = callbacks.get(1)!;
    callbacks.clear();
    act(() => callback(performance.now()));
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    const result = onGroupResize.mock.lastCall?.[0];
    return {
      groupBounds: result?.groupBounds,
      elementBounds: (result?.elementBounds ??
        spritePositions['4key'].map((position) => ({
          bounds: {
            x: position.dx,
            y: position.dy,
            width: position.width,
            height: position.height,
          },
        }))) as Array<{
        bounds: { x: number; y: number; width: number; height: number };
      }>,
      previewCount: onGroupResize.mock.calls.length,
    };
  };

  it('그룹 축소도 투영 반올림으로 요소 하한 아래에 저장하지 않는다', async () => {
    const result = await dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 77,
            height: 77,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 308,
            dy: 0,
            width: 77,
            height: 77,
          }),
        ],
      },
      'e',
      { x: 385, y: 0 },
      { x: 0, y: 0 },
    );
    expect(result.previewCount).toBe(1);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.height).toBeGreaterThanOrEqual(10);
      expect(bounds.width).toBeCloseTo(10, 9);
    }
  });

  it('한 축이 얇아도 그룹 축소는 스프라이트의 정상 축 하한을 지킨다', async () => {
    const result = await dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 1600,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
        ],
      },
      'e',
      { x: 2000, y: 0 },
      { x: 0, y: 0 },
    );
    expect(result.previewCount).toBe(1);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.width).toBeCloseTo(10, 9);
      expect(bounds.width / 400).toBeCloseTo(bounds.height / 0.1, 9);
    }
  });

  it('8방향과 스냅별 연속 축소는 최소 크기와 고정 가장자리를 보존한다', async () => {
    const handles = [
      { id: 'nw', dx: -1, dy: -1 },
      { id: 'n', dx: 0, dy: -1 },
      { id: 'ne', dx: 1, dy: -1 },
      { id: 'w', dx: -1, dy: 0 },
      { id: 'e', dx: 1, dy: 0 },
      { id: 'sw', dx: -1, dy: 1 },
      { id: 's', dx: 0, dy: 1 },
      { id: 'se', dx: 1, dy: 1 },
    ];
    for (const snapSize of [0, 1, 5, 10]) {
      useSettingsStore.setState((state) => ({
        gridSettings: { ...state.gridSettings, gridSnapSize: snapSize },
      }));
      for (const handle of handles) {
        let sprites = [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 3,
            dy: 7,
            width: 77,
            height: 77,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 311,
            dy: 315,
            width: 77,
            height: 77,
          }),
        ];
        for (let round = 0; round < 3; round += 1) {
          const result = await dragGroup(
            { '4key': sprites },
            handle.id,
            { x: 0, y: 0 },
            { x: -1000 * handle.dx, y: -1000 * handle.dy },
          );
          for (const { bounds } of result.elementBounds) {
            expect(bounds.width).toBeGreaterThanOrEqual(10);
            expect(bounds.height).toBeGreaterThanOrEqual(10);
            expect(bounds.width).toBe(bounds.height);
          }
          if (result.groupBounds && handle.dx !== 0 && handle.dy !== 0) {
            const beforeX = Math.min(...sprites.map((sprite) => sprite.dx));
            const beforeY = Math.min(...sprites.map((sprite) => sprite.dy));
            const beforeRight = Math.max(
              ...sprites.map((sprite) => sprite.dx + sprite.width),
            );
            const beforeBottom = Math.max(
              ...sprites.map((sprite) => sprite.dy + sprite.height),
            );
            expect(
              handle.dx === 1
                ? result.groupBounds.x
                : result.groupBounds.x + result.groupBounds.width,
            ).toBeCloseTo(handle.dx === 1 ? beforeX : beforeRight, 9);
            expect(
              handle.dy === 1
                ? result.groupBounds.y
                : result.groupBounds.y + result.groupBounds.height,
            ).toBeCloseTo(handle.dy === 1 ? beforeY : beforeBottom, 9);
          }
          sprites = sprites.map((sprite, index) => ({
            ...sprite,
            dx: result.elementBounds[index].bounds.x,
            dy: result.elementBounds[index].bounds.y,
            width: result.elementBounds[index].bounds.width,
            height: result.elementBounds[index].bounds.height,
          }));
        }
      }
    }
  });

  it('이미 두 축이 얇은 그룹을 줄여도 강제로 키우거나 더 줄이지 않는다', async () => {
    const result = await dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 1,
            height: 1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 2,
            dy: 0,
            width: 1,
            height: 1,
          }),
        ],
      },
      'e',
      { x: 3, y: 0 },
      { x: -100, y: 0 },
    );
    expect(result.previewCount).toBe(0);
  });

  it.each([
    { id: 'e', dx: 1, dy: 0 },
    { id: 's', dx: 0, dy: 1 },
    { id: 'se', dx: 1, dy: 1 },
  ])(
    '두 축이 얇은 스프라이트와 큰 키를 함께 $id 방향으로 줄이면 크기를 유지하고 확대는 허용한다',
    async ({ id, dx, dy }) => {
      useSettingsStore.setState((state) => ({
        gridSettings: { ...state.gridSettings, gridSnapSize: 0 },
      }));
      const onGroupResize =
        vi.fn<
          NonNullable<
            React.ComponentProps<typeof GroupResizeHandles>['onGroupResize']
          >
        >();
      const onGroupResizeStart = vi.fn();
      const onGroupResizeEnd = vi.fn();
      const sprite = makeCanonicalSpritePosition({
        id: SPRITE_A,
        dx: 0,
        dy: 0,
        width: 1,
        height: 2,
      });
      const key = {
        ...createDefaultKeyPosition(100, 100),
        id: SPRITE_B,
        width: 100,
        height: 100,
      };
      await act(async () => {
        root.render(
          <GroupResizeHandles
            selectedElements={[
              { type: 'sprite', id: SPRITE_A, index: 0 },
              { type: 'key', id: SPRITE_B, index: 0 },
            ]}
            positions={{ '4key': [key] }}
            statPositions={{}}
            graphPositions={{}}
            knobPositions={{}}
            spritePositions={{ '4key': [sprite] }}
            selectedKeyType="4key"
            pluginElements={[]}
            getOtherElements={() => []}
            onGroupResize={onGroupResize}
            onGroupResizeStart={onGroupResizeStart}
            onGroupResizeEnd={onGroupResizeEnd}
          />,
        );
      });
      const handle = host.querySelector<HTMLElement>(
        `[data-group-resize-handle="${id}"]`,
      )!;
      act(() => {
        handle.dispatchEvent(
          new MouseEvent('mousedown', {
            clientX: 0,
            clientY: 0,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      const moveAndFlush = (distance: number) => {
        document.dispatchEvent(
          new MouseEvent('mousemove', {
            clientX: dx * distance,
            clientY: dy * distance,
          }),
        );
        const callback = callbacks.get(1)!;
        callbacks.clear();
        act(() => callback(performance.now()));
      };

      moveAndFlush(-100);
      expect(onGroupResize).not.toHaveBeenCalled();
      expect(onGroupResizeStart).not.toHaveBeenCalled();
      expect(onGroupResizeEnd).not.toHaveBeenCalled();

      moveAndFlush(50);
      expect(onGroupResize).toHaveBeenCalledTimes(1);
      expect(onGroupResizeStart).toHaveBeenCalledTimes(1);
      const result = onGroupResize.mock.lastCall![0];
      const spriteBounds = result.elementBounds.find(
        ({ element }) => element.id === SPRITE_A,
      )!.bounds;
      const keyBounds = result.elementBounds.find(
        ({ element }) => element.id === SPRITE_B,
      )!.bounds;
      expect(spriteBounds.width).toBe(1.25);
      expect(spriteBounds.height).toBe(2.5);
      expect(keyBounds.width).toBe(dx === 0 ? 100 : 125);
      expect(keyBounds.height).toBe(dy === 0 ? 100 : 125);
      expect(
        result.elementBounds.every(({ bounds }) =>
          isBoundsWithinEditorLimits(bounds),
        ),
      ).toBe(true);
      act(() => document.dispatchEvent(new MouseEvent('mouseup')));
      expect(onGroupResizeEnd).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['s', 'e'])(
    '얇은 그룹의 %s 핸들도 정상 축이 하한에 닿기 전까지 축소한다',
    async (handleId) => {
      useSettingsStore.setState((state) => ({
        gridSettings: { ...state.gridSettings, gridSnapSize: 0 },
      }));
      const vertical = handleId === 's';
      const result = await dragGroup(
        {
          '4key': [SPRITE_A, SPRITE_B].map((id, index) =>
            makeCanonicalSpritePosition({
              id,
              dx: vertical ? 0 : index * 0.1,
              dy: vertical ? index * 0.1 : 0,
              width: vertical ? 400 : 0.1,
              height: vertical ? 0.1 : 400,
            }),
          ),
        },
        handleId,
        { x: 0, y: 0 },
        { x: vertical ? 0 : -0.1, y: vertical ? -0.1 : 0 },
      );
      expect(result.previewCount).toBe(1);
      for (const { bounds } of result.elementBounds) {
        expect(vertical ? bounds.width : bounds.height).toBeCloseTo(200, 9);
        expect(vertical ? bounds.height : bounds.width).toBeCloseTo(0.05, 9);
      }
    },
  );

  it('극소 두께 그룹도 하한 반올림 보정이 멈추지 않고 끝난다', async () => {
    useSettingsStore.setState((state) => ({
      gridSettings: { ...state.gridSettings, gridSnapSize: 0 },
    }));
    const result = await dragGroup(
      {
        '4key': [SPRITE_A, SPRITE_B].map((id, index) =>
          makeCanonicalSpritePosition({
            id,
            dx: 0,
            dy: index * 1e-320,
            width: 400,
            height: 1e-320,
          }),
        ),
      },
      'e',
      { x: 0, y: 0 },
      { x: -390, y: 0 },
    );
    expect(result.previewCount).toBe(1);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width).toBeGreaterThanOrEqual(10);
      expect(bounds.height).toBeGreaterThan(0);
    }
  });

  it('얇은 스프라이트 그룹의 세로 확대는 파생 폭 상한에서 멈춘다', async () => {
    // 400x0.1 둘이 세로로 붙은 0.2 높이 그룹 - 아래 핸들 100px는 배율 500
    const result = await dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 0,
            dy: 0.1,
            width: 400,
            height: 0.1,
          }),
        ],
      },
      's',
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    );
    expect(result.groupBounds.height).toBeLessThan(100);
    for (const { bounds } of result.elementBounds) {
      expect(isBoundsWithinEditorLimits(bounds)).toBe(true);
      expect(bounds.width / 400).toBeCloseTo(bounds.height / 0.1, 6);
    }
    expect(
      Math.max(...result.elementBounds.map(({ bounds }) => bounds.width)),
    ).toBeGreaterThan(32000);
  });

  it('가로 핸들은 그룹 높이 크기 일치를 받지 않는다', async () => {
    // 높이 102는 임계값 안, 폭 1000은 밖 - 예전에는 가로 핸들인데 높이가 102로 바뀌었다
    const heightTarget = (): SmartGuideElementBounds => ({
      id: 'other',
      left: 1000,
      top: 600,
      right: 2000,
      bottom: 702,
      centerX: 1500,
      centerY: 651,
      width: 1000,
      height: 102,
    });
    const result = await dragGroup(
      {
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
      },
      'e',
      { x: 300, y: 50 },
      { x: 290, y: 50 },
      () => [heightTarget()],
    );
    expect(result.groupBounds.height).toBe(100);
    expect(result.groupBounds.width).toBe(290);
  });

  it('가로 핸들은 얇은 그룹의 높이를 10으로 키우지 않는다', async () => {
    // 400x0.1 둘이 세로로 붙은 0.2 높이 그룹 - 잡지 않은 세로축은 시작값 그대로
    const result = await dragGroup(
      {
        '4key': [
          makeCanonicalSpritePosition({
            id: SPRITE_A,
            dx: 0,
            dy: 0,
            width: 400,
            height: 0.1,
          }),
          makeCanonicalSpritePosition({
            id: SPRITE_B,
            dx: 0,
            dy: 0.1,
            width: 400,
            height: 0.1,
          }),
        ],
      },
      'e',
      { x: 400, y: 0 },
      { x: 440, y: 0 },
    );
    // 그룹 높이는 자란 스프라이트(0.11 둘)를 감싼 0.21 - 10으로 뛰지 않는다
    expect(result.groupBounds.height).toBeCloseTo(0.21, 9);
    expect(result.groupBounds.width).toBeCloseTo(440, 9);
    const ys = result.elementBounds.map(({ bounds }) => bounds.y);
    // 배율 1.1 로 폭 440, 높이 0.11 - 중심은 그룹 세로 배율 1 이라 y가 거의 제자리
    for (const y of ys) expect(Math.abs(y)).toBeLessThan(0.2);
    for (const { bounds } of result.elementBounds) {
      expect(bounds.width / 400).toBeCloseTo(bounds.height / 0.1, 6);
    }
  });
});
