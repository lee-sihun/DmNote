import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

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
  commitMixedGesture: vi.fn(() => Promise.resolve()),
  cancelMixedGesture: vi.fn(),
  sendBridge: vi.fn(),
  commitBounds: vi.fn(() => Promise.resolve(true)),
  elements: [] as Array<{ fullId: string; pluginId: string }>,
}));

vi.mock('@plugins/runtime/displayElement/instancesCommitQueue', () => ({
  beginPluginInstancesEditSession: mocks.begin,
  endPluginInstancesEditSession: mocks.end,
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  beginMixedGestureTransaction: mocks.beginMixedGesture,
  commitMixedGestureTransaction: mocks.commitMixedGesture,
  cancelMixedGestureTransaction: mocks.cancelMixedGesture,
  cancelUncommittedMixedGestureTransaction: mocks.cancelMixedGesture,
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: mocks.sendBridge,
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  commitElementBoundsById: mocks.commitBounds,
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
  selectionElementId: (
    type: string,
    position: { id?: string } | undefined,
    index: number,
  ) => position?.id || `${type}-${index}`,
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
  editorCoordinator: {
    commitPatch: mocks.commitPatch,
    getState: () => ({ lastAck: null }),
  },
}));

type ResizeApi = ReturnType<typeof useGridResize>;

interface HarnessProps {
  selectedElements: SelectedElement[];
  expose: (api: ResizeApi) => void;
}

