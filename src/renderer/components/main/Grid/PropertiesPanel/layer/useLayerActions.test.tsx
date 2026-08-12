import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyStore } from '@stores/data/useKeyStore';

import type { LayerItem } from '../types';

const mocks = vi.hoisted(() => ({
  patchHidden: vi.fn(() => Promise.resolve(true)),
  patchLayerName: vi.fn(() => Promise.resolve(true)),
  patchPropertyViaAuthority: vi.fn(() => Promise.resolve(true)),
  updateKeyPositions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchElementHiddenById: mocks.patchHidden,
  patchElementLayerNameById: mocks.patchLayerName,
}));
vi.mock('@src/renderer/editor/runtime/deleteFrozenSelection', () => ({
  deleteFrozenSelection: vi.fn(),
}));
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  patchNativeLayerPropertyViaAuthority: mocks.patchPropertyViaAuthority,
  setPluginElementsHidden: vi.fn(),
}));
vi.mock('@api/modules/keysApi', () => ({
  keysApi: { updatePositions: mocks.updateKeyPositions },
}));

import { useLayerActions } from './useLayerActions';

const STABLE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type Actions = ReturnType<typeof useLayerActions>;

const Harness = ({ expose }: { expose: (actions: Actions) => void }) => {
  const actions = useLayerActions({
    selectedKeyType: '4key',
    layerItems: [],
    layerGroupsForMode: [],
    clearPendingDeselect: () => {},
    displayItemsRef: React.useRef([]),
    setLastClickedIndex: () => {},
    setLastClickedDisplayIndex: () => {},
    t: (key) => key,
  });
  expose(actions);
  return null;
};

describe('useLayerActions visibility routing', () => {
  let host: HTMLDivElement;
  let root: Root;
  let actions: Actions;
  let originalWindowType: typeof window.__dmn_window_type;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    originalWindowType = window.__dmn_window_type;
    window.__dmn_window_type = 'main';
    mocks.patchHidden.mockClear();
    mocks.patchLayerName.mockClear();
    mocks.patchPropertyViaAuthority.mockClear();
    mocks.updateKeyPositions.mockClear();
    useKeyStore.setState({
      canonicalPositions: {
        '4key': [{ id: STABLE_ID, dx: 0, dy: 0, width: 10, height: 10 }],
      } as never,
      positions: {
        '4key': [{ id: STABLE_ID, dx: 0, dy: 0, width: 10, height: 10 }],
      } as never,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        <Harness
          expose={(next) => {
            actions = next;
          }}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    window.__dmn_window_type = originalWindowType;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  });

  const click = {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent;

  it('stable native는 index가 틀려도 ID와 literal hidden으로 semantic op를 호출한다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: STABLE_ID,
      index: 99,
      name: 'A',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.patchHidden).toHaveBeenCalledWith('key', STABLE_ID, true);
    expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).not.toHaveBeenCalled();
  });

  it('panel stable native는 main authority RPC만 호출한다', async () => {
    window.__dmn_window_type = 'panel';
    const item: LayerItem = {
      type: 'stat',
      id: STABLE_ID,
      index: 99,
      name: 'stat',
      zIndex: 0,
      hidden: true,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.patchPropertyViaAuthority).toHaveBeenCalledWith({
      elementType: 'stat',
      id: STABLE_ID,
      patch: { hidden: false },
    });
    expect(mocks.patchHidden).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).not.toHaveBeenCalled();
  });

  it('synthetic native는 기존 index writer를 유지한다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: 'key-0',
      index: 0,
      name: 'legacy',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleToggleVisibility(click, item));

    expect(mocks.patchHidden).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).toHaveBeenCalledOnce();
  });

  it.each(['key', 'stat', 'graph', 'knob'] as const)(
    'stable %s rename은 index 대신 ID와 trimmed literal을 쓴다',
    async (type) => {
      const item: LayerItem = {
        type,
        id: STABLE_ID,
        index: 99,
        name: 'Before',
        zIndex: 0,
        hidden: false,
      };
      await act(async () => actions.handleLayerRenameCommit(item, '  After  '));

      expect(mocks.patchLayerName).toHaveBeenCalledWith(
        type,
        STABLE_ID,
        'After',
      );
      expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    },
  );

  it('panel stable native rename은 null clear를 main authority RPC에만 위임한다', async () => {
    window.__dmn_window_type = 'panel';
    const item: LayerItem = {
      type: 'graph',
      id: STABLE_ID,
      index: 0,
      name: 'Before',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleLayerRenameCommit(item, '   '));

    expect(mocks.patchPropertyViaAuthority).toHaveBeenCalledWith({
      elementType: 'graph',
      id: STABLE_ID,
      patch: { layerName: null },
    });
    expect(mocks.patchLayerName).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).not.toHaveBeenCalled();
  });

  it('synthetic native rename은 기존 index writer를 유지한다', async () => {
    const item: LayerItem = {
      type: 'key',
      id: 'key-0',
      index: 0,
      name: 'legacy',
      zIndex: 0,
      hidden: false,
    };
    await act(async () => actions.handleLayerRenameCommit(item, 'Legacy'));

    expect(mocks.patchLayerName).not.toHaveBeenCalled();
    expect(mocks.patchPropertyViaAuthority).not.toHaveBeenCalled();
    expect(mocks.updateKeyPositions).toHaveBeenCalledOnce();
  });
});
