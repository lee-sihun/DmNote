import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useGridResize } from './useGridResize';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  end: vi.fn(),
  updateElement: vi.fn(),
  setDraggingOrResizing: vi.fn(),
  clearGuides: vi.fn(),
  commitPatch: vi.fn(() => Promise.resolve()),
  beginMixedGesture: vi.fn(),
  cancelMixedGesture: vi.fn(),
  elements: [] as Array<{ fullId: string; pluginId: string }>,
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  beginPluginInstancesEditSession: mocks.begin,
  endPluginInstancesEditSession: mocks.end,
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: mocks.beginMixedGesture,
  cancelMixedGestureTransaction: mocks.cancelMixedGesture,
  cancelUncommittedMixedGestureTransaction: mocks.cancelMixedGesture,
}));

vi.mock('@stores/plugin/usePluginDisplayElementStore', () => ({
  usePluginDisplayElementStore: {
    getState: () => ({
      elements: mocks.elements,
      updateElement: mocks.updateElement,
    }),
  },
}));

vi.mock('@stores/grid/useSmartGuidesStore', () => ({
  useSmartGuidesStore: {
    getState: () => ({
      clearGuides: mocks.clearGuides,
      setDraggedBounds: vi.fn(),
      setActiveGuides: vi.fn(),
      setSpacingGuides: vi.fn(),
      setSizeMatchGuides: vi.fn(),
    }),
  },
}));

vi.mock('@stores/grid/useGridSelectionStore', () => ({
  useGridSelectionStore: {
    getState: () => ({
      setDraggingOrResizing: mocks.setDraggingOrResizing,
    }),
  },
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      gridSettings: {
        alignmentGuides: false,
        spacingGuides: false,
        sizeMatchGuides: false,
      },
    }),
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({
      positions: {
        '4key': [{ dx: 0, dy: 0, width: 40, height: 40 }],
      },
      canonicalPositions: {
        '4key': [{ dx: 0, dy: 0, width: 40, height: 40 }],
      },
      setPositions: vi.fn(),
    }),
  },
}));
vi.mock('@stores/data/useStatItemStore', () => ({
  useStatItemStore: {
    getState: () => ({ positions: { '4key': [] }, setPositions: vi.fn() }),
  },
}));
vi.mock('@stores/data/useGraphItemStore', () => ({
  useGraphItemStore: {
    getState: () => ({ positions: { '4key': [] }, setPositions: vi.fn() }),
  },
}));
vi.mock('@stores/data/useKnobItemStore', () => ({
  useKnobItemStore: {
    getState: () => ({ positions: { '4key': [] }, setPositions: vi.fn() }),
  },
}));

vi.mock('@src/renderer/editor/runtime/editorStateCoordinator', () => ({
  editorCoordinator: { commitPatch: mocks.commitPatch },
}));

type ResizeApi = ReturnType<typeof useGridResize>;

interface HarnessProps {
  selectedElements: SelectedElement[];
  onResizeEnd: (gestureId?: string) => void;
  expose: (api: ResizeApi) => void;
}

const Harness = ({ selectedElements, onResizeEnd, expose }: HarnessProps) => {
  const api = useGridResize({
    selectedElements,
    selectedKeyType: '4key',
    onResizeEnd,
  });
  expose(api);
  return null;
};

const pluginSelection = (id: string): SelectedElement => ({
  id,
  type: 'plugin',
});

const keySelection = (): SelectedElement => ({
  id: 'key-0',
  type: 'key',
  index: 0,
});

