import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_OPS_VERSION } from '@src/types/editor';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import type { ElementBounds } from '@utils/grid/smartGuides';
import { aspectScaleRange } from '@components/main/Grid/handles/aspectResize';
import { useGridResize } from './useGridResize';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import {
  acquireHistoryEditorFlushLock,
  resetHistoryEditorFlushLock,
} from '@src/renderer/editor/runtime/historyEditorFlushLock';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  end: vi.fn(),
  updateElement: vi.fn(),
  setResizing: vi.fn(),
  clearGuides: vi.fn(),
  setDraggedBounds: vi.fn(),
  setActiveGuides: vi.fn(),
  setSpacingGuides: vi.fn(),
  setSizeMatchGuides: vi.fn(),
  calculateSnapPoints: vi.fn(),
  calculateSizeSnap: vi.fn(),
  // 스냅 실물 - 비율 고정·축 게이트처럼 실제 스냅 계산이 필요한 테스트가 되돌려 쓴다
  realSmartGuides: null as typeof import('@utils/grid/smartGuides') | null,
  commitPatch: vi.fn(() => Promise.resolve()),
  beginMixedGesture: vi.fn(),
  commitMixedGesture: vi.fn(() => Promise.resolve()),
  cancelMixedGesture: vi.fn(),
  sendBridge: vi.fn(),
  commitGroupBounds: vi.fn(() => Promise.resolve(true)),
  commitSingleBounds: vi.fn(() => Promise.resolve(true)),
  elements: [] as Array<{ fullId: string; pluginId: string }>,
  keyPositions: [{ dx: 0, dy: 0, width: 40, height: 40 }] as Array<{
    id?: string;
    dx: number;
    dy: number;
    width: number;
    height: number;
  }>,
  gridSettings: {
    alignmentGuides: false,
    spacingGuides: false,
    sizeMatchGuides: false,
  },
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

vi.mock('@src/renderer/editor/runtime/elementOps', async (importOriginal) => {
  // eager 적용·op 구성은 실물을 쓰고 wire 커밋만 mock - sprite projection
  // 계약이 테스트에서 실제 경로로 돈다
  const actual = await importOriginal<
    typeof import('@src/renderer/editor/runtime/elementOps')
  >();
  return {
    ...actual,
    commitElementBoundsById: mocks.commitGroupBounds,
    commitSingleElementBoundsById: mocks.commitSingleBounds,
  };
});

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
      setDraggedBounds: mocks.setDraggedBounds,
      setActiveGuides: mocks.setActiveGuides,
      setSpacingGuides: mocks.setSpacingGuides,
      setSizeMatchGuides: mocks.setSizeMatchGuides,
    }),
  },
}));

vi.mock('@utils/grid/smartGuides', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@utils/grid/smartGuides')
  >();
  mocks.realSmartGuides = original;
  return {
    ...original,
    calculateSnapPoints: mocks.calculateSnapPoints,
    calculateSizeSnap: mocks.calculateSizeSnap,
  };
});

const useRealSmartGuides = () => {
  const real = mocks.realSmartGuides!;
  mocks.calculateSnapPoints.mockImplementation(real.calculateSnapPoints);
  mocks.calculateSizeSnap.mockImplementation(real.calculateSizeSnap);
};

vi.mock('@stores/grid/useGridSelectionStore', () => ({
  selectionElementId: (
    type: string,
    position: { id?: string } | undefined,
    index: number,
  ) => position?.id || `${type}-${index}`,
  useGridSelectionStore: {
    getState: () => ({
      setResizing: mocks.setResizing,
    }),
  },
}));

vi.mock('@stores/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      gridSettings: mocks.gridSettings,
    }),
  },
}));

