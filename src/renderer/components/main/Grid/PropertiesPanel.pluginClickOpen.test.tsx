/**
 * 플러그인 요소 클릭/드래그와 사이드 패널 열림 계약 재현 테스트
 * 실제 PluginElementsRenderer(실 PluginElement) + 실제 PropertiesPanel 이펙트를
 * 함께 마운트해 선택 전이와 isCanvasPanelOpen을 관찰한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useLayerGroupStore } from '@stores/data/useLayerGroupStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { releaseDragSession } from '@hooks/Grid/dragSession';
import type {
  PluginDefinitionInternal,
  PluginDisplayElementInternal,
} from '@src/types/plugin/api';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 드래그 훅 내부 상태 추적용 프로브
const probe = vi.hoisted(() => ({
  wasMoved: false,
  recentPressMovedRef: null as { current: boolean } | null,
  pressMovedRef: null as { current: boolean } | null,
  movedDuringPressRef: null as { current: boolean } | null,
}));

vi.mock('@hooks/Grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hooks/Grid')>();
  return {
    ...actual,
    useDraggable: (
      options: Parameters<typeof actual.useDraggable>[0],
    ): ReturnType<typeof actual.useDraggable> => {
      const result = actual.useDraggable(options);
      probe.wasMoved = result.wasMoved;
      probe.recentPressMovedRef = result.recentPressMovedRef;
      return result;
    },
  };
});

vi.mock('@hooks/Grid/useSelectionDrag', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@hooks/Grid/useSelectionDrag')
  >();
  return {
    ...actual,
    useSelectionDrag: (
      options: Parameters<typeof actual.useSelectionDrag>[0],
    ): ReturnType<typeof actual.useSelectionDrag> => {
      const result = actual.useSelectionDrag(options);
      probe.pressMovedRef = result.pressMovedRef;
      probe.movedDuringPressRef = result.movedDuringPressRef;
      return result;
    },
  };
});

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: () => {} },
  }),
}));
vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  renameLayerGroupViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchGraphColorsViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchGraphPropertiesViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchGraphTypesViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchFontStyleViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchFontFamilyViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchStylePropertyViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchPaintViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchShadowViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchNotePaintViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchInactiveImageViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchSoundPathViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchSoundEnabledViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchSoundVolumeViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterEnabledViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterAnimationEnabledViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterAnimationPresetViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterLayoutViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterTypographyViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterStrokeViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchCounterFillViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchFontColorViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchKnobPropertiesViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchNativeLayerPropertyViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchNativeLayerBoundsViaAuthority: vi.fn(() => Promise.resolve(true)),
  commitBatchGeometryViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchNotePropertiesViaAuthority: vi.fn(() => Promise.resolve(true)),
  patchUseInlineStylesViaAuthority: vi.fn(() => Promise.resolve(true)),
  updatePluginElement: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  renameLayerGroupById: vi.fn(),
  commitElementGeometryById: vi.fn(),
  commitBatchGeometryByIds: vi.fn(),
  patchElementLayerNameById: vi.fn(),
  patchFontStyleById: vi.fn(),
  patchFontStyleByTargets: vi.fn(),
  patchFontFamilyById: vi.fn(),
  patchFontFamilyByTargets: vi.fn(),
  patchStylePropertyById: vi.fn(),
  patchPaintById: vi.fn(),
  patchShadowById: vi.fn(),
  patchNotePaintById: vi.fn(),
  patchInactiveImageById: vi.fn(),
  patchActiveImageById: vi.fn(),
  patchIdleTransparentById: vi.fn(),
  patchActiveTransparentById: vi.fn(),
  patchIdleImageFitById: vi.fn(),
  patchActiveImageFitById: vi.fn(),
  patchSoundPathById: vi.fn(),
  patchSoundEnabledById: vi.fn(),
  patchSoundVolumeById: vi.fn(),
  patchCounterEnabledById: vi.fn(),
  patchCounterAnimationEnabledById: vi.fn(),
  patchCounterLayoutById: vi.fn(),
  patchCounterTypographyById: vi.fn(),
  patchCounterStrokeById: vi.fn(),
  patchCounterStrokeByTargets: vi.fn(),
  patchCounterFillById: vi.fn(),
  patchFontColorById: vi.fn(),
  patchGraphColorById: vi.fn(),
  patchGraphColorsByIds: vi.fn(),
  patchGraphPropertiesByIds: vi.fn(),
  patchGraphPropertyById: vi.fn(),
  patchGraphTypeById: vi.fn(),
  patchGraphTypesByIds: vi.fn(),
  patchKnobPropertiesByIds: vi.fn(),
  patchKnobPropertyById: vi.fn(),
  patchNotePropertiesByIds: vi.fn(),
  patchNotePropertyById: vi.fn(),
  patchStatTypeById: vi.fn(),
  patchUseInlineStylesById: vi.fn(),
  patchUseInlineStylesByTargets: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpSkipped: vi.fn(),
  reportElementOpError: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/mixedBatchGeometry', () => ({
  commitMixedBatchGeometry: vi.fn(),
}));
vi.mock('@api/modules/itemsApi', () => ({
  graphItemsApi: { updatePositions: vi.fn(() => Promise.resolve()) },
  knobItemsApi: { updatePositions: vi.fn(() => Promise.resolve()) },
  layerGroupsApi: { update: vi.fn(() => Promise.resolve()) },
  statItemsApi: { updatePositions: vi.fn(() => Promise.resolve()) },
}));
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    activeGestureId: vi.fn(() => null),
    preview: vi.fn(),
    settleCommit: vi.fn(),
  },
}));
vi.mock('./PropertiesPanel/index', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const NullStub = () => null;
  return {
    TABS: { STYLE: 'style', NOTE: 'note', COUNTER: 'counter' },
    PropertyRow: Stub,
    PropertySection: Stub,
    NumberInput: NullStub,
    ColorInput: NullStub,
    TextInput: NullStub,
    LayerPanel: () => <div data-testid="layer-panel" />,
    PluginSelectionPanel: Stub,
    SingleGraphPanel: NullStub,
    SingleKnobPanel: NullStub,
    SingleKeyStatPanel: NullStub,
    BatchKeyLikePanel: NullStub,
    BatchGraphOnlyPanel: NullStub,
    BatchKnobOnlyPanel: NullStub,
    BatchPluginOnlyPanel: NullStub,
    PluginSettingsPanelView: NullStub,
    useBatchHandlers: () => ({
      handleBatchStyleChangeComplete: vi.fn(),
      handleBatchCounterUpdate: vi.fn(),
    }),
    usePanelScroll: () => ({
      batchScrollRefFor: () => vi.fn(),
      singleScrollRefFor: () => vi.fn(),
    }),
  };
});
vi.mock('./PropertiesPanel/PanelNavContext', () => ({
  PanelNavProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('./PropertiesPanel/PanelHeaderActions', () => ({
  default: () => null,
}));
vi.mock('./PropertiesPanel/PanelToggleButton', () => ({
  default: () => null,
}));
vi.mock('@components/main/common/Checkbox', () => ({ default: () => null }));
vi.mock('@components/main/common/Dropdown', () => ({ default: () => null }));

import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';
import PropertiesPanel from './PropertiesPanel';

const SIMPLE_DEF_ID = 'simple-plugin:badge';
const SIMPLE_FULL_ID = 'simple-plugin::11111111-1111-4111-8111-111111111111';
const KPS_DEF_ID = 'kps-plugin:meter';
const KPS_FULL_ID = 'kps-plugin::22222222-2222-4222-8222-222222222222';

// 설정 없는 단순형: name + template + contextMenu만
const simpleDefinition = {
  id: SIMPLE_DEF_ID,
  pluginId: 'simple-plugin',
  name: 'Badge',
  template: () => '<div>badge</div>',
} as unknown as PluginDefinitionInternal;

// 설정 + resizable형 (KPS류)
const kpsDefinition = {
  id: KPS_DEF_ID,
  pluginId: 'kps-plugin',
  name: 'Meter',
  resizable: true,
  settingsUI: 'panel',
  settings: {
    threshold: { type: 'number', label: 'threshold', default: 10 },
  },
  template: () => '<div>meter</div>',
} as unknown as PluginDefinitionInternal;

const makeElement = (
  fullId: string,
  definitionId: string,
): PluginDisplayElementInternal =>
  ({
    id: fullId.split('::')[1],
    fullId,
    pluginId: fullId.split('::')[0],
    definitionId,
    position: { x: 40, y: 40 },
    tabId: '4key',
    draggable: true,
    contextMenu: { enableDelete: true },
    measuredSize: { width: 120, height: 60 },
  } as unknown as PluginDisplayElementInternal);

interface Target {
  label: string;
  definition: PluginDefinitionInternal;
  fullId: string;
}

const TARGETS: Target[] = [
  { label: '단순형', definition: simpleDefinition, fullId: SIMPLE_FULL_ID },
  { label: 'resizable+설정형', definition: kpsDefinition, fullId: KPS_FULL_ID },
];

let container: HTMLDivElement;
let root: Root;
let rafCallbacks: Map<number, FrameRequestCallback>;
let nextRafId: number;

const flushRaf = () => {
  const callbacks = [...rafCallbacks.values()];
  rafCallbacks.clear();
  callbacks.forEach((callback) => callback(performance.now()));
};

const Harness = () => (
  <>
    <PluginElementsRenderer
      windowType="main"
      activeTool="select"
      positionOffset={{ x: 0, y: 0 }}
      onSelectionContextMenu={() => false}
      onMultiDrag={() => {}}
      onMultiDragStart={() => {}}
      onMultiDragEnd={() => {}}
    />
    <PropertiesPanel onKeyMappingChange={() => {}} />
  </>
);

const seedStores = (target: Target) => {
  useKeyStore.setState({
    selectedKeyType: '4key',
    keyMappings: { '4key': [] },
    positions: { '4key': [] },
    canonicalPositions: { '4key': [] },
  });
  useStatItemStore.setState({ positions: {} });
  useGraphItemStore.setState({ positions: {} });
  useKnobItemStore.setState({ positions: {} });
  useLayerGroupStore.setState({ layerGroups: {} });
  usePluginDisplayElementStore.setState({
    elements: [makeElement(target.fullId, target.definition.id)],
    panelElements: [],
    definitions: new Map([[target.definition.id, target.definition]]),
  } as never);
  useGridSelectionStore.setState({
    selectedElements: [],
    selectedGroupIds: [],
    lastSelectedKeyBounds: null,
    isDraggingOrResizing: false,
  });
  usePropertiesPanelStore.setState({
    isCanvasPanelOpen: false,
    canvasPanelMode: 'property',
    canvasPanelActiveTab: 'layer',
    propertyPanelActiveTab: 'style',
    pluginSettingsPanel: null,
  });
};

const mountHarness = (target: Target) => {
  seedStores(target);
  act(() => {
    root.render(<Harness />);
  });
  return container.querySelector(
    `[data-plugin-element="${target.fullId}"]`,
  ) as HTMLElement;
};

const node = (target: Target) =>
  container.querySelector(
    `[data-plugin-element="${target.fullId}"]`,
  ) as HTMLElement;

const firePointer = (
  el: HTMLElement,
  type: string,
  init: PointerEventInit = {},
) => {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        ...init,
      }),
    );
  });
};

const fireClick = (el: HTMLElement, init: MouseEventInit = {}) => {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      }),
    );
  });
};

// 정지 클릭: press-release-click (브라우저 시퀀스 재현)
const stationaryClick = (el: HTMLElement, at = { x: 100, y: 100 }) => {
  firePointer(el, 'pointerdown', { clientX: at.x, clientY: at.y });
  firePointer(el, 'pointerup', { clientX: at.x, clientY: at.y });
  fireClick(el, { clientX: at.x, clientY: at.y });
};

// 드래그: press-move-release + trailing click (브라우저 시퀀스 재현)
const dragRelease = (
  el: HTMLElement,
  from = { x: 100, y: 100 },
  to = { x: 130, y: 130 },
) => {
  firePointer(el, 'pointerdown', { clientX: from.x, clientY: from.y });
  firePointer(el, 'pointermove', { clientX: to.x, clientY: to.y });
  act(() => {
    flushRaf();
  });
  firePointer(el, 'pointerup', { clientX: to.x, clientY: to.y });
  fireClick(el, { clientX: to.x, clientY: to.y });
};

const selection = () => useGridSelectionStore.getState().selectedElements;
const panelOpen = () => usePropertiesPanelStore.getState().isCanvasPanelOpen;

beforeEach(() => {
  (window as unknown as { api: unknown }).api = {
    bridge: { on: () => () => {} },
  };
  rafCallbacks = new Map();
  nextRafId = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = nextRafId++;
    rafCallbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    rafCallbacks.delete(id);
  });
  releaseDragSession();
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe.each(TARGETS)('플러그인 요소 패널 열림 계약 ($label)', (target) => {
  it('(a) 비선택 클릭은 선택하고 패널을 연다 (0→1)', () => {
    const el = mountHarness(target);

    stationaryClick(el);

    expect(selection()).toEqual([{ type: 'plugin', id: target.fullId }]);
    expect(panelOpen()).toBe(true);
    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('property');
    expect(probe.wasMoved).toBe(false);
    expect(probe.pressMovedRef?.current).toBe(false);
  });

  it('(b) 선택 상태 재클릭은 흡수된다 (선택·패널 불변)', () => {
    const el = mountHarness(target);
    stationaryClick(el);
    const selected = selection();

    stationaryClick(node(target));

    expect(selection()).toBe(selected);
    expect(panelOpen()).toBe(true);
  });

  it('(b2) 수동 닫힘 후 선택 요소 재클릭은 패널을 다시 열지 않는다 (sticky)', () => {
    const el = mountHarness(target);
    stationaryClick(el);
    expect(panelOpen()).toBe(true);

    // 토글 버튼으로 수동 닫기
    act(() => {
      usePropertiesPanelStore.getState().requestCanvasPanelToggle();
    });
    expect(panelOpen()).toBe(false);

    stationaryClick(node(target));

    expect(selection()).toEqual([{ type: 'plugin', id: target.fullId }]);
    expect(panelOpen()).toBe(false);
  });

  it('(c) 비선택 드래그의 trailing click은 삼켜진다 (선택 없음·패널 닫힘)', () => {
    const el = mountHarness(target);

    dragRelease(el);

    // 개별 드래그 커밋만 발생, 선택·패널은 그대로
    const element = usePluginDisplayElementStore
      .getState()
      .elements.find((item) => item.fullId === target.fullId);
    expect(element?.position).toEqual({ x: 70, y: 70 });
    expect(selection()).toEqual([]);
    expect(panelOpen()).toBe(false);
    expect(probe.wasMoved).toBe(true);
  });

  it('(d) 선택 상태 드래그의 trailing click도 흡수되고 선택·패널이 유지된다', () => {
    const el = mountHarness(target);
    stationaryClick(el);
    expect(panelOpen()).toBe(true);
    const selected = selection();

    dragRelease(node(target));

    expect(selection()).toBe(selected);
    expect(panelOpen()).toBe(true);
    expect(probe.pressMovedRef?.current).toBe(true);
  });

  it('(d2) 수동 닫힘 상태의 선택 드래그는 패널을 다시 열지 않는다', () => {
    const el = mountHarness(target);
    stationaryClick(el);
    act(() => {
      usePropertiesPanelStore.getState().requestCanvasPanelToggle();
    });
    expect(panelOpen()).toBe(false);

    dragRelease(node(target));

    expect(selection()).toEqual([{ type: 'plugin', id: target.fullId }]);
    expect(panelOpen()).toBe(false);
  });

  it('(e) 레이어 뷰가 열린 상태의 클릭은 선택만 하고 페이지는 레이어에 머문다 (sticky page)', () => {
    const el = mountHarness(target);
    act(() => {
      usePropertiesPanelStore.setState({
        isCanvasPanelOpen: true,
        canvasPanelMode: 'layer',
      });
    });

    stationaryClick(el);

    expect(selection()).toEqual([{ type: 'plugin', id: target.fullId }]);
    expect(panelOpen()).toBe(true);
    // 편집(property) 진입은 더블클릭·헤더 토글만 수행 - 클릭은 선택만
    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('layer');
  });

  it('(f) 수동 닫힘은 선택 전환(1→1)에도 유지되고, 전체 해제 후 재선택(0→1)에서 풀린다', () => {
    const el = mountHarness(target);
    stationaryClick(el);
    act(() => {
      usePropertiesPanelStore.getState().requestCanvasPanelToggle();
    });
    expect(panelOpen()).toBe(false);

    // 다른 요소 선택 (1→1) - manuallyClosed 유지로 열리지 않음
    act(() => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: 'other-key', index: 0 }]);
    });
    expect(panelOpen()).toBe(false);

    // 전체 해제 후 재선택 (0→1) - manuallyClosed 해제, 다시 열림
    act(() => {
      useGridSelectionStore.getState().clearSelection();
    });
    expect(panelOpen()).toBe(false);
    stationaryClick(node(target));
    expect(selection()).toEqual([{ type: 'plugin', id: target.fullId }]);
    expect(panelOpen()).toBe(true);
  });

  it('(g) 마퀴 결과와 동일한 선택 주입(0→1)은 패널을 연다 (드래그 라쏘 경로)', () => {
    mountHarness(target);
    expect(panelOpen()).toBe(false);

    // Grid 마퀴 정산(useGridMarquee:213)과 동일한 스토어 호출
    act(() => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'plugin', id: target.fullId }]);
    });

    expect(panelOpen()).toBe(true);
    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('property');
  });
});