describe('useGridResize plugin gesture lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: ResizeApi;
  let tokenSequence: number;
  let events: string[];
  let onResizeEnd: Mock<(gestureId?: string) => void>;
  let pluginGestureIds: string[];

  const renderHarness = async (selectedElements: SelectedElement[]) => {
    await act(async () => {
      root.render(
        <Harness
          selectedElements={selectedElements}
          onResizeEnd={onResizeEnd}
          expose={(nextApi) => {
            api = nextApi;
          }}
        />,
      );
    });
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    tokenSequence = 0;
    events = [];
    pluginGestureIds = [];
    mocks.begin.mockReset();
    mocks.end.mockReset();
    mocks.updateElement.mockReset();
    mocks.setDraggingOrResizing.mockReset();
    mocks.clearGuides.mockReset();
    mocks.commitPatch.mockClear();
    mocks.beginMixedGesture.mockClear();
    mocks.cancelMixedGesture.mockClear();
    mocks.elements = [];
    mocks.begin.mockImplementation((pluginId: string, gestureId: string) => {
      const token = `token-${++tokenSequence}`;
      pluginGestureIds.push(gestureId);
      events.push(`begin:${pluginId}:${token}`);
      return token;
    });
    mocks.updateElement.mockImplementation((fullId: string) => {
      events.push(`update:${fullId}`);
    });
    mocks.end.mockImplementation((pluginId: string, token: string) => {
      events.push(`end:${pluginId}:${token}`);
    });
    onResizeEnd = vi.fn(() => {
      events.push('editor-end');
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('단일 plugin resize를 update와 editor 종료 뒤 끝내고 다음 resize와 분리한다', async () => {
    mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
    await renderHarness([pluginSelection('plugin-a:one')]);

    for (const width of [120, 140]) {
      await act(async () => {
        api.handleResizeStart();
        api.handleResize({ x: 10, y: 20, width, height: 80 });
        api.handleResizeComplete();
      });
    }

    expect(mocks.begin).toHaveBeenCalledTimes(2);
    expect(mocks.begin.mock.results[0]?.value).not.toBe(
      mocks.begin.mock.results[1]?.value,
    );
    expect(events).toEqual([
      'begin:plugin-a:token-1',
      'update:plugin-a:one',
      'editor-end',
      'end:plugin-a:token-1',
      'begin:plugin-a:token-2',
      'update:plugin-a:one',
      'editor-end',
      'end:plugin-a:token-2',
    ]);
  });

  it('그룹 resize의 plugin별 token을 최종 update 뒤 각각 끝낸다', async () => {
    mocks.elements = [
      { fullId: 'plugin-a:one', pluginId: 'plugin-a' },
      { fullId: 'plugin-b:one', pluginId: 'plugin-b' },
    ];
    const selected = [
      pluginSelection('plugin-a:one'),
      pluginSelection('plugin-b:one'),
    ];
    await renderHarness(selected);

    await act(async () => {
      api.handleResizeStart();
      api.handleGroupResize({
        groupBounds: { x: 10, y: 20, width: 240, height: 80 },
        elementBounds: selected.map((element, index) => ({
          element,
          bounds: { x: 10 + index * 120, y: 20, width: 100, height: 80 },
        })),
        handle: { id: 'e', dx: 1, dy: 0 },
      });
      api.handleGroupResizeComplete();
    });

    expect(events).toEqual([
      'begin:plugin-a:token-1',
      'begin:plugin-b:token-2',
      'update:plugin-a:one',
      'update:plugin-b:one',
      'editor-end',
      'end:plugin-a:token-1',
      'end:plugin-b:token-2',
    ]);
    expect(new Set(pluginGestureIds).size).toBe(1);
    expect(onResizeEnd).toHaveBeenCalledWith(pluginGestureIds[0]);
    expect(mocks.beginMixedGesture).not.toHaveBeenCalled();
  });

  it('혼합 그룹 resize는 중복 commit 없이 공유 gesture를 종료 callback에 전달한다', async () => {
    mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
    const selected = [keySelection(), pluginSelection('plugin-a:one')];
    await renderHarness(selected);

    await act(async () => {
      api.handleResizeStart();
      api.handleGroupResize({
        groupBounds: { x: 10, y: 20, width: 200, height: 80 },
        elementBounds: selected.map((element, index) => ({
          element,
          bounds: { x: 10 + index * 100, y: 20, width: 80, height: 80 },
        })),
        handle: { id: 'e', dx: 1, dy: 0 },
      });
      api.handleGroupResizeComplete();
    });

    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith(pluginGestureIds[0]);
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(pluginGestureIds[0], [
      'plugin-a',
    ]);
    expect(mocks.cancelMixedGesture).toHaveBeenCalledWith(pluginGestureIds[0]);
  });

  it('active resize 중 unmount하면 보관한 token을 종료한다', async () => {
    mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
    await renderHarness([pluginSelection('plugin-a:one')]);

    await act(async () => {
      api.handleResizeStart();
      root.render(null);
    });

    expect(mocks.end).toHaveBeenCalledWith('plugin-a', 'token-1');
  });
});
