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
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const {
  batchKeyLikePropsMock,
  batchGraphPropsMock,
  batchKnobPropsMock,
  batchPropsMock,
  graphUpdatePositionsMock,
  knobUpdatePositionsMock,
  keyLegacyUpdateMock,
  legacyBatchStyleCommitMock,
  patchGraphColorMock,
  patchGraphColorsMock,
  patchGraphColorsViaAuthorityMock,
  patchGraphPropertiesMock,
  patchGraphPropertiesViaAuthorityMock,
  patchGraphTypeMock,
  patchGraphTypesMock,
  patchGraphTypesViaAuthorityMock,
  patchFontStyleMock,
  patchFontStyleTargetsMock,
  patchFontStyleViaAuthorityMock,
  patchFontFamilyMock,
  patchFontFamilyTargetsMock,
  patchFontFamilyViaAuthorityMock,
  patchInactiveImageMock,
  patchInactiveImageViaAuthorityMock,
  patchActiveImageMock,
  patchSoundPathMock,
  patchSoundPathViaAuthorityMock,
  patchSoundEnabledMock,
  patchSoundEnabledViaAuthorityMock,
  patchCounterEnabledMock,
  patchCounterAnimationEnabledMock,
  patchCounterEnabledViaAuthorityMock,
  patchCounterAnimationEnabledViaAuthorityMock,
  patchCounterLayoutMock,
  patchCounterLayoutViaAuthorityMock,
  patchKnobPropertiesMock,
  patchKnobPropertiesViaAuthorityMock,
  patchKnobPropertyMock,
  patchNotePropertyMock,
  patchStatTypeMock,
  patchNotePropertiesMock,
  patchNotePropertiesViaAuthorityMock,
  patchUseInlineStylesMock,
  patchUseInlineStylesTargetsMock,
  patchUseInlineStylesViaAuthorityMock,
  previewMock,
  patchLayerNameMock,
  patchPropertyViaAuthorityMock,
  patchBoundsViaAuthorityMock,
  patchBatchGeometryViaAuthorityMock,
  patchBatchGeometryMock,
  patchGeometryMock,
  statUpdatePositionsMock,
  settleCommitMock,
  activeGestureIdMock,
  singleGraphPropsMock,
  singleKeyStatPropsMock,
  singleKnobPropsMock,
} = vi.hoisted(() => ({
  batchKeyLikePropsMock: vi.fn(),
  batchGraphPropsMock: vi.fn(),
  batchKnobPropsMock: vi.fn(),
  batchPropsMock: vi.fn(),
  graphUpdatePositionsMock: vi.fn(() => Promise.resolve()),
  knobUpdatePositionsMock: vi.fn(() => Promise.resolve()),
  keyLegacyUpdateMock: vi.fn(),
  legacyBatchStyleCommitMock: vi.fn(),
  patchGraphColorMock: vi.fn(() => Promise.resolve(true)),
  patchGraphColorsMock: vi.fn(() => Promise.resolve(true)),
  patchGraphColorsViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchGraphPropertiesMock: vi.fn(() => Promise.resolve(true)),
  patchGraphPropertiesViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchGraphTypeMock: vi.fn(() => Promise.resolve(true)),
  patchGraphTypesMock: vi.fn(() => Promise.resolve(true)),
  patchGraphTypesViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchFontStyleMock: vi.fn(() => Promise.resolve(true)),
  patchFontStyleTargetsMock: vi.fn(() => Promise.resolve(true)),
  patchFontStyleViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchFontFamilyMock: vi.fn(() => Promise.resolve(true)),
  patchFontFamilyTargetsMock: vi.fn(() => Promise.resolve(true)),
  patchFontFamilyViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchInactiveImageMock: vi.fn(() => Promise.resolve(true)),
  patchInactiveImageViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchActiveImageMock: vi.fn(() => Promise.resolve(true)),
  patchSoundPathMock: vi.fn(() => Promise.resolve(true)),
  patchSoundPathViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchSoundEnabledMock: vi.fn(() => Promise.resolve(true)),
  patchSoundEnabledViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchCounterEnabledMock: vi.fn(() => Promise.resolve(true)),
  patchCounterAnimationEnabledMock: vi.fn(() => Promise.resolve(true)),
  patchCounterEnabledViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchCounterAnimationEnabledViaAuthorityMock: vi.fn(() =>
    Promise.resolve(true),
  ),
  patchCounterLayoutMock: vi.fn(() => Promise.resolve(true)),
  patchCounterLayoutViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchKnobPropertiesMock: vi.fn(() => Promise.resolve(true)),
  patchKnobPropertiesViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchKnobPropertyMock: vi.fn(() => Promise.resolve(true)),
  patchNotePropertyMock: vi.fn(() => Promise.resolve(true)),
  patchStatTypeMock: vi.fn(() => Promise.resolve(true)),
  patchNotePropertiesMock: vi.fn(() => Promise.resolve(true)),
  patchNotePropertiesViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchUseInlineStylesMock: vi.fn(() => Promise.resolve(true)),
  patchUseInlineStylesTargetsMock: vi.fn(() => Promise.resolve(true)),
  patchUseInlineStylesViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  previewMock: vi.fn(),
  patchLayerNameMock: vi.fn(() => Promise.resolve(true)),
  patchPropertyViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchBoundsViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchBatchGeometryViaAuthorityMock: vi.fn(() => Promise.resolve(true)),
  patchBatchGeometryMock: vi.fn(() => Promise.resolve(true)),
  patchGeometryMock: vi.fn(() => Promise.resolve(true)),
  statUpdatePositionsMock: vi.fn(() => Promise.resolve()),
  settleCommitMock: vi.fn(),
  activeGestureIdMock: vi.fn(() => null as string | null),
  singleGraphPropsMock: vi.fn(),
  singleKeyStatPropsMock: vi.fn(),
  singleKnobPropsMock: vi.fn(),
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
  patchGraphColorsViaAuthority: patchGraphColorsViaAuthorityMock,
  patchGraphPropertiesViaAuthority: patchGraphPropertiesViaAuthorityMock,
  patchGraphTypesViaAuthority: patchGraphTypesViaAuthorityMock,
  patchFontStyleViaAuthority: patchFontStyleViaAuthorityMock,
  patchFontFamilyViaAuthority: patchFontFamilyViaAuthorityMock,
  patchInactiveImageViaAuthority: patchInactiveImageViaAuthorityMock,
  patchSoundPathViaAuthority: patchSoundPathViaAuthorityMock,
  patchSoundEnabledViaAuthority: patchSoundEnabledViaAuthorityMock,
  patchCounterEnabledViaAuthority: patchCounterEnabledViaAuthorityMock,
  patchCounterAnimationEnabledViaAuthority:
    patchCounterAnimationEnabledViaAuthorityMock,
  patchCounterLayoutViaAuthority: patchCounterLayoutViaAuthorityMock,
  patchKnobPropertiesViaAuthority: patchKnobPropertiesViaAuthorityMock,
  patchNativeLayerPropertyViaAuthority: patchPropertyViaAuthorityMock,
  patchNativeLayerBoundsViaAuthority: patchBoundsViaAuthorityMock,
  commitBatchGeometryViaAuthority: patchBatchGeometryViaAuthorityMock,
  patchNotePropertiesViaAuthority: patchNotePropertiesViaAuthorityMock,
  patchUseInlineStylesViaAuthority: patchUseInlineStylesViaAuthorityMock,
  updatePluginElement: vi.fn(),
}));
vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  commitElementGeometryById: patchGeometryMock,
  commitBatchGeometryByIds: patchBatchGeometryMock,
  patchElementLayerNameById: patchLayerNameMock,
  patchFontStyleById: patchFontStyleMock,
  patchFontStyleByTargets: patchFontStyleTargetsMock,
  patchFontFamilyById: patchFontFamilyMock,
  patchFontFamilyByTargets: patchFontFamilyTargetsMock,
  patchInactiveImageById: patchInactiveImageMock,
  patchActiveImageById: patchActiveImageMock,
  patchSoundPathById: patchSoundPathMock,
  patchSoundEnabledById: patchSoundEnabledMock,
  patchCounterEnabledById: patchCounterEnabledMock,
  patchCounterAnimationEnabledById: patchCounterAnimationEnabledMock,
  patchCounterLayoutById: patchCounterLayoutMock,
  patchGraphColorById: patchGraphColorMock,
  patchGraphColorsByIds: patchGraphColorsMock,
  patchGraphPropertiesByIds: patchGraphPropertiesMock,
  patchGraphPropertyById: patchGraphPropertiesMock,
  patchGraphTypeById: patchGraphTypeMock,
  patchGraphTypesByIds: patchGraphTypesMock,
  patchKnobPropertiesByIds: patchKnobPropertiesMock,
  patchKnobPropertyById: patchKnobPropertyMock,
  patchNotePropertiesByIds: patchNotePropertiesMock,
  patchNotePropertyById: patchNotePropertyMock,
  patchStatTypeById: patchStatTypeMock,
  patchUseInlineStylesById: patchUseInlineStylesMock,
  patchUseInlineStylesByTargets: patchUseInlineStylesTargetsMock,
}));
vi.mock('@api/modules/itemsApi', () => ({
  graphItemsApi: { updatePositions: graphUpdatePositionsMock },
  knobItemsApi: { updatePositions: knobUpdatePositionsMock },
  layerGroupsApi: { update: vi.fn(() => Promise.resolve()) },
  statItemsApi: { updatePositions: statUpdatePositionsMock },
}));
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    activeGestureId: activeGestureIdMock,
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
    return <ScopeProbe id="single-key-stat" />;
  };
  const SingleGraphPanel = (props: Record<string, unknown>) => {
    singleGraphPropsMock(props);
    return <div />;
  };
  const SingleKnobPanel = (props: Record<string, unknown>) => {
    singleKnobPropsMock(props);
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
    SingleGraphPanel,
    SingleKnobPanel,
    SingleKeyStatPanel,
    BatchKeyLikePanel: (props: Record<string, unknown>) => {
      batchKeyLikePropsMock(props);
      return <div />;
    },
    BatchGraphOnlyPanel: (props: Record<string, unknown>) => {
      batchGraphPropsMock(props);
      return <div />;
    },
    BatchKnobOnlyPanel: (props: Record<string, unknown>) => {
      batchKnobPropsMock(props);
      return <div />;
    },
    PluginSettingsPanelView: () => <ScopeProbe id="plugin-settings" />,
    useBatchHandlers: (props: Record<string, unknown>) => {
      batchPropsMock(props);
      return {
        handleBatchStyleChangeComplete: legacyBatchStyleCommitMock,
      };
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

import { useIsEditSessionScoped } from '@src/renderer/contexts/EditSessionScope';

import PropertiesPanel from './PropertiesPanel';

// 대상 전환 억제는 캔버스 선택 패널 안에서만 걸려야 한다
const ScopeProbe = ({ id }: { id: string }) => (
  <div data-testid={id} data-scoped={String(useIsEditSessionScoped())} />
);

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
          onKeyUpdate={keyLegacyUpdateMock}
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
  activeGestureIdMock.mockReset();
  activeGestureIdMock.mockReturnValue(null);
  singleKeyStatPropsMock.mockClear();
  singleGraphPropsMock.mockClear();
  batchGraphPropsMock.mockClear();
  batchKnobPropsMock.mockClear();
  batchPropsMock.mockClear();
  batchKeyLikePropsMock.mockClear();
  patchLayerNameMock.mockClear();
  patchGraphTypeMock.mockClear();
  patchGraphColorMock.mockClear();
  patchGraphColorsMock.mockClear();
  patchGraphColorsViaAuthorityMock.mockClear();
  patchGraphPropertiesMock.mockClear();
  patchGraphPropertiesViaAuthorityMock.mockClear();
  patchGraphTypesMock.mockClear();
  patchGraphTypesViaAuthorityMock.mockClear();
  patchFontStyleMock.mockClear();
  patchFontStyleTargetsMock.mockClear();
  patchFontStyleViaAuthorityMock.mockClear();
  patchFontFamilyMock.mockClear();
  patchFontFamilyTargetsMock.mockClear();
  patchFontFamilyViaAuthorityMock.mockClear();
  patchInactiveImageMock.mockClear();
  patchInactiveImageViaAuthorityMock.mockClear();
  patchActiveImageMock.mockClear();
  patchSoundPathMock.mockClear();
  patchSoundPathViaAuthorityMock.mockClear();
  patchSoundEnabledMock.mockClear();
  patchSoundEnabledViaAuthorityMock.mockClear();
  patchCounterEnabledMock.mockClear();
  patchCounterAnimationEnabledMock.mockClear();
  patchCounterEnabledViaAuthorityMock.mockClear();
  patchCounterAnimationEnabledViaAuthorityMock.mockClear();
  patchCounterLayoutMock.mockClear();
  patchCounterLayoutViaAuthorityMock.mockClear();
  patchKnobPropertiesMock.mockClear();
  patchKnobPropertiesViaAuthorityMock.mockClear();
  patchKnobPropertyMock.mockClear();
  patchNotePropertyMock.mockClear();
  patchStatTypeMock.mockClear();
  patchNotePropertiesMock.mockClear();
  patchNotePropertiesViaAuthorityMock.mockClear();
  patchUseInlineStylesMock.mockClear();
  patchUseInlineStylesTargetsMock.mockClear();
  patchUseInlineStylesViaAuthorityMock.mockClear();
  patchPropertyViaAuthorityMock.mockClear();
  patchBoundsViaAuthorityMock.mockClear();
  patchBatchGeometryViaAuthorityMock.mockClear();
  patchBatchGeometryMock.mockClear();
  patchGeometryMock.mockClear();
  graphUpdatePositionsMock.mockClear();
  knobUpdatePositionsMock.mockClear();
  keyLegacyUpdateMock.mockClear();
  legacyBatchStyleCommitMock.mockClear();
  singleKnobPropsMock.mockClear();
  statUpdatePositionsMock.mockClear();
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
  let originalWindowType: typeof window.__dmn_window_type;

  beforeEach(() => {
    originalWindowType = window.__dmn_window_type;
    window.__dmn_window_type = 'main';
    resetStores();
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
    window.__dmn_window_type = originalWindowType;
  });

  it('header stable native rename은 현재 index 대신 ID semantic leaf를 쓴다', async () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const basePosition = useStatItemStore.getState().positions['4key'][0];
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...basePosition,
            id,
          },
          { ...basePosition, id: otherId },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleRenameCommit: (value: string) => Promise<void>;
    };

    await act(async () => props.handleRenameCommit('  Custom  '));

    expect(patchLayerNameMock).toHaveBeenCalledWith('stat', id, 'Custom');
    expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    expect(statUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it.each(['kpsAvg', 'total'] as const)(
    'single stable statType %s는 선택 ID semantic leaf를 쓴다',
    (statType) => {
      const id = 'abababab-abab-4bab-8bab-abababababab';
      useStatItemStore.setState({
        positions: {
          '4key': [
            {
              ...useStatItemStore.getState().positions['4key'][0],
              id,
            },
          ],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'stat', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        handleStatUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleStatUpdate({ index: 0, statType }));

      expect(patchStatTypeMock).toHaveBeenCalledWith(id, { statType });
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it('single stable statType은 stale index 대신 선택 ID semantic leaf를 쓴다', () => {
    const id = 'abababab-abab-4bab-8bab-abababababab';
    const otherId = 'acacacac-acac-4cac-8cac-acacacacacac';
    const base = useStatItemStore.getState().positions['4key'][0];
    useStatItemStore.setState({
      positions: {
        '4key': [
          { ...base, id },
          { ...base, id: otherId },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleStatUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleStatUpdate({ index: 1, statType: 'kpsMax' }));

    expect(patchStatTypeMock).toHaveBeenCalledWith(id, {
      statType: 'kpsMax',
    });
    expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    expect(statUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it('panel single stable statType은 exact authority RPC만 쓴다', () => {
    window.__dmn_window_type = 'panel';
    const id = 'acacacac-acac-4cac-8cac-acacacacacac';
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...useStatItemStore.getState().positions['4key'][0],
            id,
          },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id, index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleStatUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleStatUpdate({ index: 0, statType: 'kpsMax' }));

    expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
      elementType: 'stat',
      id,
      patch: { statType: 'kpsMax' },
    });
    expect(patchStatTypeMock).not.toHaveBeenCalled();
    expect(statUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it.each(['stat-0', ''])(
    'single legacy statType id=%j는 기존 writer를 유지한다',
    (id) => {
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'stat', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        handleStatUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleStatUpdate({ index: 0, statType: 'total' }));

      expect(patchStatTypeMock).not.toHaveBeenCalled();
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it('panel header stable native rename은 exact authority RPC만 호출한다', async () => {
    window.__dmn_window_type = 'panel';
    const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            ...useStatItemStore.getState().positions['4key'][0],
            id,
            layerName: 'Before',
          },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id, index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleRenameCommit: (value: string) => Promise<void>;
    };

    await act(async () => props.handleRenameCommit('   '));

    expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
      elementType: 'stat',
      id,
      patch: { layerName: null },
    });
    expect(patchLayerNameMock).not.toHaveBeenCalled();
    expect(statUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it('header synthetic native rename은 기존 index writer를 유지한다', async () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id: 'stat-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleRenameCommit: (value: string) => Promise<void>;
    };

    await act(async () => props.handleRenameCommit('Legacy'));

    expect(patchLayerNameMock).not.toHaveBeenCalled();
    expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
  });

  it('single stable graphType은 stale index 대신 선택 ID semantic leaf를 쓴다', async () => {
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const otherId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: {
        '4key': [
          { ...base, id },
          { ...base, id: otherId },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGraphUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleGraphUpdate({ index: 1, graphType: 'bar' }));

    expect(patchGraphTypeMock).toHaveBeenCalledWith(id, 'bar');
    expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['key', 'dx', 12],
    ['stat', 'dy', 13],
    ['graph', 'width', 140],
    ['knob', 'height', 150],
  ] as const)(
    'single stable %s geometry는 변경 축만 semantic helper에 넘긴다',
    (type, field, value) => {
      const id = `${type}-11111111-1111-4111-8111-111111111111`;
      const base = {
        dx: 1,
        dy: 2,
        width: 60,
        height: 60,
        id,
      };
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [base as never] },
          canonicalPositions: { '4key': [base as never] },
        });
      } else if (type === 'stat') {
        useStatItemStore.setState({
          positions: { '4key': [{ ...base, statType: 'kps' } as never] },
        });
      } else if (type === 'graph') {
        useGraphItemStore.setState({
          positions: {
            '4key': [
              {
                ...base,
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1,
                graphColor: '#fff',
              } as never,
            ],
          },
        });
      } else {
        useKnobItemStore.setState({
          positions: {
            '4key': [{ ...base, axisId: 'HIDA:test', sensitivity: 1 } as never],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = (
        type === 'key' || type === 'stat'
          ? singleKeyStatPropsMock
          : type === 'graph'
          ? singleGraphPropsMock
          : singleKnobPropsMock
      ).mock.lastCall?.[0] as {
        handleGeometryCommit: (field: string, value: number) => void;
      };

      act(() => props.handleGeometryCommit(field, value));

      expect(patchGeometryMock).toHaveBeenCalledWith(
        type,
        id,
        { [field]: value },
        {},
      );
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      if (type === 'key' || type === 'stat') {
        expect(settleCommitMock).toHaveBeenCalledOnce();
      } else {
        expect(settleCommitMock).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['key', 'stat', 'graph', 'knob'] as const)(
    'panel single stable %s geometry는 exact authority RPC만 쓴다',
    (type) => {
      window.__dmn_window_type = 'panel';
      const id = `${type}-22222222-2222-4222-8222-222222222222`;
      const base = { dx: 1, dy: 2, width: 60, height: 60, id };
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [base as never] },
          canonicalPositions: { '4key': [base as never] },
        });
      } else if (type === 'stat') {
        useStatItemStore.setState({
          positions: { '4key': [{ ...base, statType: 'kps' } as never] },
        });
      } else if (type === 'graph') {
        useGraphItemStore.setState({
          positions: {
            '4key': [
              {
                ...base,
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1,
                graphColor: '#fff',
              } as never,
            ],
          },
        });
      } else {
        useKnobItemStore.setState({
          positions: {
            '4key': [{ ...base, axisId: 'HIDA:test', sensitivity: 1 } as never],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = (
        type === 'key' || type === 'stat'
          ? singleKeyStatPropsMock
          : type === 'graph'
          ? singleGraphPropsMock
          : singleKnobPropsMock
      ).mock.lastCall?.[0] as {
        handleGeometryCommit: (field: string, value: number) => void;
      };

      act(() => props.handleGeometryCommit('dx', 42));

      expect(patchBoundsViaAuthorityMock).toHaveBeenCalledWith({
        elementType: type,
        id,
        patch: { dx: 42 },
      });
      expect(patchGeometryMock).not.toHaveBeenCalled();
    },
  );

  it('key/stat geometry만 활성 preview gesture를 semantic commit에 결합하고 정산한다', () => {
    activeGestureIdMock.mockReturnValue('geometry-preview');
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    useKeyStore.setState({
      keyMappings: { '4key': ['A'] },
      positions: {
        '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id } as never],
      },
      canonicalPositions: {
        '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id } as never],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id, index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      handleGeometryCommit: (field: string, value: number) => void;
    };

    act(() => props.handleGeometryCommit('dx', 42));

    expect(patchGeometryMock).toHaveBeenCalledWith(
      'key',
      id,
      { dx: 42 },
      { gestureId: 'geometry-preview' },
    );
    expect(settleCommitMock).toHaveBeenCalledWith(
      patchGeometryMock.mock.results[0].value,
    );
  });

  it('graph geometry는 무관한 활성 preview gesture를 결합하거나 정산하지 않는다', () => {
    activeGestureIdMock.mockReturnValue('unrelated-preview');
    const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({ positions: { '4key': [{ ...base, id }] } });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id, index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGeometryCommit: (field: string, value: number) => void;
    };

    act(() => props.handleGeometryCommit('dx', 42));

    expect(patchGeometryMock).toHaveBeenCalledWith('graph', id, { dx: 42 }, {});
    expect(settleCommitMock).not.toHaveBeenCalled();
  });

  it('stable mixed batch geometry는 frozen mode와 선택 ID descriptor를 main helper에 넘긴다', () => {
    const keyId = '11111111-1111-4111-8111-111111111111';
    const statId = '22222222-2222-4222-8222-222222222222';
    useKeyStore.setState({
      keyMappings: { '4key': ['A'] },
      positions: {
        '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id: keyId } as never],
      },
      canonicalPositions: {
        '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id: keyId } as never],
      },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [
          {
            dx: 100,
            dy: 0,
            width: 60,
            height: 60,
            id: statId,
            statType: 'kps',
          } as never,
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: keyId, index: 0 },
        { type: 'stat', id: statId, index: 0 },
      ],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const batchProps = batchPropsMock.mock.lastCall?.[0] as {
      stableGeometryEnabled: boolean;
      onStableGeometryCommit: (operation: Record<string, unknown>) => void;
    };

    act(() =>
      batchProps.onStableGeometryCommit({
        kind: 'align',
        direction: 'left',
      }),
    );

    expect(batchProps.stableGeometryEnabled).toBe(true);
    expect(patchBatchGeometryMock).toHaveBeenCalledWith(
      {
        mode: '4key',
        targets: [
          { type: 'key', id: keyId },
          { type: 'stat', id: statId },
        ],
        operation: { kind: 'align', direction: 'left' },
      },
      {},
    );
    expect(patchBatchGeometryViaAuthorityMock).not.toHaveBeenCalled();
  });

  it('panel stable batch resize는 active preview UUID를 authority와 settle에 결합한다', () => {
    window.__dmn_window_type = 'panel';
    const gestureId = '33333333-3333-4333-8333-333333333333';
    activeGestureIdMock.mockReturnValue(gestureId);
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: {
        '4key': [
          { ...base, id: firstId },
          { ...base, id: secondId },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'graph', id: firstId, index: 0 },
        { type: 'graph', id: secondId, index: 1 },
      ],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const batchProps = batchPropsMock.mock.lastCall?.[0] as {
      onStableGeometryCommit: (operation: Record<string, unknown>) => void;
    };

    act(() =>
      batchProps.onStableGeometryCommit({
        kind: 'resize',
        dimension: 'width',
        value: 88,
      }),
    );

    expect(patchBatchGeometryViaAuthorityMock).toHaveBeenCalledWith(
      {
        mode: '4key',
        targets: [
          { type: 'graph', id: firstId },
          { type: 'graph', id: secondId },
        ],
        operation: { kind: 'resize', dimension: 'width', value: 88 },
      },
      gestureId,
    );
    expect(patchBatchGeometryMock).not.toHaveBeenCalled();
    expect(settleCommitMock).toHaveBeenCalledWith(
      patchBatchGeometryViaAuthorityMock.mock.results[0].value,
    );
  });

  it('stable batch spacing은 명시 gestureId를 전달하고 false 결과도 settle한다', () => {
    const gestureId = '44444444-4444-4444-8444-444444444444';
    patchBatchGeometryMock.mockResolvedValueOnce(false);
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: {
        '4key': [
          { ...base, id: firstId, dx: 0 },
          { ...base, id: secondId, dx: 100 },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'graph', id: firstId, index: 0 },
        { type: 'graph', id: secondId, index: 1 },
      ],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const batchProps = batchPropsMock.mock.lastCall?.[0] as {
      onStableGeometryCommit: (
        operation: Record<string, unknown>,
        options?: { gestureId?: string },
      ) => void;
    };

    act(() =>
      batchProps.onStableGeometryCommit(
        { kind: 'spacing', spacing: 5 },
        { gestureId },
      ),
    );

    expect(patchBatchGeometryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: { kind: 'spacing', spacing: 5 },
      }),
      { gestureId },
    );
    expect(settleCommitMock).toHaveBeenCalledWith(
      patchBatchGeometryMock.mock.results[0].value,
    );
  });

  it('stable batch W/H preview는 stale selection index 대신 ID 현재 index를 쓴다', () => {
    const selectedId = '11111111-1111-4111-8111-111111111111';
    const otherId = '22222222-2222-4222-8222-222222222222';
    useKeyStore.setState({
      keyMappings: { '4key': ['A', 'B'] },
      positions: {
        '4key': [
          { dx: 0, dy: 0, width: 60, height: 60, id: selectedId } as never,
          { dx: 100, dy: 0, width: 60, height: 60, id: otherId } as never,
        ],
      },
      canonicalPositions: {
        '4key': [
          { dx: 0, dy: 0, width: 60, height: 60, id: selectedId } as never,
          { dx: 100, dy: 0, width: 60, height: 60, id: otherId } as never,
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: selectedId, index: 1 },
        { type: 'key', id: otherId, index: 0 },
      ],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const batchProps = batchPropsMock.mock.lastCall?.[0] as {
      onStableGeometryPreview: (operation: Record<string, unknown>) => void;
    };

    act(() =>
      batchProps.onStableGeometryPreview({
        kind: 'resize',
        dimension: 'height',
        value: 91,
      }),
    );

    expect(previewMock).toHaveBeenCalledWith(
      '4key',
      [
        { index: 0, patch: { height: 91 } },
        { index: 1, patch: { height: 91 } },
      ],
      { domain: 'keyPosition' },
    );
  });

  it('synthetic가 하나라도 섞인 batch geometry는 전체 legacy 경로를 유지한다', () => {
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: 'key-0', index: 0 },
        {
          type: 'stat',
          id: '22222222-2222-4222-8222-222222222222',
          index: 0,
        },
      ],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);

    expect(batchPropsMock.mock.lastCall?.[0]).toMatchObject({
      stableGeometryEnabled: false,
    });
    expect(patchBatchGeometryMock).not.toHaveBeenCalled();
    expect(patchBatchGeometryViaAuthorityMock).not.toHaveBeenCalled();
  });

  it('single graph geometry는 stale index의 position id 대신 선택 descriptor id를 쓴다', () => {
    const selectedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const wrongId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: {
        '4key': [
          { ...base, id: selectedId },
          { ...base, id: wrongId },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id: selectedId, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGeometryCommit: (field: string, value: number) => void;
    };

    act(() => props.handleGeometryCommit('dy', 43));

    expect(patchGeometryMock).toHaveBeenCalledWith(
      'graph',
      selectedId,
      { dy: 43 },
      {},
    );
  });

  it('synthetic 선택 descriptor는 indexed position에 stable id가 있어도 semantic으로 승격하지 않는다', () => {
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: {
        '4key': [
          {
            ...base,
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id: 'graph-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGeometryCommit?: unknown;
      handleGraphUpdate: (update: Record<string, unknown>) => void;
    };

    expect(props.handleGeometryCommit).toBeUndefined();
    act(() => props.handleGraphUpdate({ index: 0, dx: 42 }));
    expect(patchGeometryMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
  });

  it('panel single stable graphType은 exact authority RPC만 쓴다', async () => {
    window.__dmn_window_type = 'panel';
    const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    useGraphItemStore.setState({
      positions: {
        '4key': [{ ...useGraphItemStore.getState().positions['4key'][0], id }],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id, index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGraphUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleGraphUpdate({ index: 0, graphType: 'bar' }));

    expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
      elementType: 'graph',
      id,
      patch: { graphType: 'bar' },
    });
    expect(patchGraphTypeMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['main synthetic', 'main', 'graph-0'],
    ['main empty', 'main', ''],
    ['panel synthetic', 'panel', 'graph-0'],
    ['panel empty', 'panel', ''],
  ] as const)(
    'single legacy graphType $label은 기존 writer를 유지한다',
    (_label, windowType, id) => {
      window.__dmn_window_type = windowType;
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'graph', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleGraphUpdate({ index: 0, graphType: 'bar' }));

      expect(patchGraphTypeMock).not.toHaveBeenCalled();
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it('stable graphType batch는 선택 ID를 한 semantic commit으로 넘긴다', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: { '4key': ids.map((id) => ({ ...base, id })) },
    });
    useGridSelectionStore.setState({
      selectedElements: ids.map((id, index) => ({
        type: 'graph' as const,
        id,
        index: 1 - index,
      })),
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = batchGraphPropsMock.mock.lastCall?.[0] as {
      handleGraphBatchSharedSetting: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleGraphBatchSharedSetting({ graphType: 'bar' }));

    expect(patchGraphTypesMock).toHaveBeenCalledWith(ids, 'bar');
    expect(patchGraphTypesViaAuthorityMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it('panel stable graphType batch는 authority batch RPC 하나만 쓴다', () => {
    window.__dmn_window_type = 'panel';
    const ids = [
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ];
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: { '4key': ids.map((id) => ({ ...base, id })) },
    });
    useGridSelectionStore.setState({
      selectedElements: ids.map((id, index) => ({
        type: 'graph' as const,
        id,
        index,
      })),
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = batchGraphPropsMock.mock.lastCall?.[0] as {
      handleGraphBatchSharedSetting: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleGraphBatchSharedSetting({ graphType: 'line' }));

    expect(patchGraphTypesViaAuthorityMock).toHaveBeenCalledWith(ids, 'line');
    expect(patchGraphTypesMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['main synthetic', 'main', 'graph-0'],
    ['main empty', 'main', ''],
    ['panel synthetic', 'panel', 'graph-0'],
    ['panel empty', 'panel', ''],
  ] as const)(
    '$label id가 섞인 graphType batch는 전체 기존 writer로 폴백한다',
    (_label, windowType, legacyId) => {
      window.__dmn_window_type = windowType;
      const stableId = '55555555-5555-4555-8555-555555555555';
      const base = useGraphItemStore.getState().positions['4key'][0];
      useGraphItemStore.setState({
        positions: {
          '4key': [
            { ...base, id: stableId },
            { ...base, id: legacyId },
          ],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [stableId, legacyId].map((id, index) => ({
          type: 'graph' as const,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphBatchSharedSetting: (
          update: Record<string, unknown>,
        ) => void;
      };

      act(() => props.handleGraphBatchSharedSetting({ graphType: 'bar' }));

      expect(patchGraphTypesMock).not.toHaveBeenCalled();
      expect(patchGraphTypesViaAuthorityMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it('single stable graphColor는 stale index 대신 선택 ID semantic leaf를 쓴다', () => {
    const id = '77777777-7777-4777-8777-777777777777';
    const otherId = '88888888-8888-4888-8888-888888888888';
    const base = useGraphItemStore.getState().positions['4key'][0];
    useGraphItemStore.setState({
      positions: {
        '4key': [
          { ...base, id },
          { ...base, id: otherId },
        ],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGraphUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleGraphUpdate({ index: 1, graphColor: ' raw ' }));

    expect(patchGraphColorMock).toHaveBeenCalledWith(id, ' raw ');
    expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it('panel single stable graphColor는 exact authority RPC만 쓴다', () => {
    window.__dmn_window_type = 'panel';
    const id = '99999999-9999-4999-8999-999999999999';
    useGraphItemStore.setState({
      positions: {
        '4key': [{ ...useGraphItemStore.getState().positions['4key'][0], id }],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'graph', id, index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleGraphPropsMock.mock.lastCall?.[0] as {
      handleGraphUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.handleGraphUpdate({ index: 0, graphColor: '#123456' }));

    expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
      elementType: 'graph',
      id,
      patch: { graphColor: '#123456' },
    });
    expect(patchGraphColorMock).not.toHaveBeenCalled();
    expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
  });

  it.each([
    ['main synthetic', 'main', 'graph-0'],
    ['main empty', 'main', ''],
    ['panel synthetic', 'panel', 'graph-0'],
    ['panel empty', 'panel', ''],
  ] as const)(
    'single legacy graphColor $label은 기존 writer를 유지한다',
    (_label, windowType, id) => {
      window.__dmn_window_type = windowType;
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'graph', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleGraphUpdate({ index: 0, graphColor: '#abcdef' }));

      expect(patchGraphColorMock).not.toHaveBeenCalled();
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['main', 'key'],
    ['main', 'knob'],
    ['panel', 'key'],
    ['panel', 'knob'],
  ] as const)(
    '%s single stable %s activeImage load와 reset은 exact key/knob 경로만 쓴다',
    (windowType, type) => {
      window.__dmn_window_type = windowType;
      const id =
        type === 'key'
          ? 'a9999999-9999-4999-8999-999999999991'
          : 'a9999999-9999-4999-8999-999999999992';
      if (type === 'key') {
        const position = { dx: 0, dy: 0, width: 60, height: 60, id };
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] as never },
          canonicalPositions: { '4key': [position] as never },
        });
      } else {
        useKnobItemStore.setState({
          positions: {
            '4key': [
              { ...useKnobItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props =
        type === 'knob'
          ? singleKnobPropsMock.mock.lastCall?.[0]
          : singleKeyStatPropsMock.mock.lastCall?.[0];
      const commit = (props as { onActiveImageCommit: (value: string) => void })
        .onActiveImageCommit;

      act(() => {
        commit('  active.png  ');
        commit('');
      });

      if (windowType === 'panel') {
        expect(patchPropertyViaAuthorityMock).toHaveBeenNthCalledWith(1, {
          elementType: type,
          id,
          patch: { activeImage: '  active.png  ' },
        });
        expect(patchPropertyViaAuthorityMock).toHaveBeenNthCalledWith(2, {
          elementType: type,
          id,
          patch: { activeImage: '' },
        });
        expect(patchActiveImageMock).not.toHaveBeenCalled();
      } else {
        expect(patchActiveImageMock.mock.calls).toEqual([
          [type, id, '  active.png  '],
          [type, id, ''],
        ]);
        expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s single stable key sound select와 clear는 exact ID 경로만 쓴다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const id = 'a7777777-7777-4777-8777-777777777777';
      const position = { dx: 0, dy: 0, width: 60, height: 60, id };
      useKeyStore.setState({
        keyMappings: { '4key': ['A'] },
        positions: { '4key': [position] as never },
        canonicalPositions: { '4key': [position] as never },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const commit = (
        singleKeyStatPropsMock.mock.lastCall?.[0] as {
          onSoundPathCommit: (value: string) => void;
        }
      ).onSoundPathCommit;

      act(() => {
        commit('  sounds/raw.wav  ');
        commit('');
      });

      if (windowType === 'panel') {
        expect(patchSoundPathViaAuthorityMock.mock.calls).toEqual([
          [[id], '  sounds/raw.wav  '],
          [[id], ''],
        ]);
        expect(patchSoundPathMock).not.toHaveBeenCalled();
      } else {
        expect(patchSoundPathMock.mock.calls).toEqual([
          [id, '  sounds/raw.wav  '],
          [id, ''],
        ]);
        expect(patchSoundPathViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
    },
  );

  it('single key sound는 stale index의 record 대신 선택 descriptor ID를 동결한다', () => {
    const selectedId = 'a7666666-6666-4666-8666-666666666666';
    const indexedId = 'a7555555-5555-4555-8555-555555555555';
    const position = { dx: 0, dy: 0, width: 60, height: 60 };
    useKeyStore.setState({
      keyMappings: { '4key': ['A', 'B'] },
      positions: {
        '4key': [
          { ...position, id: selectedId },
          { ...position, id: indexedId },
        ] as never,
      },
      canonicalPositions: {
        '4key': [
          { ...position, id: selectedId },
          { ...position, id: indexedId },
        ] as never,
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: selectedId, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const commit = (
      singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onSoundPathCommit: (value: string) => void;
      }
    ).onSoundPathCommit;

    act(() => commit('sounds/selected.wav'));

    expect(patchSoundPathMock).toHaveBeenCalledWith(
      selectedId,
      'sounds/selected.wav',
    );
    expect(patchSoundPathMock).not.toHaveBeenCalledWith(
      indexedId,
      expect.anything(),
    );
    expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
  });

  it.each(['main', 'panel'] as const)(
    '%s single stable key soundEnabled는 exact ID 경로만 쓴다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const id = 'a7888888-8888-4888-8888-888888888888';
      const position = { ...createDefaultKeyPosition(), id };
      useKeyStore.setState({
        keyMappings: { '4key': ['A'] },
        positions: { '4key': [position] },
        canonicalPositions: { '4key': [position] },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const commit = (
        singleKeyStatPropsMock.mock.lastCall?.[0] as {
          onSoundEnabledCommit: (value: boolean) => void;
        }
      ).onSoundEnabledCommit;

      act(() => commit(true));

      if (windowType === 'panel') {
        expect(patchSoundEnabledViaAuthorityMock).toHaveBeenCalledWith(
          [id],
          true,
        );
        expect(patchSoundEnabledMock).not.toHaveBeenCalled();
      } else {
        expect(patchSoundEnabledMock).toHaveBeenCalledWith(id, true);
        expect(patchSoundEnabledViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(previewMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key synthetic', 'key', 'key-0'],
    ['key empty', 'key', ''],
    ['stat stable', 'stat', 'a7999999-9999-4999-8999-999999999999'],
  ] as const)(
    'single %s soundEnabled는 exact callback을 노출하지 않는다',
    (_label, type, id) => {
      const position = { ...createDefaultKeyPosition(), id };
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] },
          canonicalPositions: { '4key': [position] },
        });
      } else {
        useStatItemStore.setState({
          positions: { '4key': [{ ...position, statType: 'kps' }] },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onSoundEnabledCommit?: (value: boolean) => void;
        onKeyPreview?: (index: number, patch: Record<string, unknown>) => void;
        onKeyUpdate?: (patch: Record<string, unknown>) => void;
      };

      expect(props.onSoundEnabledCommit).toBeUndefined();
      if (type === 'key') {
        act(() => {
          props.onKeyPreview?.(0, { soundEnabled: true });
          props.onKeyUpdate?.({ index: 0, soundEnabled: true });
        });
        expect(keyLegacyUpdateMock).toHaveBeenCalledWith({
          index: 0,
          soundEnabled: true,
        });
      }
      expect(patchSoundEnabledMock).not.toHaveBeenCalled();
      expect(patchSoundEnabledViaAuthorityMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main', 'main'],
    ['panel', 'panel'],
  ] as const)(
    '$label stable graphColor batch는 ID batch 커밋 하나만 쓴다',
    (_label, windowType) => {
      window.__dmn_window_type = windowType;
      const ids = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      ];
      const base = useGraphItemStore.getState().positions['4key'][0];
      useGraphItemStore.setState({
        positions: { '4key': ids.map((id) => ({ ...base, id })) },
      });
      useGridSelectionStore.setState({
        selectedElements: ids.map((id, index) => ({
          type: 'graph' as const,
          id,
          index: 1 - index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphBatchSharedSetting: (
          update: Record<string, unknown>,
        ) => void;
      };

      act(() =>
        props.handleGraphBatchSharedSetting({ graphColor: ' custom ' }),
      );

      if (windowType === 'panel') {
        expect(patchGraphColorsViaAuthorityMock).toHaveBeenCalledWith(
          ids,
          ' custom ',
        );
        expect(patchGraphColorsMock).not.toHaveBeenCalled();
      } else {
        expect(patchGraphColorsMock).toHaveBeenCalledWith(ids, ' custom ');
        expect(patchGraphColorsViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main synthetic', 'main', 'graph-0'],
    ['main empty', 'main', ''],
    ['panel synthetic', 'panel', 'graph-0'],
    ['panel empty', 'panel', ''],
  ] as const)(
    '$label id가 섞인 graphColor batch는 전체 기존 writer로 폴백한다',
    (_label, windowType, legacyId) => {
      window.__dmn_window_type = windowType;
      const stableId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const base = useGraphItemStore.getState().positions['4key'][0];
      useGraphItemStore.setState({
        positions: {
          '4key': [
            { ...base, id: stableId },
            { ...base, id: legacyId },
          ],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [stableId, legacyId].map((id, index) => ({
          type: 'graph' as const,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphBatchSharedSetting: (
          update: Record<string, unknown>,
        ) => void;
      };

      act(() => props.handleGraphBatchSharedSetting({ graphColor: '#fedcba' }));

      expect(patchGraphColorsMock).not.toHaveBeenCalled();
      expect(patchGraphColorsViaAuthorityMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['show average', { showAvgLine: true }],
    ['animation', { graphAnimationEnabled: false }],
    ['speed', { graphSpeed: 2300 }],
  ] as const)(
    'single stable graph $label literal은 main에서 선택 ID semantic leaf를 쓴다',
    (_label, patch) => {
      const id = 'c1111111-1111-4111-8111-111111111111';
      useGraphItemStore.setState({
        positions: {
          '4key': [
            { ...useGraphItemStore.getState().positions['4key'][0], id },
          ],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'graph', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleGraphUpdate({ index: 0, ...patch }));

      expect(patchGraphPropertiesMock).toHaveBeenCalledWith(id, patch);
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['show average', { showAvgLine: false }],
    ['animation', { graphAnimationEnabled: true }],
    ['speed', { graphSpeed: 4100 }],
  ] as const)(
    'panel single stable graph $label literal은 authority RPC만 쓴다',
    (_label, patch) => {
      window.__dmn_window_type = 'panel';
      const id = 'c2222222-2222-4222-8222-222222222222';
      useGraphItemStore.setState({
        positions: {
          '4key': [
            { ...useGraphItemStore.getState().positions['4key'][0], id },
          ],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'graph', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleGraphUpdate({ index: 0, ...patch }));

      expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
        elementType: 'graph',
        id,
        patch,
      });
      expect(patchGraphPropertiesMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['show average', { showAvgLine: true }],
    ['animation', { graphAnimationEnabled: false }],
    ['speed', { graphSpeed: 1700 }],
  ] as const)(
    'stable graph $label batch는 main과 panel에서 ID batch 하나만 쓴다',
    (_label, patch) => {
      const ids = [
        'c3333333-3333-4333-8333-333333333331',
        'c3333333-3333-4333-8333-333333333332',
      ];
      const base = useGraphItemStore.getState().positions['4key'][0];
      useGraphItemStore.setState({
        positions: { '4key': ids.map((id) => ({ ...base, id })) },
      });
      useGridSelectionStore.setState({
        selectedElements: ids.map((id, index) => ({
          type: 'graph' as const,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphBatchSharedSetting: (
          update: Record<string, unknown>,
        ) => void;
      };

      act(() => props.handleGraphBatchSharedSetting(patch));
      expect(patchGraphPropertiesMock).toHaveBeenCalledWith(ids, patch);
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();

      act(() => mounted.root.unmount());
      mounted.container.remove();
      resetStores();
      window.__dmn_window_type = 'panel';
      useGraphItemStore.setState({
        positions: { '4key': ids.map((id) => ({ ...base, id })) },
      });
      useGridSelectionStore.setState({
        selectedElements: ids.map((id, index) => ({
          type: 'graph' as const,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const panelProps = batchGraphPropsMock.mock.lastCall?.[0] as {
        handleGraphBatchSharedSetting: (
          update: Record<string, unknown>,
        ) => void;
      };

      act(() => panelProps.handleGraphBatchSharedSetting(patch));
      expect(patchGraphPropertiesViaAuthorityMock).toHaveBeenCalledWith(
        ids,
        patch,
      );
      expect(patchGraphPropertiesMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['reverse', { reverse: true }],
    ['sensitivity', { sensitivity: 2.5 }],
  ] as const)(
    'single stable knob $label literal은 main과 panel에서 exact leaf를 쓴다',
    (_label, patch) => {
      const id = 'd1111111-1111-4111-8111-111111111111';
      useKnobItemStore.setState({
        positions: {
          '4key': [{ ...useKnobItemStore.getState().positions['4key'][0], id }],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'knob', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKnobPropsMock.mock.lastCall?.[0] as {
        handleKnobUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleKnobUpdate({ index: 0, ...patch }));
      expect(patchKnobPropertyMock).toHaveBeenCalledWith(id, patch);
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();

      act(() => mounted.root.unmount());
      mounted.container.remove();
      resetStores();
      window.__dmn_window_type = 'panel';
      useKnobItemStore.setState({
        positions: {
          '4key': [{ ...useKnobItemStore.getState().positions['4key'][0], id }],
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'knob', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const panelProps = singleKnobPropsMock.mock.lastCall?.[0] as {
        handleKnobUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => panelProps.handleKnobUpdate({ index: 0, ...patch }));
      expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
        elementType: 'knob',
        id,
        patch,
      });
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['reverse', { reverse: false }],
    ['sensitivity', { sensitivity: 4 }],
  ] as const)(
    'stable knob $label batch는 main과 panel에서 ID batch 하나만 쓴다',
    (_label, patch) => {
      const ids = [
        'd2222222-2222-4222-8222-222222222221',
        'd2222222-2222-4222-8222-222222222222',
      ];
      const base = useKnobItemStore.getState().positions['4key'][0];
      useKnobItemStore.setState({
        positions: { '4key': ids.map((id) => ({ ...base, id })) },
      });
      useGridSelectionStore.setState({
        selectedElements: ids.map((id, index) => ({
          type: 'knob' as const,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKnobPropsMock.mock.lastCall?.[0] as {
        handleKnobBatchSharedSetting: (update: Record<string, unknown>) => void;
      };

      act(() => props.handleKnobBatchSharedSetting(patch));
      expect(patchKnobPropertiesMock).toHaveBeenCalledWith(ids, patch);
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();

      act(() => mounted.root.unmount());
      mounted.container.remove();
      resetStores();
      window.__dmn_window_type = 'panel';
      useKnobItemStore.setState({
        positions: { '4key': ids.map((id) => ({ ...base, id })) },
      });
      useGridSelectionStore.setState({
        selectedElements: ids.map((id, index) => ({
          type: 'knob' as const,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const panelProps = batchKnobPropsMock.mock.lastCall?.[0] as {
        handleKnobBatchSharedSetting: (update: Record<string, unknown>) => void;
      };

      act(() => panelProps.handleKnobBatchSharedSetting(patch));
      expect(patchKnobPropertiesViaAuthorityMock).toHaveBeenCalledWith(
        ids,
        patch,
      );
      expect(patchKnobPropertiesMock).not.toHaveBeenCalled();
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['graph single', 'graph', { showAvgLine: true }],
    ['knob single', 'knob', { reverse: true }],
  ] as const)(
    'panel synthetic $label runtime leaf는 기존 writer로 폴백한다',
    (_label, type, patch) => {
      window.__dmn_window_type = 'panel';
      useGridSelectionStore.setState({
        selectedElements: [{ type, id: `${type}-0`, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      if (type === 'graph') {
        const props = singleGraphPropsMock.mock.lastCall?.[0] as {
          handleGraphUpdate: (update: Record<string, unknown>) => void;
        };
        act(() => props.handleGraphUpdate({ index: 0, ...patch }));
        expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
      } else {
        const props = singleKnobPropsMock.mock.lastCall?.[0] as {
          handleKnobUpdate: (update: Record<string, unknown>) => void;
        };
        act(() => props.handleKnobUpdate({ index: 0, ...patch }));
        expect(knobUpdatePositionsMock).toHaveBeenCalledOnce();
      }
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['graph synthetic', 'graph', 'graph-0', { showAvgLine: true }],
    ['graph empty', 'graph', '', { graphSpeed: 1800 }],
    ['knob synthetic', 'knob', 'knob-0', { reverse: true }],
    ['knob empty', 'knob', '', { sensitivity: 3 }],
  ] as const)(
    'panel $label batch는 semantic 분할 없이 전체 기존 writer로 폴백한다',
    (_label, type, legacyId, patch) => {
      window.__dmn_window_type = 'panel';
      const stableId =
        type === 'graph'
          ? 'e1111111-1111-4111-8111-111111111111'
          : 'e2222222-2222-4222-8222-222222222222';
      useGridSelectionStore.setState({
        selectedElements: [stableId, legacyId].map((id, index) => ({
          type,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);

      if (type === 'graph') {
        const props = batchGraphPropsMock.mock.lastCall?.[0] as {
          handleGraphBatchSharedSetting: (
            update: Record<string, unknown>,
          ) => void;
        };
        act(() => props.handleGraphBatchSharedSetting(patch));
        expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
        expect(patchGraphPropertiesMock).not.toHaveBeenCalled();
        expect(patchGraphPropertiesViaAuthorityMock).not.toHaveBeenCalled();
      } else {
        const props = batchKnobPropsMock.mock.lastCall?.[0] as {
          handleKnobBatchSharedSetting: (
            update: Record<string, unknown>,
          ) => void;
        };
        act(() => props.handleKnobBatchSharedSetting(patch));
        expect(knobUpdatePositionsMock).toHaveBeenCalledOnce();
        expect(patchKnobPropertiesMock).not.toHaveBeenCalled();
        expect(patchKnobPropertiesViaAuthorityMock).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ['key', singleKeyStatPropsMock],
    ['stat', singleKeyStatPropsMock],
    ['graph', singleGraphPropsMock],
    ['knob', singleKnobPropsMock],
  ] as const)(
    'single stable %s useInlineStyles는 선택 ID semantic leaf를 쓴다',
    (type, propsMock) => {
      const id = `f1111111-1111-4111-8111-${type.padEnd(12, '1')}`;
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
          canonicalPositions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
        });
      } else if (type === 'stat') {
        useStatItemStore.setState({
          positions: {
            '4key': [
              { ...useStatItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      } else if (type === 'graph') {
        useGraphItemStore.setState({
          positions: {
            '4key': [
              { ...useGraphItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      } else {
        useKnobItemStore.setState({
          positions: {
            '4key': [
              { ...useKnobItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = propsMock.mock.lastCall?.[0] as Record<string, unknown>;
      const handler =
        type === 'key'
          ? (props.onKeyUpdate as (update: Record<string, unknown>) => void)
          : type === 'stat'
          ? (props.handleStatUpdate as (
              update: Record<string, unknown>,
            ) => void)
          : type === 'graph'
          ? (props.handleGraphUpdate as (
              update: Record<string, unknown>,
            ) => void)
          : (props.handleKnobUpdate as (
              update: Record<string, unknown>,
            ) => void);

      act(() => handler({ index: 0, useInlineStyles: true }));

      expect(patchUseInlineStylesMock).toHaveBeenCalledWith(type, id, true);
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key synthetic', 'key', 'key-0'],
    ['key empty', 'key', ''],
    ['stat synthetic', 'stat', 'stat-0'],
    ['stat empty', 'stat', ''],
  ] as const)(
    'panel single %s counter bool은 semantic 없이 whole-counter legacy다',
    (_label, type, id) => {
      window.__dmn_window_type = 'panel';
      const basePosition = createDefaultKeyPosition();
      const counter = basePosition.counter;
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: {
            '4key': [
              {
                ...basePosition,
                id,
                counter,
              },
            ],
          },
          canonicalPositions: {
            '4key': [
              {
                ...basePosition,
                id,
                counter,
              },
            ],
          },
        });
      } else {
        useStatItemStore.setState({
          positions: {
            '4key': [
              {
                ...basePosition,
                statType: 'kps',
                id,
                counter,
              },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onCounterEnabledCommit?: (enabled: boolean) => void;
        onCounterAnimationEnabledCommit?: (enabled: boolean) => void;
        onKeyUpdate?: (update: Record<string, unknown>) => void;
        handleStatUpdate?: (update: Record<string, unknown>) => void;
      };
      expect(props.onCounterEnabledCommit).toBeUndefined();
      expect(props.onCounterAnimationEnabledCommit).toBeUndefined();
      const legacy =
        type === 'key' ? props.onKeyUpdate : props.handleStatUpdate;
      act(() =>
        legacy?.({
          index: 0,
          counter: {
            ...counter,
            enabled: false,
            animation: { ...counter.animation, enabled: true },
          },
        }),
      );

      expect(patchCounterEnabledMock).not.toHaveBeenCalled();
      expect(patchCounterAnimationEnabledMock).not.toHaveBeenCalled();
      expect(patchCounterEnabledViaAuthorityMock).not.toHaveBeenCalled();
      expect(
        patchCounterAnimationEnabledViaAuthorityMock,
      ).not.toHaveBeenCalled();
      if (type === 'key') expect(keyLegacyUpdateMock).toHaveBeenCalledOnce();
      else expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['main key', 'main', 'key'],
    ['main stat', 'main', 'stat'],
    ['panel key', 'panel', 'key'],
    ['panel stat', 'panel', 'stat'],
  ] as const)(
    '%s counter bool 두 callback은 선택 descriptor ID exact writer만 쓴다',
    (_label, windowType, type) => {
      window.__dmn_window_type = windowType;
      const id =
        type === 'key'
          ? 'a1111111-1111-4111-8111-111111111111'
          : 'a2222222-2222-4222-8222-222222222222';
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: {
            '4key': [
              {
                ...useKeyStore.getState().positions['4key'][0],
                id,
              },
            ],
          },
          canonicalPositions: {
            '4key': [
              {
                ...useKeyStore.getState().positions['4key'][0],
                id,
              },
            ],
          },
        });
      } else {
        useStatItemStore.setState({
          positions: {
            '4key': [
              { ...useStatItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onCounterEnabledCommit: (enabled: boolean) => void;
        onCounterAnimationEnabledCommit: (enabled: boolean) => void;
      };

      act(() => props.onCounterEnabledCommit(true));
      act(() => props.onCounterAnimationEnabledCommit(false));
      if (windowType === 'panel') {
        expect(patchCounterEnabledViaAuthorityMock).toHaveBeenCalledWith(
          [{ elementType: type, id }],
          true,
        );
        expect(
          patchCounterAnimationEnabledViaAuthorityMock,
        ).toHaveBeenCalledWith([{ elementType: type, id }], false);
        expect(patchCounterEnabledMock).not.toHaveBeenCalled();
      } else {
        expect(patchCounterEnabledMock).toHaveBeenCalledWith(type, id, true);
        expect(patchCounterAnimationEnabledMock).toHaveBeenCalledWith(
          type,
          id,
          false,
        );
        expect(patchCounterEnabledViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main key', 'main', 'key'],
    ['main stat', 'main', 'stat'],
    ['panel key', 'panel', 'key'],
    ['panel stat', 'panel', 'stat'],
  ] as const)(
    '%s counter layout callback은 선택 descriptor ID exact writer만 쓴다',
    (_label, windowType, type) => {
      window.__dmn_window_type = windowType;
      const id =
        type === 'key'
          ? 'a3111111-1111-4111-8111-111111111111'
          : 'a3222222-2222-4222-8222-222222222222';
      const position = { ...createDefaultKeyPosition(), id };
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] },
          canonicalPositions: { '4key': [position] },
        });
      } else {
        useStatItemStore.setState({
          positions: { '4key': [{ ...position, statType: 'kps' }] },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const commit = (
        singleKeyStatPropsMock.mock.lastCall?.[0] as {
          onCounterLayoutCommit: (patch: { counterGap: number }) => void;
        }
      ).onCounterLayoutCommit;

      act(() => commit({ counterGap: 4_294_967_295 }));
      if (windowType === 'panel') {
        expect(patchCounterLayoutViaAuthorityMock).toHaveBeenCalledWith(
          [{ elementType: type, id }],
          { counterGap: 4_294_967_295 },
        );
        expect(patchCounterLayoutMock).not.toHaveBeenCalled();
      } else {
        expect(patchCounterLayoutMock).toHaveBeenCalledWith(type, id, {
          counterGap: 4_294_967_295,
        });
        expect(patchCounterLayoutViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key synthetic', 'key', 'key-0'],
    ['key empty', 'key', ''],
    ['stat synthetic', 'stat', 'stat-0'],
    ['stat empty', 'stat', ''],
  ] as const)(
    'panel single %s counter layout은 exact callback 없이 legacy다',
    (_label, type, id) => {
      const position = { ...createDefaultKeyPosition(), id };
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] },
          canonicalPositions: { '4key': [position] },
        });
      } else {
        useStatItemStore.setState({
          positions: { '4key': [{ ...position, statType: 'kps' }] },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onCounterLayoutCommit?: (patch: { counterGap: number }) => void;
        onKeyUpdate?: (patch: Record<string, unknown>) => void;
        handleStatUpdate?: (patch: Record<string, unknown>) => void;
      };
      expect(props.onCounterLayoutCommit).toBeUndefined();
      const legacy =
        type === 'key' ? props.onKeyUpdate : props.handleStatUpdate;
      act(() =>
        legacy?.({
          index: 0,
          counter: { ...position.counter, gap: 9999 },
        }),
      );
      expect(patchCounterLayoutMock).not.toHaveBeenCalled();
      expect(patchCounterLayoutViaAuthorityMock).not.toHaveBeenCalled();
      if (type === 'key') expect(keyLegacyUpdateMock).toHaveBeenCalledOnce();
      else expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['key', singleKeyStatPropsMock],
    ['stat', singleKeyStatPropsMock],
    ['graph', singleGraphPropsMock],
    ['knob', singleKnobPropsMock],
  ] as const)(
    'panel single stable %s useInlineStyles는 exact authority RPC만 쓴다',
    (type, propsMock) => {
      window.__dmn_window_type = 'panel';
      const id = `f2222222-2222-4222-8222-${type.padEnd(12, '2')}`;
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
          canonicalPositions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
        });
      } else if (type === 'stat') {
        useStatItemStore.setState({
          positions: {
            '4key': [
              { ...useStatItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      } else if (type === 'graph') {
        useGraphItemStore.setState({
          positions: {
            '4key': [
              { ...useGraphItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      } else {
        useKnobItemStore.setState({
          positions: {
            '4key': [
              { ...useKnobItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = propsMock.mock.lastCall?.[0] as Record<string, unknown>;
      const handler =
        type === 'key'
          ? (props.onKeyUpdate as (update: Record<string, unknown>) => void)
          : type === 'stat'
          ? (props.handleStatUpdate as (
              update: Record<string, unknown>,
            ) => void)
          : type === 'graph'
          ? (props.handleGraphUpdate as (
              update: Record<string, unknown>,
            ) => void)
          : (props.handleKnobUpdate as (
              update: Record<string, unknown>,
            ) => void);

      act(() => handler({ index: 0, useInlineStyles: false }));

      expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
        elementType: type,
        id,
        patch: { useInlineStyles: false },
      });
      expect(patchUseInlineStylesMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key synthetic', 'key', 'key-0', singleKeyStatPropsMock],
    ['key empty', 'key', '', singleKeyStatPropsMock],
    ['stat synthetic', 'stat', 'stat-0', singleKeyStatPropsMock],
    ['stat empty', 'stat', '', singleKeyStatPropsMock],
    ['graph synthetic', 'graph', 'graph-0', singleGraphPropsMock],
    ['graph empty', 'graph', '', singleGraphPropsMock],
    ['knob synthetic', 'knob', 'knob-0', singleKnobPropsMock],
    ['knob empty', 'knob', '', singleKnobPropsMock],
  ] as const)(
    'panel single %s useInlineStyles는 기존 writer로 폴백한다',
    (_label, type, id, propsMock) => {
      window.__dmn_window_type = 'panel';
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
          canonicalPositions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = propsMock.mock.lastCall?.[0] as Record<string, unknown>;
      const handler =
        type === 'key'
          ? (props.onKeyUpdate as (update: Record<string, unknown>) => void)
          : type === 'stat'
          ? (props.handleStatUpdate as (
              update: Record<string, unknown>,
            ) => void)
          : type === 'graph'
          ? (props.handleGraphUpdate as (
              update: Record<string, unknown>,
            ) => void)
          : (props.handleKnobUpdate as (
              update: Record<string, unknown>,
            ) => void);

      act(() => handler({ index: 0, useInlineStyles: true }));

      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(patchUseInlineStylesMock).not.toHaveBeenCalled();
      if (type === 'key') expect(keyLegacyUpdateMock).toHaveBeenCalledOnce();
      else if (type === 'stat')
        expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
      else if (type === 'graph')
        expect(graphUpdatePositionsMock).toHaveBeenCalledOnce();
      else expect(knobUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it('single key useInlineStyles는 stale index 대신 선택 ID를 쓴다', () => {
    const selectedId = 'f2333333-3333-4333-8333-333333333333';
    const otherId = 'f2444444-4444-4444-8444-444444444444';
    const position = { dx: 0, dy: 0, width: 60, height: 60 };
    useKeyStore.setState({
      keyMappings: { '4key': ['A', 'B'] },
      positions: {
        '4key': [
          { ...position, id: selectedId },
          { ...position, id: otherId },
        ] as never,
      },
      canonicalPositions: {
        '4key': [
          { ...position, id: selectedId },
          { ...position, id: otherId },
        ] as never,
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: selectedId, index: 1 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);
    const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
      onKeyUpdate: (update: Record<string, unknown>) => void;
    };

    act(() => props.onKeyUpdate({ index: 1, useInlineStyles: true }));

    expect(patchUseInlineStylesMock).toHaveBeenCalledWith(
      'key',
      selectedId,
      true,
    );
  });

  it.each([
    ['main', 'main'],
    ['panel', 'panel'],
  ] as const)(
    '$label mixed 4-type stable useInlineStyles batch는 ID target 한 commit만 쓴다',
    (_label, windowType) => {
      window.__dmn_window_type = windowType;
      const targets = [
        {
          elementType: 'key' as const,
          id: 'f3000000-0000-4000-8000-000000000001',
        },
        {
          elementType: 'stat' as const,
          id: 'f3000000-0000-4000-8000-000000000002',
        },
        {
          elementType: 'graph' as const,
          id: 'f3000000-0000-4000-8000-000000000003',
        },
        {
          elementType: 'knob' as const,
          id: 'f3000000-0000-4000-8000-000000000004',
        },
      ];
      useGridSelectionStore.setState({
        selectedElements: targets.map(({ elementType: type, id }, index) => ({
          type,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };

      act(() => props.handleBatchStyleChangeComplete('useInlineStyles', true));

      if (windowType === 'panel') {
        expect(patchUseInlineStylesViaAuthorityMock).toHaveBeenCalledWith(
          targets,
          true,
        );
        expect(patchUseInlineStylesTargetsMock).not.toHaveBeenCalled();
      } else {
        expect(patchUseInlineStylesTargetsMock).toHaveBeenCalledWith(
          targets,
          true,
        );
        expect(patchUseInlineStylesViaAuthorityMock).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    ['key synthetic', 'key', 'key-0'],
    ['key empty', 'key', ''],
    ['stat synthetic', 'stat', 'stat-0'],
    ['stat empty', 'stat', ''],
  ] as const)(
    'panel single %s fontFamily는 기존 writer로 폴백한다',
    (_label, type, id) => {
      window.__dmn_window_type = 'panel';
      if (type === 'key') {
        const position = { dx: 0, dy: 0, width: 60, height: 60, id };
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] as never },
          canonicalPositions: { '4key': [position] as never },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onKeyUpdate: (update: Record<string, unknown>) => void;
        handleStatUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => {
        const handler =
          type === 'key' ? props.onKeyUpdate : props.handleStatUpdate;
        handler({ index: 0, fontFamily: 'Legacy Family' });
      });

      expect(patchFontFamilyMock).not.toHaveBeenCalled();
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      if (type === 'key') expect(keyLegacyUpdateMock).toHaveBeenCalledOnce();
      else expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['synthetic', 'graph-0'],
    ['empty', ''],
  ] as const)(
    'panel mixed useInlineStyles batch에 $label ID가 있으면 전체 legacy로 폴백한다',
    (_label, legacyId) => {
      window.__dmn_window_type = 'panel';
      useGridSelectionStore.setState({
        selectedElements: [
          {
            type: 'key',
            id: 'f4000000-0000-4000-8000-000000000001',
            index: 0,
          },
          { type: 'graph', id: legacyId, index: 0 },
        ],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };

      act(() => props.handleBatchStyleChangeComplete('useInlineStyles', true));

      expect(patchUseInlineStylesTargetsMock).not.toHaveBeenCalled();
      expect(patchUseInlineStylesViaAuthorityMock).not.toHaveBeenCalled();
      expect(legacyBatchStyleCommitMock).toHaveBeenCalledWith(
        'useInlineStyles',
        true,
      );
    },
  );

  it.each([
    ['main', 'key'],
    ['main', 'stat'],
    ['panel', 'key'],
    ['panel', 'stat'],
  ] as const)(
    '%s single stable %s fontFamily는 선택 ID의 top-level leaf만 쓴다',
    (windowType, type) => {
      window.__dmn_window_type = windowType;
      const id =
        type === 'key'
          ? 'f5555555-5555-4555-8555-555555555551'
          : 'f5555555-5555-4555-8555-555555555552';
      if (type === 'key') {
        const position = { dx: 0, dy: 0, width: 60, height: 60, id };
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] as never },
          canonicalPositions: { '4key': [position] as never },
        });
      } else {
        useStatItemStore.setState({
          positions: {
            '4key': [
              { ...useStatItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onKeyUpdate: (update: Record<string, unknown>) => void;
        handleStatUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => {
        const handler =
          type === 'key' ? props.onKeyUpdate : props.handleStatUpdate;
        handler({ index: 0, fontFamily: '  Raw Family  ' });
      });

      if (windowType === 'panel') {
        expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
          elementType: type,
          id,
          patch: { fontFamily: '  Raw Family  ' },
        });
        expect(patchFontFamilyMock).not.toHaveBeenCalled();
      } else {
        expect(patchFontFamilyMock).toHaveBeenCalledWith(
          type,
          id,
          '  Raw Family  ',
        );
        expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main', 'key'],
    ['main', 'stat'],
    ['main', 'graph'],
    ['main', 'knob'],
    ['panel', 'key'],
    ['panel', 'stat'],
    ['panel', 'graph'],
    ['panel', 'knob'],
  ] as const)(
    '%s single stable %s inactiveImage load와 reset은 exact 경로만 쓴다',
    (windowType, type) => {
      window.__dmn_window_type = windowType;
      const id = `${
        type === 'key'
          ? 'a'
          : type === 'stat'
          ? 'b'
          : type === 'graph'
          ? 'c'
          : 'd'
      }8888888-8888-4888-8888-888888888888`;
      if (type === 'key') {
        const position = { dx: 0, dy: 0, width: 60, height: 60, id };
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] as never },
          canonicalPositions: { '4key': [position] as never },
        });
      } else if (type === 'stat') {
        useStatItemStore.setState({
          positions: {
            '4key': [
              { ...useStatItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      } else if (type === 'graph') {
        useGraphItemStore.setState({
          positions: {
            '4key': [
              { ...useGraphItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      } else {
        useKnobItemStore.setState({
          positions: {
            '4key': [
              { ...useKnobItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props =
        type === 'graph'
          ? singleGraphPropsMock.mock.lastCall?.[0]
          : type === 'knob'
          ? singleKnobPropsMock.mock.lastCall?.[0]
          : singleKeyStatPropsMock.mock.lastCall?.[0];
      const commit = (
        props as { onInactiveImageCommit: (value: string) => void }
      ).onInactiveImageCommit;

      act(() => {
        commit('  /tmp/raw image.png  ');
        commit('');
      });

      if (windowType === 'panel') {
        expect(patchPropertyViaAuthorityMock).toHaveBeenNthCalledWith(1, {
          elementType: type,
          id,
          patch: { inactiveImage: '  /tmp/raw image.png  ' },
        });
        expect(patchPropertyViaAuthorityMock).toHaveBeenNthCalledWith(2, {
          elementType: type,
          id,
          patch: { inactiveImage: '' },
        });
        expect(patchInactiveImageMock).not.toHaveBeenCalled();
      } else {
        expect(patchInactiveImageMock).toHaveBeenNthCalledWith(
          1,
          type,
          id,
          '  /tmp/raw image.png  ',
        );
        expect(patchInactiveImageMock).toHaveBeenNthCalledWith(2, type, id, '');
        expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
      expect(graphUpdatePositionsMock).not.toHaveBeenCalled();
      expect(knobUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main', 'main'],
    ['panel', 'panel'],
  ] as const)(
    '%s mixed 4-type fontFamily는 stable ID target 한 commit만 쓴다',
    (_label, windowType) => {
      window.__dmn_window_type = windowType;
      const targets = [
        {
          elementType: 'key' as const,
          id: 'f5666666-6666-4666-8666-666666666661',
        },
        {
          elementType: 'stat' as const,
          id: 'f5666666-6666-4666-8666-666666666662',
        },
        {
          elementType: 'graph' as const,
          id: 'f5666666-6666-4666-8666-666666666663',
        },
        {
          elementType: 'knob' as const,
          id: 'f5666666-6666-4666-8666-666666666664',
        },
      ];
      useGridSelectionStore.setState({
        selectedElements: targets.map(({ elementType: type, id }, index) => ({
          type,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };

      act(() =>
        props.handleBatchStyleChangeComplete('fontFamily', 'Family One'),
      );

      if (windowType === 'panel') {
        expect(patchFontFamilyViaAuthorityMock).toHaveBeenCalledWith(targets, {
          fontFamily: 'Family One',
        });
        expect(patchFontFamilyTargetsMock).not.toHaveBeenCalled();
      } else {
        expect(patchFontFamilyTargetsMock).toHaveBeenCalledWith(targets, {
          fontFamily: 'Family One',
        });
        expect(patchFontFamilyViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(legacyBatchStyleCommitMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['synthetic', 'graph-0'],
    ['empty', ''],
  ] as const)(
    'panel mixed fontFamily batch에 %s ID가 있으면 전체 legacy로 폴백한다',
    (_label, legacyId) => {
      window.__dmn_window_type = 'panel';
      useGridSelectionStore.setState({
        selectedElements: [
          {
            type: 'key',
            id: 'f5777777-7777-4777-8777-777777777771',
            index: 0,
          },
          { type: 'graph', id: legacyId, index: 0 },
        ],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };

      act(() =>
        props.handleBatchStyleChangeComplete('fontFamily', 'Legacy Family'),
      );

      expect(patchFontFamilyTargetsMock).not.toHaveBeenCalled();
      expect(patchFontFamilyViaAuthorityMock).not.toHaveBeenCalled();
      expect(legacyBatchStyleCommitMock).toHaveBeenCalledWith(
        'fontFamily',
        'Legacy Family',
      );
    },
  );

  it.each([
    ['main', 'key', { fontWeight: 700 }],
    ['main', 'key', { fontItalic: true }],
    ['main', 'key', { fontUnderline: true }],
    ['main', 'key', { fontStrikethrough: true }],
    ['main', 'stat', { fontWeight: 400 }],
    ['main', 'stat', { fontItalic: false }],
    ['main', 'stat', { fontUnderline: false }],
    ['main', 'stat', { fontStrikethrough: false }],
    ['panel', 'key', { fontWeight: 700 }],
    ['panel', 'key', { fontItalic: true }],
    ['panel', 'key', { fontUnderline: true }],
    ['panel', 'key', { fontStrikethrough: true }],
    ['panel', 'stat', { fontWeight: 400 }],
    ['panel', 'stat', { fontItalic: false }],
    ['panel', 'stat', { fontUnderline: false }],
    ['panel', 'stat', { fontStrikethrough: false }],
  ] as const)(
    '%s single stable %s font style %j은 선택 ID의 exact leaf만 쓴다',
    (windowType, type, patch) => {
      window.__dmn_window_type = windowType;
      const id =
        type === 'key'
          ? 'f5111111-1111-4111-8111-111111111111'
          : 'f5222222-2222-4222-8222-222222222222';
      if (type === 'key') {
        const position = { dx: 0, dy: 0, width: 60, height: 60, id };
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: { '4key': [position] as never },
          canonicalPositions: { '4key': [position] as never },
        });
      } else {
        useStatItemStore.setState({
          positions: {
            '4key': [
              { ...useStatItemStore.getState().positions['4key'][0], id },
            ],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onKeyUpdate: (update: Record<string, unknown>) => void;
        handleStatUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => {
        const handler =
          type === 'key' ? props.onKeyUpdate : props.handleStatUpdate;
        handler({ index: 0, ...patch });
      });

      if (windowType === 'panel') {
        expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
          elementType: type,
          id,
          patch,
        });
        expect(patchFontStyleMock).not.toHaveBeenCalled();
      } else {
        expect(patchFontStyleMock).toHaveBeenCalledWith(type, id, patch);
        expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
      expect(statUpdatePositionsMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key synthetic', 'key', 'key-0'],
    ['key empty', 'key', ''],
    ['stat synthetic', 'stat', 'stat-0'],
    ['stat empty', 'stat', ''],
  ] as const)(
    'panel single %s font style은 기존 writer로 폴백한다',
    (_label, type, id) => {
      window.__dmn_window_type = 'panel';
      if (type === 'key') {
        useKeyStore.setState({
          keyMappings: { '4key': ['A'] },
          positions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
          canonicalPositions: {
            '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type, id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onKeyUpdate: (update: Record<string, unknown>) => void;
        handleStatUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => {
        const handler =
          type === 'key' ? props.onKeyUpdate : props.handleStatUpdate;
        handler({ index: 0, fontItalic: true });
      });

      expect(patchFontStyleMock).not.toHaveBeenCalled();
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      if (type === 'key') expect(keyLegacyUpdateMock).toHaveBeenCalledOnce();
      else expect(statUpdatePositionsMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['main', { fontWeight: 700 }],
    ['main', { fontItalic: true }],
    ['main', { fontUnderline: true }],
    ['main', { fontStrikethrough: true }],
    ['panel', { fontWeight: 400 }],
    ['panel', { fontItalic: false }],
    ['panel', { fontUnderline: false }],
    ['panel', { fontStrikethrough: false }],
  ] as const)(
    '%s mixed 4-type font style %j은 ID target 한 commit만 쓴다',
    (windowType, patch) => {
      window.__dmn_window_type = windowType;
      const targets = [
        {
          elementType: 'key' as const,
          id: 'f5333333-3333-4333-8333-333333333331',
        },
        {
          elementType: 'stat' as const,
          id: 'f5333333-3333-4333-8333-333333333332',
        },
        {
          elementType: 'graph' as const,
          id: 'f5333333-3333-4333-8333-333333333333',
        },
        {
          elementType: 'knob' as const,
          id: 'f5333333-3333-4333-8333-333333333334',
        },
      ];
      useGridSelectionStore.setState({
        selectedElements: targets.map(({ elementType: type, id }, index) => ({
          type,
          id,
          index,
        })),
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };
      const [property, value] = Object.entries(patch)[0];

      act(() => props.handleBatchStyleChangeComplete(property, value));

      if (windowType === 'panel') {
        expect(patchFontStyleViaAuthorityMock).toHaveBeenCalledWith(
          targets,
          patch,
        );
        expect(patchFontStyleTargetsMock).not.toHaveBeenCalled();
      } else {
        expect(patchFontStyleTargetsMock).toHaveBeenCalledWith(targets, patch);
        expect(patchFontStyleViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(legacyBatchStyleCommitMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['synthetic', 'graph-0'],
    ['empty', ''],
  ] as const)(
    'panel mixed font style batch에 %s ID가 있으면 전체 legacy로 폴백한다',
    (_label, legacyId) => {
      window.__dmn_window_type = 'panel';
      useGridSelectionStore.setState({
        selectedElements: [
          {
            type: 'key',
            id: 'f5444444-4444-4444-8444-444444444441',
            index: 0,
          },
          { type: 'graph', id: legacyId, index: 0 },
        ],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };

      act(() => props.handleBatchStyleChangeComplete('fontUnderline', true));

      expect(patchFontStyleTargetsMock).not.toHaveBeenCalled();
      expect(patchFontStyleViaAuthorityMock).not.toHaveBeenCalled();
      expect(legacyBatchStyleCommitMock).toHaveBeenCalledWith(
        'fontUnderline',
        true,
      );
    },
  );

  it.each([
    ['main', { noteEffectEnabled: false }],
    ['main', { noteAutoYCorrection: true }],
    ['main', { noteGlowEnabled: false }],
    ['main', { noteAlignment: 'right' }],
    ['main', { noteBorderSide: 'horizontal' }],
    ['panel', { noteEffectEnabled: true }],
    ['panel', { noteAutoYCorrection: false }],
    ['panel', { noteGlowEnabled: true }],
    ['panel', { noteAlignment: 'left' }],
    ['panel', { noteBorderSide: 'vertical' }],
  ] as const)(
    '%s single stable key note %j는 선택 ID exact leaf만 쓴다',
    (windowType, patch) => {
      window.__dmn_window_type = windowType;
      const id = 'f6111111-1111-4111-8111-111111111111';
      const position = { dx: 0, dy: 0, width: 60, height: 60, id };
      useKeyStore.setState({
        keyMappings: { '4key': ['A'] },
        positions: { '4key': [position] as never },
        canonicalPositions: { '4key': [position] as never },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onKeyUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.onKeyUpdate({ index: 0, ...patch }));

      if (windowType === 'panel') {
        expect(patchPropertyViaAuthorityMock).toHaveBeenCalledWith({
          elementType: 'key',
          id,
          patch,
        });
        expect(patchNotePropertyMock).not.toHaveBeenCalled();
      } else {
        expect(patchNotePropertyMock).toHaveBeenCalledWith(id, patch);
        expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['synthetic', 'key-0'],
    ['empty', ''],
  ] as const)(
    'panel single %s key note는 기존 writer로 폴백한다',
    (_label, id) => {
      window.__dmn_window_type = 'panel';
      useKeyStore.setState({
        keyMappings: { '4key': ['A'] },
        positions: {
          '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
        },
        canonicalPositions: {
          '4key': [{ dx: 0, dy: 0, width: 60, height: 60, id }] as never,
        },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id, index: 0 }],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = singleKeyStatPropsMock.mock.lastCall?.[0] as {
        onKeyUpdate: (update: Record<string, unknown>) => void;
      };

      act(() => props.onKeyUpdate({ index: 0, noteGlowEnabled: true }));

      expect(patchNotePropertyMock).not.toHaveBeenCalled();
      expect(patchPropertyViaAuthorityMock).not.toHaveBeenCalled();
      expect(keyLegacyUpdateMock).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ['main', { noteEffectEnabled: false }],
    ['main', { noteAutoYCorrection: false }],
    ['main', { noteGlowEnabled: true }],
    ['main', { noteAlignment: 'right' }],
    ['main', { noteBorderSide: 'horizontal' }],
    ['panel', { noteEffectEnabled: true }],
    ['panel', { noteAutoYCorrection: true }],
    ['panel', { noteGlowEnabled: false }],
    ['panel', { noteAlignment: 'left' }],
    ['panel', { noteBorderSide: 'vertical' }],
  ] as const)(
    '%s key-only note batch %j는 ID target 한 commit만 쓴다',
    (windowType, patch) => {
      window.__dmn_window_type = windowType;
      const ids = [
        'f6222222-2222-4222-8222-222222222221',
        'f6222222-2222-4222-8222-222222222222',
      ];
      useGridSelectionStore.setState({
        selectedElements: [
          { type: 'key', id: ids[0], index: 0 },
          { type: 'key', id: ids[1], index: 1 },
          { type: 'graph', id: 'graph-unrelated', index: 0 },
        ],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchKeyOnlyStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };
      const [property, value] = Object.entries(patch)[0];

      act(() => props.handleBatchKeyOnlyStyleChangeComplete(property, value));

      if (windowType === 'panel') {
        expect(patchNotePropertiesViaAuthorityMock).toHaveBeenCalledWith(
          ids,
          patch,
        );
        expect(patchNotePropertiesMock).not.toHaveBeenCalled();
      } else {
        expect(patchNotePropertiesMock).toHaveBeenCalledWith(ids, patch);
        expect(patchNotePropertiesViaAuthorityMock).not.toHaveBeenCalled();
      }
      expect(keyLegacyUpdateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['synthetic', 'key-0'],
    ['empty', ''],
  ] as const)(
    'panel key-only note batch에 %s ID가 있으면 전체 legacy로 폴백한다',
    (_label, legacyId) => {
      window.__dmn_window_type = 'panel';
      const stableId = 'f6333333-3333-4333-8333-333333333331';
      const positions = [stableId, legacyId].map((id) => ({
        dx: 0,
        dy: 0,
        width: 60,
        height: 60,
        id,
      }));
      useKeyStore.setState({
        keyMappings: { '4key': ['A', 'B'] },
        positions: { '4key': positions } as never,
        canonicalPositions: { '4key': positions } as never,
      });
      useGridSelectionStore.setState({
        selectedElements: [
          {
            type: 'key',
            id: stableId,
            index: 0,
          },
          { type: 'key', id: legacyId, index: 1 },
        ],
        selectedGroupIds: [],
      });
      mounted = mountPanel(true);
      const props = batchKeyLikePropsMock.mock.lastCall?.[0] as {
        handleBatchKeyOnlyStyleChangeComplete: (
          property: string,
          value: unknown,
        ) => void;
      };

      act(() =>
        props.handleBatchKeyOnlyStyleChangeComplete(
          'noteAutoYCorrection',
          false,
        ),
      );

      expect(patchNotePropertiesMock).not.toHaveBeenCalled();
      expect(patchNotePropertiesViaAuthorityMock).not.toHaveBeenCalled();
      expect(keyLegacyUpdateMock).toHaveBeenCalledTimes(2);
    },
  );

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
// 대상 전환 억제는 캔버스 선택 패널에서만 걸려야 한다.
// 플러그인 설정 세션은 캔버스 선택과 무관한데, 그 폼의 색상 피커까지 억제되면
// 무관한 선택 변경 뒤 피커가 닫힐 때 멀쩡한 색 편집이 폐기된다
describe('PropertiesPanel 편집 세션 scope 경계', () => {
  let mounted: MountedPanel;

  const scopedOf = (id: string) =>
    mounted.container
      .querySelector(`[data-testid="${id}"]`)
      ?.getAttribute('data-scoped');

  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    act(() => mounted.root.unmount());
    mounted.container.remove();
    document
      .querySelectorAll('[data-dmn-modal-backdrop], [data-dmn-popup-layer]')
      .forEach((node) => node.remove());
  });

  it('캔버스 선택 패널은 편집 세션 scope 안이다', () => {
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'stat', id: 'stat-0', index: 0 }],
      selectedGroupIds: [],
    });
    mounted = mountPanel(true);

    expect(scopedOf('single-key-stat')).toBe('true');
  });

  it('플러그인 설정 패널은 편집 세션 scope 밖이다', () => {
    usePropertiesPanelStore.setState({
      pluginSettingsPanel: {
        pluginId: 'scope-test',
        definition: { settings: {} },
        settings: {},
        originalSettings: {},
        onChange: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        resolve: vi.fn(),
      } as never,
    });
    mounted = mountPanel(true);

    expect(scopedOf('plugin-settings')).toBe('false');
  });
});

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
