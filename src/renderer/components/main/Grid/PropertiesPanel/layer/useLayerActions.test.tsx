import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyStore } from '@stores/data/useKeyStore';

import type { LayerItem } from '../types';

const mocks = vi.hoisted(() => ({
  patchHidden: vi.fn(() => Promise.resolve(true)),
  setHiddenViaAuthority: vi.fn(() => Promise.resolve(true)),
  updateKeyPositions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchElementHiddenById: mocks.patchHidden,
}));
vi.mock('@src/renderer/editor/runtime/deleteFrozenSelection', () => ({
  deleteFrozenSelection: vi.fn(),
}));
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  setNativeLayerHiddenViaAuthority: mocks.setHiddenViaAuthority,
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
    mocks.setHiddenViaAuthority.mockClear();
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
    expect(mocks.setHiddenViaAuthority).not.toHaveBeenCalled();
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

    expect(mocks.setHiddenViaAuthority).toHaveBeenCalledWith({
      elementType: 'stat',
      id: STABLE_ID,
      hidden: false,
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
});