const Harness = ({ selectedElements, expose }: HarnessProps) => {
  const api = useGridResize({
    selectedElements,
    selectedKeyType: '4key',
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

const STABLE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STABLE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const stableKeySelection = (id: string, index = 0): SelectedElement => ({
  id,
  type: 'key',
  index,
});

describe('useGridResize plugin gesture lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: ResizeApi;
  let tokenSequence: number;
  let events: string[];
  let pluginGestureIds: string[];

  const renderHarness = async (selectedElements: SelectedElement[]) => {
    await act(async () => {
      root.render(
        <Harness
          selectedElements={selectedElements}
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
    mocks.commitBounds.mockClear();
    mocks.commitMixedGesture.mockClear();
    mocks.sendBridge.mockClear();
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
      'end:plugin-a:token-1',
      'begin:plugin-a:token-2',
      'update:plugin-a:one',
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
      'end:plugin-a:token-1',
      'end:plugin-b:token-2',
    ]);
    expect(new Set(pluginGestureIds).size).toBe(1);
    // plugin-only는 editor 무커밋 계약 - 오버레이 동기화만 수행
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.beginMixedGesture).not.toHaveBeenCalled();
    expect(mocks.sendBridge).toHaveBeenCalledWith(
      'overlay',
      'plugin:displayElements:sync',
      { elements: mocks.elements },
    );
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
    // 정산은 훅 내부에서 시작 시점 plugin ID 집합으로 완결된다
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(pluginGestureIds[0], [
      'plugin-a',
    ]);
    // wire patch는 호출 시점 full-record가 아니라 슬롯 generator로 전달된다
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      pluginGestureIds[0],
      expect.any(Function),
      ['plugin-a'],
      expect.anything(),
    );
  });

  it('혼합 그룹 resize 중 선택이 바뀌어도 시작 구성으로 정산한다', async () => {
    mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
    const selected = [
      stableKeySelection(STABLE_A),
      pluginSelection('plugin-a:one'),
    ];
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
    });
    // 대기 중 다른 혼합 선택으로 교체
    mocks.elements = [{ fullId: 'plugin-b:one', pluginId: 'plugin-b' }];
    await renderHarness([
      stableKeySelection(STABLE_B),
      pluginSelection('plugin-b:one'),
    ]);
    await act(async () => {
      api.handleGroupResizeComplete();
    });

    // 정산은 시작 gesture와 시작 plugin ID 집합만 사용
    expect(mocks.commitMixedGesture).toHaveBeenCalledTimes(1);
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      pluginGestureIds[0],
      expect.any(Function),
      ['plugin-a'],
      expect.anything(),
    );
    // generator는 슬롯 base에서 시작 동결 A의 id 의도만 재적용한다
    const generate = (
      mocks.commitMixedGesture.mock.calls[0] as unknown[]
    )[1] as (base: unknown) => {
      keyPositions?: Record<string, Array<Record<string, unknown>>>;
    };
    const base = {
      schemaVersion: 1,
      keys: { '4key': ['A'] },
      keyPositions: {
        '4key': [
          { ...createDefaultKeyPosition(), id: STABLE_A, noteWidth: 111 },
        ],
      },
      statPositions: {},
      graphPositions: {},
      knobPositions: {},
      layerGroups: {},
    };
    const patch = generate(base);
    // 시작 동결 bounds가 base에 재적용되고 base의 다른 필드는 보존된다
    expect(patch?.keyPositions?.['4key'][0]).toMatchObject({
      id: STABLE_A,
      dx: 10,
      dy: 20,
      width: 80,
      height: 80,
      noteWidth: 111,
    });
    expect(mocks.commitBounds).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
  });

  it('그룹 resize 완료는 시작 시점 entries의 안정 id별로 bounds를 커밋한다', async () => {
    const selected = [
      stableKeySelection(STABLE_A, 0),
      stableKeySelection(STABLE_B, 1),
    ];
    await renderHarness(selected);

    await act(async () => {
      api.handleResizeStart();
      api.handleGroupResize({
        groupBounds: { x: 10, y: 20, width: 210, height: 80 },
        elementBounds: [
          {
            element: selected[0],
            bounds: { x: 10, y: 20, width: 100, height: 80 },
          },
          {
            element: selected[1],
            bounds: { x: 120, y: 20, width: 90, height: 70 },
          },
        ],
        handle: { id: 'e', dx: 1, dy: 0 },
      });
    });
    // 대기 중 선택 교체 (외부 재정렬·분리 패널 동기화)
    await renderHarness([keySelection()]);
    await act(async () => {
      api.handleGroupResizeComplete();
    });

    expect(mocks.commitBounds).toHaveBeenCalledTimes(1);
    const [intents] = mocks.commitBounds.mock.calls[0] as unknown as [
      Map<string, Map<string, Record<string, number>>>,
    ];
    const byId = intents.get('key')!;
    expect([...byId.keys()].sort()).toEqual([STABLE_A, STABLE_B]);
    expect(byId.get(STABLE_A)).toMatchObject({
      dx: 10,
      dy: 20,
      width: 100,
      height: 80,
    });
    expect(byId.get(STABLE_B)).toMatchObject({
      dx: 120,
      dy: 20,
      width: 90,
      height: 70,
    });
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.commitMixedGesture).not.toHaveBeenCalled();
  });

  it('리사이즈 중 선택이 바뀌어도 시작 시점 동결 대상에 bounds를 커밋한다', async () => {
    await renderHarness([stableKeySelection(STABLE_A)]);

    await act(async () => {
      api.handleResizeStart();
      api.handleResize({ x: 10, y: 20, width: 120, height: 80 });
    });
    // 대기 중 같은 개수의 다른 선택으로 교체 (분리 패널 동기화 등)
    await renderHarness([stableKeySelection(STABLE_B)]);
    await act(async () => {
      api.handleResizeComplete();
    });

    expect(mocks.commitBounds).toHaveBeenCalledTimes(1);
    const [intents] = mocks.commitBounds.mock.calls[0] as unknown as [
      Map<string, Map<string, Record<string, number>>>,
    ];
    const byId = intents.get('key')!;
    expect([...byId.keys()]).toEqual([STABLE_A]);
    expect(byId.get(STABLE_A)).toMatchObject({ width: 120, height: 80 });
  });

  it('시작 baseline이 없는 합성 단일 resize는 eager와 wire 모두 무커밋한다', async () => {
    // coordinator lastAck가 null - 합성 index 의도는 시작 증명 없이는
    // 어떤 경로로도 커밋되지 않는다 (wire 부활 금지)
    await renderHarness([keySelection()]);

    await act(async () => {
      api.handleResizeStart();
      api.handleResize({ x: 10, y: 20, width: 120, height: 80 });
      api.handleResizeComplete();
    });

    expect(mocks.commitBounds).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.commitMixedGesture).not.toHaveBeenCalled();
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
