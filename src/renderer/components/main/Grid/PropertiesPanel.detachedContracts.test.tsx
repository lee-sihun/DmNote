import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';
import { useKeySlotCapture } from '@hooks/useKeySlotCapture';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  batchKeyLikePropsMock,
  batchPropsMock,
  previewMock,
  settleCommitMock,
  singleKeyStatPropsMock,
} = vi.hoisted(() => ({
  batchKeyLikePropsMock: vi.fn(),
  batchPropsMock: vi.fn(),
  previewMock: vi.fn(),
  settleCommitMock: vi.fn(),
  singleKeyStatPropsMock: vi.fn(),
}));

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko' },
  }),
}));
vi.mock('@hooks/useLenis', () => ({
  useLenis: () => ({ scrollContainerRef: vi.fn() }),
}));
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  updatePluginElement: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    preview: previewMock,
    settleCommit: settleCommitMock,
  },
}));
vi.mock('./PropertiesPanel/index', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const SingleKeyStatPanel = (props: Record<string, unknown>) => {
    singleKeyStatPropsMock(props);
    return <div />;
  };
  return {
    TABS: { STYLE: 'style', NOTE: 'note', COUNTER: 'counter' },
    PropertyRow: Stub,
    PropertySection: Stub,
    NumberInput: Stub,
    ColorInput: Stub,
    TextInput: Stub,
    LayerPanel: () => <div data-testid="layer-panel" />,
    PluginSelectionPanel: Stub,
    SingleGraphPanel: Stub,
    SingleKnobPanel: Stub,
    SingleKeyStatPanel,
    BatchKeyLikePanel: (props: Record<string, unknown>) => {
      batchKeyLikePropsMock(props);
      return <div />;
    },
    BatchGraphOnlyPanel: Stub,
    BatchKnobOnlyPanel: Stub,
    PluginSettingsPanelView: Stub,
    useBatchHandlers: (props: Record<string, unknown>) => {
      batchPropsMock(props);
      return {};
    },
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
  default: ({ mode }: { mode: string }) => <div data-mode={mode} />,
}));
vi.mock('./PropertiesPanel/PanelToggleButton', () => ({
  default: () => <button>toggle</button>,
}));
vi.mock('@components/main/common/Checkbox', () => ({ default: () => null }));
vi.mock('@components/main/common/Dropdown', () => ({ default: () => null }));

import PropertiesPanel from './PropertiesPanel';

interface MountedPanel {
  container: HTMLDivElement;
  root: Root;
  render: (selectionSyncReady: boolean) => void;
}

const mountPanel = (
  selectionSyncReady: boolean,
  onKeyMappingChange: (index: number, newKey: string) => void = vi.fn(),
): MountedPanel => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (ready: boolean) => {
    act(() => {
      root.render(
        <PropertiesPanel
          onPositionChange={vi.fn()}
          onKeyUpdate={vi.fn()}
          onKeyMappingChange={onKeyMappingChange}
          frameVariant="window"
          selectionSyncReady={ready}
        />,
      );
    });
  };
  render(selectionSyncReady);
  return { container, root, render };
};

const resetStores = () => {
  previewMock.mockClear();
  settleCommitMock.mockClear();
  singleKeyStatPropsMock.mockClear();
  batchPropsMock.mockClear();
  batchKeyLikePropsMock.mockClear();
  useKeyStore.setState({
    selectedKeyType: '4key',
    keyMappings: { '4key': [] },
    positions: { '4key': [] },
    canonicalPositions: { '4key': [] },
  });
  useStatItemStore.setState({
    positions: {
      '4key': [
        {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          statType: 'kps',
        } as never,
      ],
    },
  });
  useGraphItemStore.setState({
    positions: {
      '4key': [
        {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          statType: 'kps',
          graphType: 'line',
          graphSpeed: 1,
          graphColor: '#ffffff',
        } as never,
      ],
    },
  });
  useKnobItemStore.setState({
    positions: {
      '4key': [
        {
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          axisId: 'HIDA:test',
          sensitivity: 1,
          reverse: false,
        } as never,
      ],
    },
  });
  usePropertiesPanelStore.setState({
    canvasPanelMode: 'property',
    canvasPanelActiveTab: 'layer',
    propertyPanelActiveTab: 'style',
    isCanvasPanelOpen: true,
    pluginSettingsPanel: null,
  });
  useGridSelectionStore.setState({
    selectedElements: [],
    selectedGroupIds: [],
    _skipPanelModeSwitch: false,
  });
};

