import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const core = vi.hoisted(() => ({
  addStatAt: vi.fn((_mode: string, _position: unknown) =>
    Promise.resolve(true),
  ),
  addKeyAt: vi.fn((_mode: string, _dx: number, _dy: number) =>
    Promise.resolve(true),
  ),
  addGraphAt: vi.fn((_mode: string, _position: unknown) =>
    Promise.resolve(true),
  ),
  addKnobAt: vi.fn((_mode: string, _position: unknown) =>
    Promise.resolve(true),
  ),
  addSpriteAt: vi.fn((_mode: string, _position: unknown) =>
    Promise.resolve(true),
  ),
  placeDuplicatedStat: vi.fn(
    (..._args: [string, unknown, number, number, number]) =>
      Promise.resolve(true),
  ),
  placeDuplicatedKey: vi.fn((..._args: [unknown, string, number, number]) =>
    Promise.resolve(true),
  ),
  placeDuplicatedGraph: vi.fn(
    (..._args: [string, unknown, number, number, number]) =>
      Promise.resolve(true),
  ),
  placeDuplicatedKnob: vi.fn(
    (..._args: [string, unknown, number, number, number]) =>
      Promise.resolve(true),
  ),
  placeDuplicatedSprite: vi.fn(
    (..._args: [string, unknown, number, number, number]) =>
      Promise.resolve(true),
  ),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => core);

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import {
  addCanvasElementAt,
  placeFrozenDuplicateAt,
  useGridCanvasActions,
  type CanvasActions,
} from './useGridCanvasActions';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import {
  CENTER_SPRITE_ANCHOR,
  DEFAULT_SPRITE_TRANSITION_EASING,
  DEFAULT_SPRITE_TRANSITION_MS,
  IDENTITY_SPRITE_TRANSFORM,
  type ReactiveSpritePosition,
} from '@src/types/key/sprites';

const stat = (id: string) => ({
  ...createDefaultKeyPosition(),
  id,
  statType: 'kps' as const,
});

const graph = (id: string) => ({
  ...stat(id),
  graphType: 'line' as const,
  graphSpeed: 1000,
  graphColor: '#86EFAC',
});

const knob = (id: string) => ({
  ...createDefaultKeyPosition(),
  id,
  axisId: '',
  sensitivity: 1,
  reverse: false,
});

const sprite = (id: string): ReactiveSpritePosition & { id: string } => ({
  id,
  dx: 0,
  dy: 0,
  width: 200,
  height: 200,
  hidden: false,
  zIndex: null,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  imageFit: 'contain',
  imageRect: { x: 0, y: 0, width: 200, height: 200 },
  pivot: { ...CENTER_SPRITE_ANCHOR },
  idleTransform: { ...IDENTITY_SPRITE_TRANSFORM },
  poses: [],
  activation: 'whileHeld',
  transitionMs: DEFAULT_SPRITE_TRANSITION_MS,
  transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
});

describe('useGridCanvasActions create와 ghost duplicate', () => {
  let container: HTMLDivElement;
  let root: Root;
  let actions: CanvasActions;

  const Harness = () => {
    const value = useGridCanvasActions('4key');
    useLayoutEffect(() => {
      actions = value;
    }, [value]);
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ ...createDefaultKeyPosition(), zIndex: 30 }],
      },
      positions: { '4key': [{ ...createDefaultKeyPosition(), zIndex: 30 }] },
    });
    useStatItemStore.setState({ positions: { '4key': [] } });
    useGraphItemStore.setState({ positions: { '4key': [] } });
    useKnobItemStore.setState({ positions: { '4key': [] } });
    useSpriteStore.setState({ positions: { '4key': [] } });
    usePluginDisplayElementStore.setState({
      elements: [
        {
          fullId: 'plugin:element:one',
          pluginId: 'plugin',
          id: 'element',
          type: 'text',
          tabId: '4key',
          zIndex: 40,
          position: { x: 0, y: 0 },
          size: { width: 10, height: 10 },
        } as never,
      ],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('add 4종은 기존 기본 payload와 zIndex 부재를 frozen helper에 전달한다', () => {
    act(() => {
      actions.addKeyAtPosition(7, 8);
      actions.addStatAtPosition(1, 2);
      actions.addGraphAtPosition(3, 4);
      actions.addKnobAtPosition(5, 6);
    });

    expect(core.addKeyAt).toHaveBeenCalledWith('4key', 7, 8);
    expect(core.addStatAt).toHaveBeenCalledWith(
      '4key',
      expect.objectContaining({ statType: 'kps', dx: 1, dy: 2 }),
    );
    expect(core.addGraphAt).toHaveBeenCalledWith(
      '4key',
      expect.objectContaining({
        graphType: 'line',
        graphSpeed: 1000,
        dx: 3,
        dy: 4,
      }),
    );
    expect(core.addKnobAt).toHaveBeenCalledWith(
      '4key',
      expect.objectContaining({ sensitivity: 1, dx: 5, dy: 6 }),
    );
    for (const mock of [core.addStatAt, core.addGraphAt, core.addKnobAt]) {
      expect(mock.mock.calls[0][1]).not.toHaveProperty('zIndex');
    }
  });

  it('addSpriteAtPosition은 기본값 계약과 id 선발급을 고정한다', () => {
    act(() => {
      actions.addSpriteAtPosition(11, 22);
    });

    expect(core.addSpriteAt).toHaveBeenCalledTimes(1);
    const [mode, payload] = core.addSpriteAt.mock.calls[0] as [
      string,
      ReactiveSpritePosition & { id: string },
    ];
    expect(mode).toBe('4key');
    expect(typeof payload.id).toBe('string');
    expect(payload.id.length).toBeGreaterThan(0);
    expect(payload).toMatchObject({
      dx: 11,
      dy: 22,
      width: 200,
      height: 200,
      hidden: false,
      zIndex: null,
      layerName: null,
      groupId: null,
      className: null,
      useInlineStyles: null,
      baseImage: null,
      imageFit: 'contain',
      imageRect: { x: 0, y: 0, width: 200, height: 200 },
      pivot: CENTER_SPRITE_ANCHOR,
      idleTransform: IDENTITY_SPRITE_TRANSFORM,
      poses: [],
      activation: 'whileHeld',
      transitionMs: DEFAULT_SPRITE_TRANSITION_MS,
      transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
    });
  });

  it('key ghost place는 동결 slot과 payload를 index 재조회 없이 전달한다', () => {
    const source = {
      slot: { main: 'A', modifiers: ['Shift'] },
      position: { ...createDefaultKeyPosition(), id: 'key-0' },
    };

    act(() => actions.placeDuplicateKey(source, 1.25, 2.75));

    expect(core.placeDuplicatedKey).toHaveBeenCalledWith(
      source,
      '4key',
      1.25,
      2.75,
    );
  });

  it('Grid 공용 add routing은 다섯 타입을 정확히 한 handler로 보낸다', () => {
    act(() => {
      (['key', 'stat', 'graph', 'knob', 'sprite'] as const).forEach(
        (type, index) => addCanvasElementAt(actions, type, index, index + 10),
      );
    });

    expect(core.addKeyAt).toHaveBeenCalledTimes(1);
    expect(core.addStatAt).toHaveBeenCalledTimes(1);
    expect(core.addGraphAt).toHaveBeenCalledTimes(1);
    expect(core.addKnobAt).toHaveBeenCalledTimes(1);
    expect(core.addSpriteAt).toHaveBeenCalledTimes(1);
  });

  it('Grid 공용 ghost routing은 다섯 타입과 key slot 누락 fail-closed를 고정한다', () => {
    const cases = [
      {
        elementType: 'key' as const,
        sourceIndex: 0,
        slot: 'A',
        keyName: 'A',
        position: createDefaultKeyPosition(),
      },
      {
        elementType: 'stat' as const,
        sourceIndex: 0,
        keyName: 'KPS',
        position: stat('stat-0'),
      },
      {
        elementType: 'graph' as const,
        sourceIndex: 0,
        keyName: 'KPS',
        position: graph('graph-0'),
      },
      {
        elementType: 'knob' as const,
        sourceIndex: 0,
        keyName: 'Knob',
        position: knob('knob-0'),
      },
      {
        elementType: 'sprite' as const,
        sourceIndex: 0,
        keyName: 'Sprite',
        position: sprite('sprite-0'),
      },
    ];

    act(() =>
      cases.forEach((duplicate) =>
        placeFrozenDuplicateAt(actions, duplicate, 1, 2),
      ),
    );

    expect(core.placeDuplicatedKey).toHaveBeenCalledTimes(1);
    expect(core.placeDuplicatedStat).toHaveBeenCalledTimes(1);
    expect(core.placeDuplicatedGraph).toHaveBeenCalledTimes(1);
    expect(core.placeDuplicatedKnob).toHaveBeenCalledTimes(1);
    expect(core.placeDuplicatedSprite).toHaveBeenCalledTimes(1);
    expect(
      placeFrozenDuplicateAt(actions, { ...cases[0], slot: undefined }, 3, 4),
    ).toBe(false);
    expect(core.placeDuplicatedKey).toHaveBeenCalledTimes(1);
  });

  it('ghost place 4종은 synthetic source도 허용하고 클릭 시 maxZ+1을 동결한다', () => {
    const sourceStat = stat('stat-0');
    const sourceGraph = graph('graph-0');
    const sourceKnob = knob('knob-0');
    const sourceSprite = sprite('sprite-0');
    act(() => {
      actions.placeDuplicateStat(sourceStat, 1.25, 2.75);
      actions.placeDuplicateGraph(sourceGraph, 3.25, 4.75);
      actions.placeDuplicateKnob(sourceKnob, 5.25, 6.75);
      actions.placeDuplicateSprite(sourceSprite, 7.25, 8.75);
    });

    expect(core.placeDuplicatedStat).toHaveBeenCalledWith(
      '4key',
      sourceStat,
      1.25,
      2.75,
      41,
    );
    expect(core.placeDuplicatedGraph).toHaveBeenCalledWith(
      '4key',
      sourceGraph,
      3.25,
      4.75,
      41,
    );
    expect(core.placeDuplicatedKnob).toHaveBeenCalledWith(
      '4key',
      sourceKnob,
      5.25,
      6.75,
      41,
    );
    expect(core.placeDuplicatedSprite).toHaveBeenCalledWith(
      '4key',
      sourceSprite,
      7.25,
      8.75,
      41,
    );
  });
});