vi.mock('@stores/data/useKeyStore', () => ({
  useKeyStore: {
    getState: () => ({
      positions: {
        '4key': mocks.keyPositions,
      },
      canonicalPositions: {
        '4key': mocks.keyPositions,
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
  getOtherElements?: (excludeId: string) => ElementBounds[];
}

const Harness = ({
  selectedElements,
  expose,
  getOtherElements,
}: HarnessProps) => {
  const api = useGridResize({
    selectedElements,
    selectedKeyType: '4key',
    getOtherElements,
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
const STABLE_SPRITE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const spriteAt = (id: string): CanonicalReactiveSpritePosition => ({
  activation: 'whileHeld',
  pressDurationMs: 300,
  id,
  dx: 0,
  dy: 0,
  width: 200,
  height: 120,
  hidden: false,
  zIndex: null,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  rotation: 0,
  baseImage: null,
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [
    {
      imageOverrideMetrics: null,
      poseId: 'pose-1',
      triggers: [STABLE_A],
      transform: { x: 12, y: -6, rotation: 15, scale: 1.2 },
      imageOverride: null,
    },
  ],
  transitionMs: 90,
  transitionEasing: 'linear',
  referenceNaturalSize: null,
});

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

  const renderHarness = async (
    selectedElements: SelectedElement[],
    getOtherElements?: (excludeId: string) => ElementBounds[],
  ) => {
    await act(async () => {
      root.render(
        <Harness
          selectedElements={selectedElements}
          getOtherElements={getOtherElements}
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
    mocks.setResizing.mockReset();
    mocks.clearGuides.mockReset();
    mocks.setDraggedBounds.mockReset();
    mocks.setActiveGuides.mockReset();
    mocks.setSpacingGuides.mockReset();
    mocks.setSizeMatchGuides.mockReset();
    mocks.calculateSnapPoints.mockReset();
    mocks.calculateSizeSnap.mockReset();
    mocks.commitPatch.mockClear();
    mocks.commitGroupBounds.mockClear();
    mocks.commitSingleBounds.mockClear();
    mocks.commitMixedGesture.mockClear();
    mocks.sendBridge.mockClear();
    mocks.beginMixedGesture.mockClear();
    mocks.cancelMixedGesture.mockClear();
    mocks.elements = [];
    mocks.keyPositions = [{ dx: 0, dy: 0, width: 40, height: 40 }];
    useSpriteStore.setState({ positions: {} });
    mocks.gridSettings = {
      alignmentGuides: false,
      spacingGuides: false,
      sizeMatchGuides: false,
    };
    mocks.calculateSnapPoints.mockImplementation((draggedBounds) => ({
      snappedX: draggedBounds.left,
      snappedY: draggedBounds.top,
      guides: [],
      spacingGuides: [],
      didSnapX: false,
      didSnapY: false,
      didSpacingSnapX: false,
      didSpacingSnapY: false,
    }));
    mocks.calculateSizeSnap.mockImplementation((width, height) => ({
      snappedWidth: width,
      snappedHeight: height,
      sizeMatchGuides: [],
      didSnapWidth: false,
      didSnapHeight: false,
    }));
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
    resetHistoryEditorFlushLock();
    host.remove();
  });

  it('리사이즈 전용 상태만 수명에 맞춰 켜고 끈다', async () => {
    await renderHarness([stableKeySelection(STABLE_A)]);

    await act(async () => {
      api.handleResizeStart();
    });
    expect(mocks.setResizing).toHaveBeenLastCalledWith(true);

    await act(async () => {
      api.handleResize({ x: 10, y: 20, width: 120, height: 80 });
      api.handleResizeComplete();
    });
    expect(mocks.setResizing).toHaveBeenLastCalledWith(false);
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
    // plugin-only도 editor payload 없는 단일 plugin transaction으로 정산
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(pluginGestureIds[0], [
      'plugin-a',
      'plugin-b',
    ]);
    expect(mocks.commitMixedGesture).toHaveBeenCalledTimes(1);
    const [gestureId, mutation, pluginIds] = mocks.commitMixedGesture.mock
      .calls[0] as unknown as [string, () => unknown, string[]];
    expect(gestureId).toBe(pluginGestureIds[0]);
    expect(mutation()).toBeNull();
    expect(pluginIds).toEqual(['plugin-a', 'plugin-b']);
    expect(mocks.sendBridge).toHaveBeenCalledWith(
      'overlay',
      'plugin:displayElements:sync',
      { elements: mocks.elements },
    );
  });

  it('혼합 그룹 resize는 중복 commit 없이 공유 gesture를 종료 callback에 전달한다', async () => {
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
      api.handleGroupResizeComplete();
    });

    expect(mocks.commitPatch).not.toHaveBeenCalled();
    // 정산은 훅 내부에서 시작 시점 plugin ID 집합으로 완결된다
    expect(mocks.beginMixedGesture).toHaveBeenCalledWith(pluginGestureIds[0], [
      'plugin-a',
    ]);
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      pluginGestureIds[0],
      {
        opsVersion: EDITOR_OPS_VERSION,
        ops: [
          {
            kind: 'setBounds',
            elementType: 'key',
            id: STABLE_A,
            bounds: { dx: 10, dy: 20, width: 80, height: 80 },
          },
        ],
      },
      ['plugin-a'],
      expect.anything(),
    );
  });

  it('혼합 그룹의 native ID가 비정규면 plugin까지 함께 fail-close한다', async () => {
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

    expect(mocks.commitGroupBounds).not.toHaveBeenCalled();
    expect(mocks.commitSingleBounds).not.toHaveBeenCalled();
    expect(mocks.commitMixedGesture).not.toHaveBeenCalled();
    expect(mocks.updateElement).not.toHaveBeenCalled();
    expect(mocks.sendBridge).not.toHaveBeenCalled();
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
      {
        opsVersion: EDITOR_OPS_VERSION,
        ops: [
          {
            kind: 'setBounds',
            elementType: 'key',
            id: STABLE_A,
            bounds: { dx: 10, dy: 20, width: 80, height: 80 },
          },
        ],
      },
      ['plugin-a'],
      expect.anything(),
    );
    expect(mocks.commitGroupBounds).not.toHaveBeenCalled();
    expect(mocks.commitSingleBounds).not.toHaveBeenCalled();
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
    await renderHarness([stableKeySelection(STABLE_B)]);
    await act(async () => {
      api.handleGroupResizeComplete();
    });

    expect(mocks.commitGroupBounds).toHaveBeenCalledTimes(1);
    const [intents] = mocks.commitGroupBounds.mock.calls[0] as unknown as [
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

    expect(mocks.commitSingleBounds).toHaveBeenCalledWith(
      'key',
      STABLE_A,
      { dx: 10, dy: 20, width: 120, height: 80 },
      expect.any(String),
    );
    expect(mocks.commitGroupBounds).not.toHaveBeenCalled();
  });

  it('리사이즈 중 재정렬돼도 프리뷰 가이드는 시작 요소를 제외한다', async () => {
    const getOtherElements = vi.fn(() => [] as ElementBounds[]);
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: true,
      sizeMatchGuides: true,
    };
    mocks.keyPositions = [
      { id: STABLE_A, dx: 0, dy: 0, width: 120, height: 60 },
      { id: STABLE_B, dx: 200, dy: 0, width: 120, height: 60 },
    ];
    await renderHarness([stableKeySelection(STABLE_A)], getOtherElements);
    const activeResizeApi = api;

    await act(async () => {
      activeResizeApi.handleResizeStart();
    });
    mocks.keyPositions = [mocks.keyPositions[1], mocks.keyPositions[0]];
    await renderHarness([stableKeySelection(STABLE_A, 1)], getOtherElements);
    await act(async () => {
      activeResizeApi.handleResize({
        x: 0,
        y: 0,
        width: 118,
        height: 60,
        handle: { id: 'e', dx: 1, dy: 0 },
      });
    });

    expect(getOtherElements).toHaveBeenLastCalledWith(STABLE_A);
  });

  it('size match 비활성 native resize는 대상과 무관한 수평 간격 가이드를 제외한다', async () => {
    const unrelatedGuide = {
      type: 'spacing' as const,
      direction: 'horizontal' as const,
      value: 20,
      startPos: 0,
      endPos: 20,
      crossAxisPos: 0,
      fromElementId: 'reference-a',
      toElementId: 'reference-b',
      isMatched: true,
    };
    const relatedGuide = {
      ...unrelatedGuide,
      fromElementId: STABLE_A,
      toElementId: 'reference-c',
    };
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: true,
      sizeMatchGuides: false,
    };
    mocks.calculateSnapPoints.mockReturnValue({
      snappedX: 0,
      snappedY: 0,
      guides: [],
      spacingGuides: [relatedGuide, unrelatedGuide],
      didSnapX: true,
      didSnapY: false,
      didSpacingSnapX: true,
      didSpacingSnapY: false,
    });
    await renderHarness([stableKeySelection(STABLE_A)], () => []);

    await act(async () => {
      api.handleResizeStart();
      api.handleResize({
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        handle: { id: 'e', dx: 1, dy: 0 },
      });
    });

    expect(mocks.setSpacingGuides).toHaveBeenLastCalledWith([relatedGuide]);
  });

  it('size match 비활성 plugin resize는 참조용 수평 간격 가이드를 유지한다', async () => {
    const pluginId = 'plugin-a:one';
    const unrelatedGuide = {
      type: 'spacing' as const,
      direction: 'horizontal' as const,
      value: 20,
      startPos: 0,
      endPos: 20,
      crossAxisPos: 0,
      fromElementId: 'reference-a',
      toElementId: 'reference-b',
      isMatched: true,
    };
    const relatedGuide = {
      ...unrelatedGuide,
      fromElementId: pluginId,
      toElementId: 'reference-c',
    };
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: true,
      sizeMatchGuides: false,
    };
    mocks.calculateSnapPoints.mockReturnValue({
      snappedX: 0,
      snappedY: 0,
      guides: [],
      spacingGuides: [relatedGuide, unrelatedGuide],
      didSnapX: true,
      didSnapY: false,
      didSpacingSnapX: true,
      didSpacingSnapY: false,
    });
    await renderHarness([pluginSelection(pluginId)], () => []);

    await act(async () => {
      api.handleResizeStart();
      api.handleResize({
        x: 0,
        y: 0,
        width: 120,
        height: 60,
        handle: { id: 'e', dx: 1, dy: 0 },
      });
    });

    expect(mocks.setSpacingGuides).toHaveBeenLastCalledWith([
      relatedGuide,
      unrelatedGuide,
    ]);
  });

  it('합성 native 단일 resize는 로컬과 wire를 모두 무커밋한다', async () => {
    await renderHarness([keySelection()]);

    await act(async () => {
      api.handleResizeStart();
      api.handleResize({ x: 10, y: 20, width: 120, height: 80 });
      api.handleResizeComplete();
    });

    expect(mocks.commitGroupBounds).not.toHaveBeenCalled();
    expect(mocks.commitSingleBounds).not.toHaveBeenCalled();
    expect(mocks.commitPatch).not.toHaveBeenCalled();
    expect(mocks.commitMixedGesture).not.toHaveBeenCalled();
  });

  it('합성 native 단일 resize의 무커밋 보고는 정확히 1회다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderHarness([keySelection()]);

    await act(async () => {
      api.handleResizeStart();
      api.handleResize({ x: 10, y: 20, width: 120, height: 80 });
      api.handleResizeComplete();
    });

    const skips = warn.mock.calls.filter(
      (call) => call[1] === 'resize settlement (invalid native id)',
    );
    expect(skips).toHaveLength(1);
    warn.mockRestore();
  });

  it('프리뷰 없이 끝난 단일 resize도 무커밋을 보고한다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderHarness([stableKeySelection(STABLE_A)]);

    // handleResize 없이 종료 - finalBounds가 한 번도 계산되지 않은 경로
    await act(async () => {
      api.handleResizeStart();
      api.handleResizeComplete();
    });

    expect(mocks.commitSingleBounds).not.toHaveBeenCalled();
    const skips = warn.mock.calls.filter(
      (call) => call[1] === 'resize settlement (no preview bounds)',
    );
    expect(skips).toHaveLength(1);
    warn.mockRestore();
  });

  it('그룹 resize가 프리뷰 없이 끝나면 단일 경로 보고를 내지 않는다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderHarness([
      stableKeySelection(STABLE_A),
      stableKeySelection(STABLE_B, 1),
    ]);

    await act(async () => {
      api.handleResizeStart();
      api.handleResizeComplete();
    });

    const skips = warn.mock.calls.filter(
      (call) => typeof call[1] === 'string' && call[1].startsWith('resize '),
    );
    expect(skips).toHaveLength(0);
    warn.mockRestore();
  });

  it('active resize 중 unmount하면 보관한 token을 종료한다', async () => {
    mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
    await renderHarness([pluginSelection('plugin-a:one')]);

    await act(async () => {
      api.handleResizeStart();
      root.render(null);
    });

    expect(mocks.end).toHaveBeenCalledWith('plugin-a', 'token-1');
    expect(mocks.setResizing).toHaveBeenLastCalledWith(false);
  });

  it('history 잠금 중 새 resize는 시작하거나 저장하지 않는다', async () => {
    await renderHarness([stableKeySelection(STABLE_A)]);
    acquireHistoryEditorFlushLock('resize-start');
    try {
      await act(async () => {
        api.handleResizeStart();
        api.handleResize({ x: 10, y: 20, width: 80, height: 90 });
        api.handleResizeComplete();
      });
      expect(mocks.commitSingleBounds).not.toHaveBeenCalled();
      expect(mocks.setResizing).not.toHaveBeenCalled();
      expect(api.previewBounds).toBeNull();
    } finally {
      resetHistoryEditorFlushLock();
    }
  });

  it.each(
    ['native', 'plugin', 'group'].flatMap((kind) =>
      ['applied', 'locked'].map((boundary) => ({ kind, boundary })),
    ),
  )(
    '$kind history $boundary 뒤 늦은 preview와 complete는 저장하지 않는다',
    async ({ kind, boundary }) => {
      mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
      const selection =
        kind === 'plugin'
          ? [pluginSelection('plugin-a:one')]
          : [stableKeySelection(STABLE_A)];
      await renderHarness(selection);
      const bounds = { x: 10, y: 20, width: 80, height: 90 };
      const groupResult = {
        groupBounds: bounds,
        elementBounds: [{ element: selection[0], bounds }],
        handle: { id: 'se', dx: 1, dy: 1 },
      };
      await act(async () => {
        api.handleResizeStart();
        if (kind === 'group') api.handleGroupResize(groupResult);
        else api.handleResize(bounds);
        if (boundary === 'applied')
          useCommittedApplyStore.getState().bump('historyUndo');
        else acquireHistoryEditorFlushLock('resize-release');
        if (kind === 'group') {
          api.handleGroupResize(groupResult);
          api.handleGroupResizeComplete();
        } else {
          api.handleResize(bounds);
          api.handleResizeComplete();
        }
      });
      expect(mocks.commitSingleBounds).not.toHaveBeenCalled();
      expect(mocks.commitGroupBounds).not.toHaveBeenCalled();
      expect(mocks.updateElement).not.toHaveBeenCalled();
      if (boundary === 'locked') {
        await act(async () => {
          useCommittedApplyStore.getState().bump('historyUndo');
        });
        resetHistoryEditorFlushLock();
      }
      expect(api.previewBounds).toBeNull();
      expect(api.previewGroupBounds).toBeNull();
      expect(api.previewElementBounds).toBeNull();
      if (kind === 'plugin') expect(mocks.end).toHaveBeenCalledOnce();
    },
  );

  it('그룹 resize의 sprite는 resizeSprite op으로 bounds와 콘텐츠를 함께 스케일한다', async () => {
    const original = spriteAt(STABLE_SPRITE);
    useSpriteStore.setState({ positions: { '4key': [original] } });
    mocks.elements = [{ fullId: 'plugin-a:one', pluginId: 'plugin-a' }];
    const spriteSelected: SelectedElement = {
      id: STABLE_SPRITE,
      type: 'sprite',
      index: 0,
    };
    const selected = [spriteSelected, pluginSelection('plugin-a:one')];
    await renderHarness(selected);

    await act(async () => {
      api.handleResizeStart();
      api.handleGroupResize({
        groupBounds: { x: 10, y: 20, width: 200, height: 80 },
        elementBounds: [
          {
            element: spriteSelected,
            bounds: { x: 10, y: 20, width: 100, height: 60 },
          },
          {
            element: selected[1],
            bounds: { x: 120, y: 20, width: 80, height: 60 },
          },
        ],
        handle: { id: 'e', dx: 1, dy: 0 },
      });
      api.handleGroupResizeComplete();
    });

    // wire: sprite는 resizeSprite op - bounds만 실리고 배율은 백엔드가 최신
    // base 기준으로 재적용한다
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      pluginGestureIds[0],
      {
        opsVersion: EDITOR_OPS_VERSION,
        ops: [
          {
            kind: 'resizeSprite',
            id: STABLE_SPRITE,
            bounds: { dx: 10, dy: 20, width: 100, height: 60 },
          },
        ],
      },
      ['plugin-a'],
      expect.anything(),
    );
    // eager: 200x120 → 100x60 (sx=sy=0.5)로 콘텐츠까지 비례 스케일.
    // pivot은 정규화 좌표라 불변 (참조까지 보존)
    const eager = useSpriteStore.getState().positions['4key'][0];
    expect(eager).toMatchObject({ dx: 10, dy: 20, width: 100, height: 60 });
    expect(eager.idleTransform).toEqual({ x: 0, y: 0, rotation: 0, scale: 1 });
    expect(eager.poses[0].transform).toEqual({
      x: 6,
      y: -3,
      rotation: 15,
      scale: 1.2,
    });
    expect(eager.pivot).toBe(original.pivot);
  });

  it('비율 고정 리사이즈는 기준 축의 크기 일치만 받고 반대 축을 같은 배율로 놓는다', async () => {
    useRealSmartGuides();
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: false,
      sizeMatchGuides: true,
    };
    useSpriteStore.setState({
      positions: {
        '4key': [{ ...spriteAt(STABLE_SPRITE), width: 110, height: 55 }],
      },
    });
    // 폭 112는 임계값 4px 안, 높이 60은 밖. 가장자리는 멀리 둬 정렬 스냅은 없다
    const other: ElementBounds = {
      id: 'other',
      left: 1000,
      top: 1000,
      right: 1112,
      bottom: 1060,
      centerX: 1056,
      centerY: 1030,
      width: 112,
      height: 60,
    };
    await renderHarness(
      [{ type: 'sprite', id: STABLE_SPRITE, index: 0 }],
      () => [other],
    );
    const start = { x: 0, y: 0, width: 110, height: 55 };
    const handle = { id: 'e', dx: 1, dy: 0 };
    await act(async () => {
      api.handleResizeStart();
    });
    await act(async () => {
      api.handleResize({
        ...start,
        handle,
        aspect: {
          start,
          primary: 'width',
          range: aspectScaleRange(start, { dx: 1, dy: 0 }, 10),
        },
      });
    });
    expect(api.previewBounds?.width).toBe(112);
    expect(api.previewBounds?.height).toBeCloseTo(56, 9);
    expect(api.previewBounds?.y).toBeCloseTo(-0.5, 9);
    expect(api.previewBounds?.x).toBe(0);
  });

  it('기준 축 스냅이 배율 범위를 넘으면 상한으로 자른다', async () => {
    useRealSmartGuides();
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: false,
      sizeMatchGuides: true,
    };
    useSpriteStore.setState({
      positions: {
        '4key': [{ ...spriteAt(STABLE_SPRITE), width: 100, height: 100 }],
      },
    });
    const other: ElementBounds = {
      id: 'other',
      left: 1000,
      top: 1000,
      right: 1104,
      bottom: 1500,
      centerX: 1052,
      centerY: 1250,
      width: 104,
      height: 500,
    };
    await renderHarness(
      [{ type: 'sprite', id: STABLE_SPRITE, index: 0 }],
      () => [other],
    );
    const start = { x: 0, y: 0, width: 100, height: 100 };
    await act(async () => {
      api.handleResizeStart();
    });
    await act(async () => {
      api.handleResize({
        ...start,
        handle: { id: 'e', dx: 1, dy: 0 },
        aspect: { start, primary: 'width', range: { min: 0.5, max: 1.02 } },
      });
    });
    // 크기 일치 104 → 배율 1.04 는 상한 1.02 밖 → 102x102, 세로는 중앙 고정
    expect(api.previewBounds).toEqual({ x: 0, y: -1, width: 102, height: 102 });
  });

  it('잡지 않은 축의 크기 일치는 무시한다 (가로 핸들은 높이를 바꾸지 않는다)', async () => {
    useRealSmartGuides();
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: false,
      sizeMatchGuides: true,
    };
    mocks.keyPositions = [
      { id: STABLE_A, dx: 0, dy: 0, width: 120, height: 60 },
    ];
    // 높이 62는 임계값 안, 폭 500은 밖
    const other: ElementBounds = {
      id: 'other',
      left: 1000,
      top: 1000,
      right: 1500,
      bottom: 1062,
      centerX: 1250,
      centerY: 1031,
      width: 500,
      height: 62,
    };
    await renderHarness([stableKeySelection(STABLE_A)], () => [other]);
    await act(async () => {
      api.handleResizeStart();
    });
    await act(async () => {
      api.handleResize({
        x: 0,
        y: 0,
        width: 118,
        height: 60,
        handle: { id: 'e', dx: 1, dy: 0 },
      });
    });
    expect(api.previewBounds).toEqual({ x: 0, y: 0, width: 118, height: 60 });
  });

  it('플러그인 단일 리사이즈도 비율 고정 재유도를 같은 경로로 받는다', async () => {
    useRealSmartGuides();
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: false,
      sizeMatchGuides: true,
    };
    mocks.elements = [{ fullId: 'plugin-a', pluginId: 'plugin' }];
    // 폭 104는 임계값 안, 높이 500은 밖
    const other: ElementBounds = {
      id: 'other',
      left: 1000,
      top: 1000,
      right: 1104,
      bottom: 1500,
      centerX: 1052,
      centerY: 1250,
      width: 104,
      height: 500,
    };
    await renderHarness([pluginSelection('plugin-a')], () => [other]);
    const start = { x: 0, y: 0, width: 100, height: 100 };
    await act(async () => {
      api.handleResizeStart();
    });
    await act(async () => {
      api.handleResize({
        ...start,
        handle: { id: 'se', dx: 1, dy: 1 },
        aspect: { start, primary: 'width', range: { min: 0.1, max: 10 } },
      });
    });
    // Shift 모서리: 폭 크기 일치 104 → 높이도 같은 배율 104
    expect(api.previewBounds).toEqual({ x: 0, y: 0, width: 104, height: 104 });
  });

  it('비율 고정은 무시한 반대 축의 정렬 가이드를 그리지 않는다', async () => {
    useRealSmartGuides();
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: false,
      sizeMatchGuides: false,
    };
    useSpriteStore.setState({
      positions: {
        '4key': [{ ...spriteAt(STABLE_SPRITE), width: 100, height: 100 }],
      },
    });
    // 오른쪽 가장자리 105는 오른쪽 108에(3px), 위쪽 0은 위쪽 0에 정렬 후보 - 두 축 모두 임계값 안
    const other: ElementBounds = {
      id: 'other',
      left: 8,
      top: 0,
      right: 108,
      bottom: 100,
      centerX: 58,
      centerY: 50,
      width: 100,
      height: 100,
    };
    await renderHarness(
      [{ type: 'sprite', id: STABLE_SPRITE, index: 0 }],
      () => [other],
    );
    const start = { x: 0, y: 0, width: 100, height: 100 };
    await act(async () => {
      api.handleResizeStart();
    });
    await act(async () => {
      api.handleResize({
        x: 0,
        y: 0,
        width: 105,
        height: 105,
        handle: { id: 'se', dx: 1, dy: 1 },
        aspect: { start, primary: 'width', range: { min: 0.1, max: 10 } },
      });
    });
    // 폭만 108로 스냅되고 높이는 같은 배율로 108
    expect(api.previewBounds).toEqual({ x: 0, y: 0, width: 108, height: 108 });
    const guides = mocks.setActiveGuides.mock.calls.at(-1)?.[0] as Array<{
      type: string;
    }>;
    expect(guides.length).toBeGreaterThan(0);
    expect(guides.every((guide) => guide.type === 'vertical')).toBe(true);
  });

  it('잡지 않은 축은 정렬 후보가 있어도 위치를 옮기지 않는다', async () => {
    useRealSmartGuides();
    mocks.gridSettings = {
      alignmentGuides: true,
      spacingGuides: false,
      sizeMatchGuides: false,
    };
    mocks.keyPositions = [
      { id: STABLE_A, dx: 3, dy: 0, width: 100, height: 100 },
    ];
    // 왼쪽 가장자리 3은 다른 요소의 왼쪽 0에 정렬 후보(3px) - 아래 핸들이라 X는 잡지 않은 축
    const other: ElementBounds = {
      id: 'other',
      left: 0,
      top: 500,
      right: 100,
      bottom: 600,
      centerX: 50,
      centerY: 550,
      width: 100,
      height: 100,
    };
    await renderHarness([stableKeySelection(STABLE_A)], () => [other]);
    await act(async () => {
      api.handleResizeStart();
    });
    await act(async () => {
      api.handleResize({
        x: 3,
        y: 0,
        width: 100,
        height: 120,
        handle: { id: 's', dx: 0, dy: 1 },
      });
    });
    expect(api.previewBounds).toEqual({ x: 3, y: 0, width: 100, height: 120 });
    expect(mocks.setActiveGuides).not.toHaveBeenCalled();
  });
});