describe('PropertiesPanel detached preview contract', () => {
  let mounted: MountedPanel;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  });

  it('single stat preview는 canonical 변경 없이 stat 도메인으로 전달', () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id: 'stat-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);

    const singleKeyStatProps = singleKeyStatPropsMock.mock.lastCall?.[0] as
      | Record<string, unknown>
      | undefined;
    const handleStatPreview = singleKeyStatProps?.handleStatPreview as (
      index: number,
      patch: Record<string, unknown>,
    ) => void;
    act(() => handleStatPreview(0, { width: 96 }));

    expect(previewMock).toHaveBeenCalledWith(
      '4key',
      [{ index: 0, patch: { width: 96 } }],
      { domain: 'statPosition' },
    );
    expect(useStatItemStore.getState().positions['4key'][0].width).toBe(60);
  });

  it('batch stat, graph, knob preview를 각각의 도메인으로 전달', () => {
    mounted = mountPanel(true);
    const batchProps = batchPropsMock.mock.lastCall?.[0] as {
      onStatBatchPreview: (updates: Array<Record<string, unknown>>) => void;
      onGraphBatchPreview: (updates: Array<Record<string, unknown>>) => void;
      onKnobBatchPreview: (updates: Array<Record<string, unknown>>) => void;
    };

    act(() => {
      batchProps.onStatBatchPreview([{ index: 0, width: 91 }]);
      batchProps.onGraphBatchPreview([{ index: 0, width: 92 }]);
      batchProps.onKnobBatchPreview([{ index: 0, width: 93 }]);
    });

    expect(previewMock.mock.calls).toEqual([
      [
        '4key',
        [{ index: 0, patch: { width: 91 } }],
        { domain: 'statPosition' },
      ],
      [
        '4key',
        [{ index: 0, patch: { width: 92 } }],
        { domain: 'graphPosition' },
      ],
      [
        '4key',
        [{ index: 0, patch: { width: 93 } }],
        { domain: 'knobPosition' },
      ],
    ]);
  });
});

// 배치 색상 draft는 피커를 열 때 첫 요소에서 한 번만 떠 온다.
// 그 상태가 편집 트리 바깥(PropertiesPanel)에 있어 리마운트 경계로는 안 걷힌다
describe('PropertiesPanel 배치 색상 피커 대상 결합', () => {
  let mounted: MountedPanel;

  const selectKeys = (...indices: number[]) => {
    useGridSelectionStore.setState({
      selectedElements: indices.map((index) => ({
        type: 'key' as const,
        id: `key-${index}`,
        index,
      })),
      selectedGroupIds: [],
    });
  };

  const latestBatchProps = () =>
    batchKeyLikePropsMock.mock.lastCall?.[0] as {
      batchPickerFor: string | null;
      handleBatchPickerToggle: (target: string) => void;
    };

  beforeEach(() => {
    resetStores();
    useKeyStore.setState({
      selectedKeyType: '4key',
      keyMappings: { '4key': ['KeyA', 'KeyS', 'KeyD'] as never },
      positions: {
        '4key': [
          { dx: 0, dy: 0, width: 60, height: 60 },
          { dx: 0, dy: 0, width: 60, height: 60 },
          { dx: 0, dy: 0, width: 60, height: 60 },
        ] as never,
      },
    });
    selectKeys(0, 1, 2);
    mounted = mountPanel(true);
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  });

  it('선택이 바뀌면 열려 있던 배치 색상 피커를 닫는다', () => {
    act(() => latestBatchProps().handleBatchPickerToggle('noteColor'));
    expect(latestBatchProps().batchPickerFor).toBe('noteColor');

    act(() => selectKeys(0, 1));

    expect(latestBatchProps().batchPickerFor).toBeNull();
  });

  // 선택을 건드리지 않는 재렌더까지 닫으면 피커를 쓸 수가 없다.
  // 기존 이미지 피커 3종과 같은 조건(선택 store 갱신)에만 반응해야 한다
  it('선택을 건드리지 않는 재렌더는 피커를 닫지 않는다', () => {
    act(() => latestBatchProps().handleBatchPickerToggle('noteColor'));

    act(() => mounted.render(true));

    expect(latestBatchProps().batchPickerFor).toBe('noteColor');
  });
});

