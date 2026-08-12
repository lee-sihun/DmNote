import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';

import type { EditorDocumentV1 } from '@src/types/editor';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const mocks = vi.hoisted(() => ({
  runMixed: vi.fn(),
  begin: vi.fn(),
  cancel: vi.fn(),
  rotate: vi.fn(),
}));

vi.mock('./mixedElementIntent', () => ({
  runMixedGestureElementIntent: mocks.runMixed,
}));
vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: mocks.begin,
  cancelUncommittedMixedGestureTransaction: mocks.cancel,
}));
vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  rotatePluginInstancesEditSession: mocks.rotate,
}));

import {
  commitStableLayerZOrder,
  orderStableZTargetsForBatch,
} from './layerZOrderIntent';

const KEY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAT_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const position = (id: string, zIndex: number, dx = 0) => ({
  id,
  zIndex,
  dx,
  dy: 0,
  width: 50,
  height: 50,
});

const documentWith = (options?: {
  keys?: ReturnType<typeof position>[];
  stats?: ReturnType<typeof position>[];
}): EditorDocumentV1 =>
  ({
    schemaVersion: 1,
    keys: { '4key': (options?.keys ?? []).map((_, index) => String(index)) },
    keyPositions: { '4key': options?.keys ?? [] },
    statPositions: { '4key': options?.stats ?? [] },
    graphPositions: {},
    knobPositions: {},
    layerGroups: {},
  } as never);

const plugin = (
  fullId: string,
  zIndex: number,
  tabId?: string,
  x = 0,
): PluginDisplayElementInternal =>
  ({
    id: fullId,
    fullId,
    pluginId: `runtime:${fullId}`,
    definitionId: `definition:${fullId}`,
    position: { x, y: 0 },
    estimatedSize: { width: 50, height: 50 },
    zIndex,
    tabId,
  } as never);

const install = (document: EditorDocumentV1) => {
  useKeyStore.setState({
    keyMappings: document.keys,
    canonicalPositions: document.keyPositions,
    positions: document.keyPositions,
  });
  useStatItemStore.setState({ positions: document.statPositions });
  useGraphItemStore.setState({ positions: document.graphPositions });
  useKnobItemStore.setState({ positions: document.knobPositions });
  useLayerGroupStore.setState({ layerGroups: {}, collapsedGroups: new Set() });
};

describe('stable layer z-order intent', () => {
  beforeEach(() => {
    mocks.runMixed.mockReset();
    mocks.runMixed.mockResolvedValue({ committed: true, satisfied: true });
    mocks.begin.mockClear();
    mocks.cancel.mockClear();
    mocks.rotate.mockClear();
    usePluginDisplayElementStore.setState({ elements: [] });
  });

  it('batch front/back은 기존처럼 plugin을 먼저, native를 나중에 배치한다', () => {
    expect(
      orderStableZTargetsForBatch([
        { type: 'key', id: KEY_A },
        { type: 'plugin', id: 'plugin:one' },
        { type: 'stat', id: STAT_A },
      ]),
    ).toEqual([
      { type: 'plugin', id: 'plugin:one' },
      { type: 'key', id: KEY_A },
      { type: 'stat', id: STAT_A },
    ]);
  });

  it('key 한 칸 앞으로는 겹치는 key와 visible plugin만 사용한다', async () => {
    install(
      documentWith({
        keys: [position(KEY_A, 1), position(KEY_B, 4)],
        stats: [position(STAT_A, 2)],
      }),
    );
    usePluginDisplayElementStore.setState({
      elements: [
        plugin('plugin:mode', 3, '4key'),
        plugin('plugin:global', 2),
        plugin('plugin:other', 99, '7key'),
      ],
    });
    await commitStableLayerZOrder({
      mode: '4key',
      targets: [{ type: 'key', id: KEY_A }],
      action: 'forward',
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    const generation = options.generate({
      base: documentWith({
        keys: [position(KEY_A, 1), position(KEY_B, 8)],
        stats: [position(STAT_A, 7)],
      }),
      pluginProjection: [
        plugin('plugin:mode', 5, '4key'),
        plugin('plugin:global', 3),
        plugin('plugin:other', 99, '7key'),
      ],
    });
    expect(generation.ops).toEqual([
      {
        kind: 'reorderElements',
        mode: '4key',
        completeModeOrder: false,
        groupUpdates: [],
        zUpdates: [{ elementType: 'key', id: KEY_A, zIndex: 4 }],
      },
    ]);
    expect(options.retryEditorOnly).toBe(false);
    expect(
      options.pluginScope([
        plugin('plugin:mode', 5, '4key'),
        plugin('plugin:global', 3),
        plugin('plugin:other', 99, '7key'),
      ]),
    ).toEqual(['runtime:plugin:mode', 'runtime:plugin:global']);
  });

  it('stat 한 칸 이동은 기존처럼 현재 z에 1만 더한다', async () => {
    install(documentWith({ stats: [position(STAT_A, 4)] }));
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:unrelated', 50, '4key')],
    });
    await commitStableLayerZOrder({
      mode: '4key',
      targets: [{ type: 'stat', id: STAT_A }],
      action: 'forward',
    });
    const generation = mocks.runMixed.mock.calls[0]?.[0].generate({
      base: documentWith({ stats: [position(STAT_A, 9)] }),
      pluginProjection: [],
    });
    expect(generation.ops[0].zUpdates).toEqual([
      { elementType: 'stat', id: STAT_A, zIndex: 10 },
    ]);
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(mocks.runMixed.mock.calls[0]?.[0].pluginScope([])).toEqual([]);
    expect(mocks.runMixed.mock.calls[0]?.[0].retryEditorOnly).toBe(false);
  });

  it('front는 native와 plugin 선택을 한 fixed-point에서 순서대로 배치한다', async () => {
    install(documentWith({ keys: [position(KEY_A, 1), position(KEY_B, 4)] }));
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 3, '4key')],
    });
    await commitStableLayerZOrder({
      mode: '4key',
      targets: [
        { type: 'plugin', id: 'plugin:one' },
        { type: 'key', id: KEY_A },
      ],
      action: 'front',
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    const generation = options.generate({
      base: documentWith({ keys: [position(KEY_A, 1), position(KEY_B, 10)] }),
      pluginProjection: [plugin('plugin:one', 3, '4key')],
    });
    expect(generation.ops[0].zUpdates).toEqual([
      { elementType: 'key', id: KEY_A, zIndex: 12 },
    ]);
    expect(generation.desiredPluginProjection[0].zIndex).toBe(11);
    expect(mocks.begin).toHaveBeenCalledWith(expect.any(String), [
      'runtime:plugin:one',
    ]);
    expect(mocks.rotate).toHaveBeenCalledWith(
      'runtime:plugin:one',
      expect.any(String),
    );
  });

  it('slot에서 target이 사라지면 native와 plugin을 모두 쓰지 않는다', async () => {
    install(documentWith({ keys: [position(KEY_A, 1)] }));
    usePluginDisplayElementStore.setState({
      elements: [plugin('plugin:one', 0, '4key')],
    });
    await commitStableLayerZOrder({
      mode: '4key',
      targets: [
        { type: 'key', id: KEY_A },
        { type: 'plugin', id: 'plugin:one' },
      ],
      action: 'back',
    });
    const options = mocks.runMixed.mock.calls[0]?.[0];
    expect(() =>
      options.generate({
        base: documentWith(),
        pluginProjection: [plugin('plugin:one', 0, '4key')],
      }),
    ).toThrow('z-order target missing');
  });
});
