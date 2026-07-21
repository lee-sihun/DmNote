import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePropertiesPanelStore } from '@stores/grid/usePropertiesPanelStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  batchPropsMock,
  previewMock,
  settleCommitMock,
  singleKeyStatPropsMock,
} = vi.hoisted(() => ({
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
    BatchKeyLikePanel: Stub,
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

describe('PropertiesPanel key mapping listening contract', () => {
  let mounted: MountedPanel;
  let originalApi: typeof window.api;
  let rawListener: ((payload: Record<string, unknown>) => void) | null;
  let rawUnsubscribe: ReturnType<typeof vi.fn>;
  let onKeyMappingChange: ReturnType<
    typeof vi.fn<(index: number, newKey: string) => void>
  >;

  const startListening = () => {
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleKeyListen: () => void;
    };
    act(() => props.handleKeyListen());
    expect(
      (singleKeyStatPropsMock.mock.lastCall?.[0] as { isListening: boolean })
        .isListening,
    ).toBe(true);
  };

  beforeEach(() => {
    resetStores();
    rawListener = null;
    rawUnsubscribe = vi.fn();
    onKeyMappingChange = vi.fn<(index: number, newKey: string) => void>();
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

    const position = {
      dx: 0,
      dy: 0,
      width: 60,
      height: 60,
    } as never;
    useKeyStore.setState({
      keyMappings: { '4key': ['Z'] },
      positions: { '4key': [position] },
      canonicalPositions: { '4key': [position] },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true, onKeyMappingChange);
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
    window.api = originalApi;
  });

  it('plain Escape cancels listening without changing the mapping', () => {
    startListening();
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onKeyMappingChange).not.toHaveBeenCalled();
    expect(
      (singleKeyStatPropsMock.mock.lastCall?.[0] as { isListening: boolean })
        .isListening,
    ).toBe(false);
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

    expect(onKeyMappingChange).not.toHaveBeenCalled();
    expect(
      (singleKeyStatPropsMock.mock.lastCall?.[0] as { isListening: boolean })
        .isListening,
    ).toBe(false);
  });

  it('assigns one normal raw key and stops listening', () => {
    startListening();

    act(() =>
      rawListener?.({
        label: 'A',
        labels: ['A'],
        state: 'DOWN',
        device: 'keyboard',
      }),
    );

    expect(onKeyMappingChange).toHaveBeenCalledOnce();
    expect(onKeyMappingChange).toHaveBeenCalledWith(0, 'A');
    expect(
      (singleKeyStatPropsMock.mock.lastCall?.[0] as { isListening: boolean })
        .isListening,
    ).toBe(false);
  });
});