describe('PropertiesPanel detached selection sync contract', () => {
  let mounted: MountedPanel;

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  });

  it('late empty sync normalizes a fail-open property handoff to layer', () => {
    mounted = mountPanel(false);
    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('property');
    expect(
      mounted.container.querySelector('[data-testid="layer-panel"]'),
    ).not.toBeNull();

    mounted.render(true);

    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('layer');
  });

  it('normalizes an empty ready snapshot to layer immediately', () => {
    mounted = mountPanel(true);
    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('layer');
  });

  it('동기화 전 graph 렌더가 뒤늦게 key 탭을 덮지 않는다', () => {
    usePropertiesPanelStore.setState({ propertyPanelActiveTab: 'counter' });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id: 'graph-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(false);
    expect(usePropertiesPanelStore.getState().propertyPanelActiveTab).toBe(
      'counter',
    );

    act(() => {
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id: 'key-0', index: 0 }],
        selectedGroupIds: [],
      });
    });
    mounted.render(true);

    expect(usePropertiesPanelStore.getState().propertyPanelActiveTab).toBe(
      'counter',
    );
  });

  it('동기화 뒤에도 graph 선택이면 style로 정규화한다', () => {
    usePropertiesPanelStore.setState({ propertyPanelActiveTab: 'counter' });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id: 'graph-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(false);

    mounted.render(true);

    expect(usePropertiesPanelStore.getState().propertyPanelActiveTab).toBe(
      'style',
    );
  });

  it.each(['property', 'layer'] as const)(
    'preserves a delayed selected %s handoff',
    (mode) => {
      usePropertiesPanelStore.setState({ canvasPanelMode: mode });
      mounted = mountPanel(false);
      act(() => {
        useGridSelectionStore.setState({
          selectedElements: [{ type: 'plugin', id: 'missing-plugin' }],
          selectedGroupIds: [],
        });
      });

      mounted.render(true);

      expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe(mode);
    },
  );

  it('keeps layer sticky when selection arrives after an empty snapshot', () => {
    mounted = mountPanel(true);
    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('layer');

    act(() => {
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'plugin', id: 'missing-plugin' }],
        selectedGroupIds: [],
      });
    });

    expect(usePropertiesPanelStore.getState().canvasPanelMode).toBe('layer');
  });
});

