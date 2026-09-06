// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useSelectedElementDragLifecycle } from './useSelectedElementDragLifecycle';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const lifecycleMocks = vi.hoisted(() => ({
  beginPlugin: vi.fn((pluginId: string) => `token:${pluginId}`),
  endPlugin: vi.fn(),
  beginMixed: vi.fn(),
  cancelMixed: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  beginPluginInstancesEditSession: lifecycleMocks.beginPlugin,
  endPluginInstancesEditSession: lifecycleMocks.endPlugin,
}));
vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: lifecycleMocks.beginMixed,
  cancelUncommittedMixedGestureTransaction: lifecycleMocks.cancelMixed,
}));

const GESTURE_ID = '00000000-0000-4000-8000-000000000301';

describe('useSelectedElementDragLifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ReturnType<typeof useSelectedElementDragLifecycle>;
  const freezeSelection = vi.fn();
  const syncSelection = vi.fn();
  const moveSelection = vi.fn();

  const Harness = () => {
    const value = useSelectedElementDragLifecycle({
      freezeSelectionForGesture: freezeSelection,
      syncSelectedElementsToOverlay: syncSelection,
      moveSelectedElements: moveSelection,
    });
    useEffect(() => {
      controller = value;
    });
    return null;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', { randomUUID: () => GESTURE_ID });
    useGridSelectionStore.getState().setSelectedElements([
      { type: 'plugin', id: 'plugin:first' },
      { type: 'plugin', id: 'plugin:second' },
    ]);
    usePluginDisplayElementStore.setState({
      elements: [
        {
          fullId: 'plugin:first',
          pluginId: 'example',
        } as PluginDisplayElementInternal,
        {
          fullId: 'plugin:second',
          pluginId: 'example',
        } as PluginDisplayElementInternal,
        {
          fullId: 'plugin:unselected',
          pluginId: 'other',
        } as PluginDisplayElementInternal,
      ],
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('선택을 동결하고 plugin별 세션과 혼합 트랜잭션을 한 번만 연다', () => {
    let cleanup: (() => void) | undefined;
    act(() => {
      cleanup = controller.beginSelectedElementsDrag();
    });

    expect(freezeSelection).toHaveBeenCalledTimes(1);
    expect(lifecycleMocks.beginPlugin).toHaveBeenCalledTimes(1);
    expect(lifecycleMocks.beginPlugin).toHaveBeenCalledWith(
      'example',
      GESTURE_ID,
    );
    expect(lifecycleMocks.beginMixed).toHaveBeenCalledWith(GESTURE_ID, [
      'example',
    ]);

    controller.commitSelectedElementsDrag();
    expect(syncSelection).toHaveBeenCalledWith(GESTURE_ID);

    cleanup?.();
    expect(lifecycleMocks.endPlugin).toHaveBeenCalledWith(
      'example',
      'token:example',
    );
    expect(lifecycleMocks.cancelMixed).toHaveBeenCalledWith(GESTURE_ID);

    controller.commitSelectedElementsDrag();
    expect(syncSelection).toHaveBeenLastCalledWith(undefined);
  });

  it('드래그 이동은 선택 이동으로 위임하고 취소는 대기 저장을 버린다', () => {
    let cleanup: ((commit?: boolean) => void) | undefined;
    act(() => {
      cleanup = controller.beginSelectedElementsDrag();
    });

    controller.moveSelectedElementsDrag(5, -3);
    expect(moveSelection).toHaveBeenCalledWith(5, -3);

    cleanup?.(false);
    expect(lifecycleMocks.cancelMixed).toHaveBeenCalledWith(
      GESTURE_ID,
      expect.objectContaining({ discardPendingSave: true }),
    );
    expect(lifecycleMocks.endPlugin).toHaveBeenCalledWith(
      'example',
      'token:example',
    );
  });
});
