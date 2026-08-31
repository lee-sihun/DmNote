import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_OPS_VERSION } from '@src/types/editor';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { SelectedElement } from '@stores/grid/useGridSelectionStore';
import { useSpriteStore } from '@stores/data/useSpriteStore';
import type { ElementBounds } from '@utils/grid/smartGuides';
import { useGridResize } from './useGridResize';

const mocks = vi.hoisted(() => ({
  begin: vi.fn(),
  end: vi.fn(),
  updateElement: vi.fn(),
  setResizing: vi.fn(),
  clearGuides: vi.fn(),
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
  baseImage: null,
  imageFit: null,
  imageRect: { x: 4, y: 8, width: 96, height: 64 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [
    {
      contactPoint: { x: 0.5, y: 1 },
      poseId: 'pose-1',
      triggers: [STABLE_A],
      transform: { x: 12, y: -6, rotation: 15, scale: 1.2 },
      imageOverride: null,
    },
  ],
  transitionMs: 90,
  transitionEasing: 'linear',
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

  it('그룹 resize의 sprite는 활동 영역 박스만 커밋하고 imageRect·poses는 불변이다', async () => {
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

    // wire: 박스 필드만 setBounds op으로 실린다
    expect(mocks.commitMixedGesture).toHaveBeenCalledWith(
      pluginGestureIds[0],
      {
        opsVersion: EDITOR_OPS_VERSION,
        ops: [
          {
            kind: 'setBounds',
            elementType: 'sprite',
            id: STABLE_SPRITE,
            bounds: { dx: 10, dy: 20, width: 100, height: 60 },
          },
        ],
      },
      ['plugin-a'],
      expect.anything(),
    );
    // eager: 활동 영역만 바뀌고 요소 로컬 데이터는 참조까지 그대로다
    const eager = useSpriteStore.getState().positions['4key'][0];
    expect(eager).toMatchObject({ dx: 10, dy: 20, width: 100, height: 60 });
    expect(eager.imageRect).toBe(original.imageRect);
    expect(eager.pivot).toBe(original.pivot);
    expect(eager.poses).toBe(original.poses);
    expect(eager.idleTransform).toBe(original.idleTransform);
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
});