describe('PropertiesPanel plugin settings Escape contract', () => {
  let mounted: MountedPanel;
  let onCancel: ReturnType<typeof vi.fn>;
  let resolve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    onCancel = vi.fn();
    resolve = vi.fn();
    usePropertiesPanelStore.setState({
      pluginSettingsPanel: {
        pluginId: 'escape-test',
        definition: { settings: {} },
        settings: { memo: 'draft' },
        originalSettings: { memo: 'original' },
        onChange: vi.fn(),
        onConfirm: vi.fn(),
        onCancel,
        resolve,
      } as never,
    });
    mounted = mountPanel(true);
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
    document
      .querySelectorAll('[data-dmn-modal-backdrop], [data-dmn-popup-layer]')
      .forEach((node) => node.remove());
  });

  it('cancels the session exactly once from an unowned Escape', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    act(() => document.body.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith({ memo: 'original' });
    expect(resolve).toHaveBeenCalledWith(false);
    expect(usePropertiesPanelStore.getState().pluginSettingsPanel).toBeNull();
  });

  it('yields Escape to a focused editor control', () => {
    const input = document.createElement('input');
    mounted.container.append(input);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it.each([
    ['modal', 'data-dmn-modal-backdrop'],
    ['popup', 'data-dmn-popup-layer'],
  ] as const)('yields Escape to a higher %s layer', (_label, attribute) => {
    const layer = document.createElement('div');
    layer.setAttribute(attribute, 'true');
    document.body.append(layer);

    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('yields an already consumed Escape', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    act(() => document.body.dispatchEvent(event));

    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe('useKeySlotCapture listening contract', () => {
  let originalApi: typeof window.api;
  let rawListener: ((payload: Record<string, unknown>) => void) | null;
  let rawUnsubscribe: ReturnType<typeof vi.fn>;
  let onCapture: ReturnType<
    typeof vi.fn<(globalKey: string, listenIndex: number | null) => void>
  >;
  let harness: { root: Root; container: HTMLDivElement };
  let latest: {
    isListening: boolean;
    startListen: (index: number | null) => void;
  } | null;

  const CaptureHarness = () => {
    // 캡처 훅 상태를 테스트에서 관찰하기 위한 최소 하네스
    const capture = useKeySlotCapture({ onCapture, escapeCancels: true });
    React.useEffect(() => {
      latest = capture;
    });
    return null;
  };

  const startListening = () => {
    act(() => latest?.startListen(null));
    expect(latest?.isListening).toBe(true);
  };

  beforeEach(() => {
    rawListener = null;
    rawUnsubscribe = vi.fn();
    onCapture =
      vi.fn<(globalKey: string, listenIndex: number | null) => void>();
    originalApi = window.api;
    window.api = {
      ...originalApi,
      keys: {
        ...originalApi?.keys,
        onRawInput: vi.fn((listener) => {
          rawListener = listener as (payload: Record<string, unknown>) => void;
          return rawUnsubscribe;
        }),
      },
    } as typeof window.api;

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<CaptureHarness />));
    harness = { root, container };
  });

  afterEach(() => {
    act(() => harness.root.unmount());
    harness.container.remove();
    window.api = originalApi;
    latest = null;
  });

  it('plain Escape cancels listening without capturing', () => {
    startListening();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onCapture).not.toHaveBeenCalled();
    expect(latest?.isListening).toBe(false);
    expect(rawUnsubscribe).toHaveBeenCalledOnce();
  });

  it('raw Escape cancels listening without assigning Escape', () => {
    startListening();

    act(() =>
      rawListener?.({
        label: 'ESCAPE',
        labels: ['ESCAPE'],
        state: 'DOWN',
        device: 'keyboard',
      }),
    );

    expect(onCapture).not.toHaveBeenCalled();
    expect(latest?.isListening).toBe(false);
  });

  it('captures one normal raw key and stops listening', () => {
    startListening();

    act(() =>
      rawListener?.({
        label: 'A',
        labels: ['A'],
        state: 'DOWN',
        device: 'keyboard',
      }),
    );

    expect(onCapture).toHaveBeenCalledOnce();
    expect(onCapture).toHaveBeenCalledWith('A', null);
    expect(latest?.isListening).toBe(false);
  });

  it('captures into a replace target index', () => {
    act(() => latest?.startListen(1));
    expect(latest?.isListening).toBe(true);

    act(() =>
      rawListener?.({
        label: 'B',
        labels: ['B'],
        state: 'DOWN',
        device: 'keyboard',
      }),
    );

    expect(onCapture).toHaveBeenCalledWith('B', 1);
    expect(latest?.isListening).toBe(false);
  });
});
