// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { useGraphItemStore } from '@stores/data/useGraphItemStore';
import { useKnobItemStore } from '@stores/data/useKnobItemStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

import type { CompletionBinding } from '@src/renderer/contexts/EditSessionScope';

const captured = vi.hoisted(() => ({
  sound: null as null | {
    completionBinding?: CompletionBinding;
    onSoundSelect: (soundPath: string | null) => void;
  },
  font: null as null | {
    onFontSelect: (fontName: string | null) => void;
  },
  image: null as null | {
    completionBinding?: CompletionBinding;
    onIdleImageChange: (imageUrl: string) => void;
    onIdleImageReset: () => void;
    onActiveImageChange?: (imageUrl: string) => void;
    onActiveImageReset?: () => void;
    onIdleTransparentChange?: (value: boolean) => void;
    onActiveTransparentChange?: (value: boolean) => void;
  },
  animation: null as null | {
    completionBinding?: CompletionBinding;
    onAnimationChange: (
      animation: ReturnType<
        typeof createDefaultKeyPosition
      >['counter']['animation'],
    ) => void;
  },
  color: null as null | {
    referenceRef?: React.RefObject<HTMLElement>;
    stateMode?: string;
    onStateModeChange?: (mode: string) => void;
    onColorChange: (color: string) => void;
    onColorChangeComplete: (color: string) => void;
    onOpacityPercentChange?: (value: number) => void;
    onOpacityPercentChangeComplete?: (value: number) => void;
  },
  checkboxes: [] as Array<{ checked: boolean; onChange: () => void }>,
  dropdowns: [] as Array<{
    value: string;
    onChange: (value: string) => void;
  }>,
  numbers: [] as Array<{
    min?: number;
    max?: number;
    onPreview?: (value: number) => void;
    onChange: (value: number) => void;
  }>,
  optionalNumbers: [] as Array<{
    value?: number;
    prefix?: string;
    suffix?: string;
    min?: number;
    max?: number;
    onChange: (value?: number) => void;
  }>,
  fontStyles: [] as Array<{
    onBoldChange: (value: boolean) => void;
    onItalicChange: (value: boolean) => void;
    onUnderlineChange: (value: boolean) => void;
    onStrikethroughChange: (value: boolean) => void;
  }>,
  shadows: [] as Array<{
    onChange: (
      state: 'idle' | 'active',
      shadow: ReturnType<typeof shadowSpec>,
      patch: Partial<ReturnType<typeof shadowSpec>>,
    ) => void;
    onEnabledChange: (enabled: boolean) => void;
  }>,
}));

const patches = vi.hoisted(() => ({
  onElementPropertyCommit: vi.fn(),
  patchElementPropertyByTargetsViaAuthority: vi.fn(async () => true),
  patchCounterBooleanByTargetsViaAuthority: vi.fn(async () => true),
  patchInactiveImageByTargets: vi.fn(async () => true),
  patchInactiveImageViaAuthority: vi.fn(async () => true),
  patchActiveImageByTargets: vi.fn(async () => true),
  patchActiveImageViaAuthority: vi.fn(async () => true),
  patchIdleTransparentByTargets: vi.fn(async () => true),
  patchIdleTransparentViaAuthority: vi.fn(async () => true),
  patchActiveTransparentByTargets: vi.fn(async () => true),
  patchActiveTransparentViaAuthority: vi.fn(async () => true),
  patchSoundPathByIds: vi.fn(async () => true),
  patchSoundPathViaAuthority: vi.fn(async () => true),
  patchSoundEnabledByIds: vi.fn(async () => true),
  patchSoundEnabledViaAuthority: vi.fn(async () => true),
  patchSoundVolumeByIds: vi.fn(async () => true),
  patchSoundVolumeViaAuthority: vi.fn(async () => true),
  patchCounterAnimationPresetByTargets: vi.fn(async () => true),
  patchCounterAnimationPresetViaAuthority: vi.fn(async () => true),
  patchCounterEnabledByTargets: vi.fn(async () => true),
  patchCounterAnimationEnabledByTargets: vi.fn(async () => true),
  patchCounterEnabledViaAuthority: vi.fn(async () => true),
  patchCounterAnimationEnabledViaAuthority: vi.fn(async () => true),
  patchCounterLayoutByTargets: vi.fn(async () => true),
  patchCounterLayoutViaAuthority: vi.fn(async () => true),
  patchCounterTypographyByTargets: vi.fn(async () => true),
  patchCounterTypographyViaAuthority: vi.fn(async () => true),
  patchCounterStrokeByTargets: vi.fn(async () => true),
  patchCounterStrokeViaAuthority: vi.fn(async () => true),
  patchCounterFillByTargets: vi.fn(async () => true),
  patchCounterFillViaAuthority: vi.fn(async () => true),
  patchFontColorByTargets: vi.fn(async () => true),
  patchFontColorViaAuthority: vi.fn(async () => true),
  patchPaintByTargets: vi.fn(async () => true),
  patchPaintViaAuthority: vi.fn(async () => true),
  patchShadowByTargets: vi.fn(async () => true),
  patchShadowViaAuthority: vi.fn(async () => true),
  patchNotePaintByIds: vi.fn(async () => true),
  patchNotePaintViaAuthority: vi.fn(async () => true),
  patchDisplayTextByTargets: vi.fn(async () => true),
  patchDisplayTextViaAuthority: vi.fn(async () => true),
}));

const gestures = vi.hoisted(() => ({
  preview: vi.fn(),
  cancel: vi.fn(),
  settleCommit: vi.fn(),
  activeGestureId: vi.fn(() => 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
}));

vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchElementPropertyByTargetsViaAuthority:
    patches.patchElementPropertyByTargetsViaAuthority,
  patchCounterBooleanByTargetsViaAuthority:
    patches.patchCounterBooleanByTargetsViaAuthority,
  patchActiveImageByTargets: patches.patchActiveImageByTargets,
  patchInactiveImageByTargets: patches.patchInactiveImageByTargets,
  patchIdleTransparentByTargets: patches.patchIdleTransparentByTargets,
  patchActiveTransparentByTargets: patches.patchActiveTransparentByTargets,
  patchSoundPathByIds: patches.patchSoundPathByIds,
  patchSoundEnabledByIds: patches.patchSoundEnabledByIds,
  patchSoundVolumeByIds: patches.patchSoundVolumeByIds,
  patchCounterAnimationPresetByTargets:
    patches.patchCounterAnimationPresetByTargets,
  patchCounterEnabledByTargets: patches.patchCounterEnabledByTargets,
  patchCounterAnimationEnabledByTargets:
    patches.patchCounterAnimationEnabledByTargets,
  patchCounterLayoutByTargets: patches.patchCounterLayoutByTargets,
  patchCounterTypographyByTargets: patches.patchCounterTypographyByTargets,
  patchCounterStrokeByTargets: patches.patchCounterStrokeByTargets,
  patchCounterFillByTargets: patches.patchCounterFillByTargets,
  patchFontColorByTargets: patches.patchFontColorByTargets,
  patchPaintByTargets: patches.patchPaintByTargets,
  patchShadowByTargets: patches.patchShadowByTargets,
  patchNotePaintByIds: patches.patchNotePaintByIds,
  patchStylePropertyByTargets: patches.patchDisplayTextByTargets,
}));
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  patchActiveImageViaAuthority: patches.patchActiveImageViaAuthority,
  patchInactiveImageViaAuthority: patches.patchInactiveImageViaAuthority,
  patchIdleTransparentViaAuthority: patches.patchIdleTransparentViaAuthority,
  patchActiveTransparentViaAuthority:
    patches.patchActiveTransparentViaAuthority,
  patchSoundPathViaAuthority: patches.patchSoundPathViaAuthority,
  patchSoundEnabledViaAuthority: patches.patchSoundEnabledViaAuthority,
  patchSoundVolumeViaAuthority: patches.patchSoundVolumeViaAuthority,
  patchCounterAnimationPresetViaAuthority:
    patches.patchCounterAnimationPresetViaAuthority,
  patchCounterEnabledViaAuthority: patches.patchCounterEnabledViaAuthority,
  patchCounterAnimationEnabledViaAuthority:
    patches.patchCounterAnimationEnabledViaAuthority,
  patchCounterLayoutViaAuthority: patches.patchCounterLayoutViaAuthority,
  patchCounterTypographyViaAuthority:
    patches.patchCounterTypographyViaAuthority,
  patchCounterStrokeViaAuthority: patches.patchCounterStrokeViaAuthority,
  patchCounterFillViaAuthority: patches.patchCounterFillViaAuthority,
  patchFontColorViaAuthority: patches.patchFontColorViaAuthority,
  patchPaintViaAuthority: patches.patchPaintViaAuthority,
  patchShadowViaAuthority: patches.patchShadowViaAuthority,
  patchNotePaintViaAuthority: patches.patchNotePaintViaAuthority,
  patchStylePropertyViaAuthority: patches.patchDisplayTextViaAuthority,
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: vi.fn(),
  reportElementOpSkipped: vi.fn(),
}));
vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@components/main/Modal/content/pickers/SoundPicker', () => ({
  default: (props: (typeof captured)['sound']) => {
    captured.sound = props;
    return null;
  },
}));
vi.mock(
  '@components/main/Modal/content/pickers/CounterAnimationPicker',
  () => ({
    default: (props: (typeof captured)['animation']) => {
      captured.animation = props;
      return null;
    },
  }),
);
vi.mock('@components/main/Modal/content/pickers/ImagePicker', () => ({
  default: (props: (typeof captured)['image']) => {
    captured.image = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: (props: NonNullable<(typeof captured)['color']>) => {
    captured.color = props;
    return null;
  },
}));
vi.mock('@components/main/common/Checkbox', () => ({
  default: (props: { checked: boolean; onChange: () => void }) => {
    captured.checkboxes.push(props);
    return <button data-testid="mock-checkbox" onClick={props.onChange} />;
  },
}));
vi.mock('@components/main/common/Dropdown', () => ({
  default: (props: { value: string; onChange: (value: string) => void }) => {
    captured.dropdowns.push(props);
    return null;
  },
}));
vi.mock(
  '@components/main/Grid/PropertiesPanel/PropertyInputs',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('@components/main/Grid/PropertiesPanel/PropertyInputs')
    >();
    return {
      ...actual,
      NumberInput: (props: {
        min?: number;
        max?: number;
        onPreview?: (value: number) => void;
        onChange: (value: number) => void;
      }) => {
        captured.numbers.push(props);
        return null;
      },
      OptionalNumberInput: (
        props: (typeof captured.optionalNumbers)[number],
      ) => {
        captured.optionalNumbers.push(props);
        return null;
      },
      FontStyleToggle: (props: {
        onBoldChange: (value: boolean) => void;
        onItalicChange: (value: boolean) => void;
        onUnderlineChange: (value: boolean) => void;
        onStrikethroughChange: (value: boolean) => void;
      }) => {
        captured.fontStyles.push(props);
        return null;
      },
    };
  },
);
vi.mock('@components/main/Modal/content/pickers/FontPicker', () => ({
  default: (props: (typeof captured)['font']) => {
    captured.font = props;
    return null;
  },
}));
vi.mock('@components/main/Grid/PropertiesPanel/ShadowControls', () => ({
  default: (props: (typeof captured.shadows)[number]) => {
    captured.shadows.push(props);
    return null;
  },
}));
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    preview: gestures.preview,
    cancel: gestures.cancel,
    settleCommit: gestures.settleCommit,
    activeGestureId: gestures.activeGestureId,
    commitPendingAsync: vi.fn(async () => true),
  },
}));

import { PanelNavProvider } from '@components/main/Grid/PropertiesPanel/PanelNavContext';
import { BatchKeyLikePanel as ActualBatchKeyLikePanel } from '@components/main/Grid/PropertiesPanel/batch/BatchSelectionPanel';
import {
  BatchGraphOnlyPanel,
  BatchKnobOnlyPanel,
} from '@components/main/Grid/PropertiesPanel/batch/BatchSelectionPanel';
import { BATCH_STYLE_SOUND_PAGE_KEY } from '@components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent';
import { BATCH_COUNTER_ANIMATION_PAGE_KEY } from '@components/main/Grid/PropertiesPanel/batch/BatchCounterTabContent';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const keyAt = (id: string) => ({ ...createDefaultKeyPosition(), id });

const shadowSpec = () => ({
  enabled: true,
  color: '#0008',
  offsetX: 0,
  offsetY: 4,
  blur: 10,
});

type RemovedLegacyPanelProps = {
  handleBatchCounterUpdate?: (...args: unknown[]) => void;
  handleBatchKeyOnlyStyleChange?: (...args: unknown[]) => void;
  handleBatchKeyOnlyStyleChangeComplete?: (...args: unknown[]) => void;
  handleKeyOnlyStyleChangeComplete?: (...args: unknown[]) => void;
  handleBatchStyleChange?: (...args: unknown[]) => void;
  handleBatchStyleChangeComplete?: (...args: unknown[]) => void;
};
type PanelProps = React.ComponentProps<typeof ActualBatchKeyLikePanel> &
  RemovedLegacyPanelProps;

const BatchKeyLikePanel = ({
  handleBatchCounterUpdate: _handleBatchCounterUpdate,
  handleBatchKeyOnlyStyleChange: _handleBatchKeyOnlyStyleChange,
  handleBatchKeyOnlyStyleChangeComplete: _handleBatchKeyOnlyStyleChangeComplete,
  handleKeyOnlyStyleChangeComplete: _handleKeyOnlyStyleChangeComplete,
  handleBatchStyleChange: _handleBatchStyleChange,
  handleBatchStyleChangeComplete: _handleBatchStyleChangeComplete,
  ...props
}: PanelProps) => <ActualBatchKeyLikePanel {...props} />;

const mixedValue = <T,>(_getter: unknown, defaultValue: T) => ({
  isMixed: false,
  value: defaultValue,
});

// 프로덕션 배선 고정: 결합 소유자는 EditSessionBoundary 밖 패널이고,
// open 판정은 activePageKey다. 이 테스트는 실제 BatchKeyLikePanel과 실제
// EditSessionBoundary(선택 지문 리마운트)를 사용한다
describe('배치 피커 결합 소유권 (프로덕션 배선)', () => {
  let host: HTMLDivElement;
  let pageHost: HTMLDivElement;
  let root: Root;
  const pendingFrames = new Set<number>();

  const clickSoundEnabled = () => {
    const label = Array.from(host.querySelectorAll('p')).find(
      (element) => element.textContent === 'propertiesPanel.keySoundEnabled',
    );
    const button = label?.parentElement?.querySelector('button');
    expect(button).not.toBeNull();
    act(() =>
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
  };

  const openFontColorPicker = async () => {
    const label = Array.from(host.querySelectorAll('p')).find(
      (element) => element.textContent === 'propertiesPanel.fontColor',
    );
    const button = label?.parentElement?.querySelector('button');
    expect(button).not.toBeNull();
    act(() =>
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(captured.color).not.toBeNull();
  };

  const waitForColorPicker = async (button: HTMLButtonElement) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      if (captured.color?.referenceRef?.current === button) return;
    }
    expect(captured.color?.referenceRef?.current).toBe(button);
  };

  const latestCounterDropdown = (value: string) =>
    [...captured.dropdowns].reverse().find((item) => item.value === value);

  const changeCounterGap = (value: number) =>
    act(() => {
      const gap = [...captured.numbers]
        .reverse()
        .find(({ max }) => max === 9999);
      expect(gap).toMatchObject({ min: 0, max: 9999 });
      gap?.onChange(value);
    });

  const changeSoundVolume = (value: number) =>
    act(() => {
      const volume = [...captured.numbers]
        .reverse()
        .find(({ max }) => max === 200);
      expect(volume).toMatchObject({ min: 0, max: 200 });
      volume?.onChange(value);
    });

  const selectKey = (id: string) => {
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(id)] },
      positions: { '4key': [keyAt(id)] },
    });
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id, index: 0 }],
    });
  };

  const panelProps = (): PanelProps => {
    const selected = useGridSelectionStore.getState().selectedElements;
    const keyElements = selected.filter((element) => element.type === 'key');
    const statElements = selected.filter((element) => element.type === 'stat');
    const graphElements = selected.filter(
      (element) => element.type === 'graph',
    );
    const knobElements = selected.filter((element) => element.type === 'knob');
    return {
      setPanelElement: vi.fn(),
      selectedBatchStyleElements: selected,
      selectedKeyElements: keyElements,
      selectedStatElements: statElements,
      selectedGraphElements: graphElements,
      selectedKnobElements: knobElements,
      selectedKeyLikeElements: [...keyElements, ...statElements],
      selectedGroupInfo: null,
      isRenaming: false,
      renameInputRef: createRef<HTMLInputElement | null>(),
      renameValue: '',
      setRenameValue: vi.fn(),
      renameCancelledRef: { current: false },
      handleRenameCommit: vi.fn(),
      handleRenameCancel: vi.fn(),
      handleRenameStart: vi.fn(),
      activeTab: 'style',
      setActiveTab: vi.fn(),
      handleBatchAlign: vi.fn(),
      handleBatchDistribute: vi.fn(),
      handleBatchSpacing: vi.fn(),
      handleBatchSpacingPreview: vi.fn(),
      handleBatchSpacingCommit: vi.fn(),
      getBatchSpacingValue: () => ({ isMixed: false, value: 0 }),
      handleBatchResize: vi.fn(),
      onElementPropertyCommit: patches.onElementPropertyCommit,
      handleBatchStyleChange: vi.fn(),
      handleBatchStyleChangeComplete: vi.fn(),
      handleBatchShadowChangeComplete: vi.fn(),
      handleBatchShadowEnabledChange: vi.fn(),
      handleBatchGradientCommit: vi.fn(),
      handleKeyOnlyStyleChangeComplete: vi.fn(),
      handleBatchCounterUpdate: vi.fn(),
      handleBatchNoteColorChange: vi.fn(),
      handleBatchNoteColorChangeComplete: vi.fn(),
      handleBatchGlowColorChange: vi.fn(),
      handleBatchGlowColorChangeComplete: vi.fn(),
      handleGraphBatchSharedSetting: vi.fn(),
      handleKnobBatchSharedSetting: vi.fn(),
      getMixedValue: mixedValue,
      getMixedValueBatch: mixedValue,
      getMixedValueGraphs: mixedValue,
      getMixedValueGraphsAsKey: mixedValue,
      getMixedValueKnobs: mixedValue,
      getMixedValueKnobsAsKey: mixedValue,
      getMixedValueKeysOnly: mixedValue,
      getMixedValueActiveCapable: mixedValue,
      handleActiveCapableStyleChangeComplete: vi.fn(),
      getSelectedKeysData: () => [],
      getSelectedGraphsData: () => [],
      getSelectedBatchStyleData: () => [],
      getSelectedKeyOnlyPositions: () => [],
      handleBatchKeyOnlyStyleChangeComplete: vi.fn(),
      handleBatchKeyOnlyStyleChange: vi.fn(),
      handleBatchNoteColorChangeKeysOnly: vi.fn(),
      handleBatchGlowColorChangeKeysOnly: vi.fn(),
      batchNoteColorButtonRef: createRef<HTMLButtonElement>(),
      batchGlowColorButtonRef: createRef<HTMLButtonElement>(),
      batchBorderColorButtonRef: createRef<HTMLButtonElement>(),
      batchCounterFillButtonRef: createRef<HTMLButtonElement>(),
      batchCounterStrokeButtonRef: createRef<HTMLButtonElement>(),
      batchImageButtonRef: {
        current: document.createElement('button'),
      },
      showBatchImagePicker: false,
      setShowBatchImagePicker: vi.fn(),
      batchPickerFor: null,
      setBatchPickerFor: vi.fn(),
      batchCounterColorState: 'idle',
      setBatchCounterColorState: vi.fn(),
      batchLocalColors: {
        noteColor: '#ffffff',
        glowColor: '#ffffff',
        borderColor: '#ffffff',
        borderOpacity: 100,
        fillIdle: '#ffffff',
        fillActive: '#ffffff',
        strokeIdle: '#ffffff',
        strokeActive: '#ffffff',
      },
      setBatchLocalColors: vi.fn(),
      batchLocalOpacities: { noteColor: 100, glowColor: 100 },
      setBatchLocalOpacities: vi.fn(),
      handleBatchPickerToggle: vi.fn(),
      handleBatchPickerColorChange: vi.fn(),
      handleBatchPickerColorChangeComplete: vi.fn(),
      handleBatchNotePickerColorChangeComplete: vi.fn(),
      handleBatchFillPickerColorChangeComplete: (color, semantic) =>
        semantic({ property: 'counterFillIdle', value: { color } }),
      getBatchPickerColor: () => '#ffffff',
      getBatchPickerRef: () => createRef<HTMLButtonElement>(),
      batchColorPickerInteractiveRefs: [],
      batchScrollRefFor: () => () => {},
      panelElement: null,
      useCustomCSS: false,
      selectedKeyType: '4key',
      t: (key: string) => key,
      batchCounterSettings: createDefaultKeyPosition().counter,
      batchKeyVisual: createDefaultKeyPosition(),
    } as unknown as PanelProps;
  };

  const renderPanel = (nav: {
    active: string | null;
    renderKey: string | null;
  }) => {
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: nav.active,
            renderPageKey: nav.renderKey,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          <BatchKeyLikePanel {...panelProps()} />
        </PanelNavProvider>,
      );
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = window.setTimeout(() => {
        pendingFrames.delete(id);
        callback(performance.now());
      }, 0);
      pendingFrames.add(id);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingFrames.delete(id);
      window.clearTimeout(id);
    });
    captured.sound = null;
    captured.font = null;
    captured.image = null;
    captured.animation = null;
    captured.color = null;
    captured.checkboxes.length = 0;
    captured.dropdowns.length = 0;
    captured.numbers.length = 0;
    captured.optionalNumbers.length = 0;
    captured.fontStyles.length = 0;
    captured.shadows.length = 0;
    selectKey(ID_A);
    host = document.createElement('div');
    pageHost = document.createElement('div');
    document.body.appendChild(host);
    document.body.appendChild(pageHost);
    root = createRoot(host);
  });

  afterEach(async () => {
    pendingFrames.forEach((id) => window.clearTimeout(id));
    pendingFrames.clear();
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
    pageHost.remove();
    delete window.__dmn_window_type;
    vi.unstubAllGlobals();
  });

  const selectCounterTargets = (keyId: string, statId: string) => {
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(keyId)] },
      positions: { '4key': [keyAt(keyId)] },
    });
    useStatItemStore.setState({
      positions: {
        '4key': [{ ...keyAt(statId), statType: 'kps' }],
      },
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: keyId, index: 0 },
        { type: 'stat', id: statId, index: 0 },
        { type: 'graph', id: 'graph-0', index: 0 },
      ],
    });
  };

  const renderCounterPanel = (
    legacy: PanelProps['handleBatchCounterUpdate'],
    pageKey: string = BATCH_COUNTER_ANIMATION_PAGE_KEY,
  ) => {
    const props = panelProps();
    props.activeTab = 'counter';
    props.handleBatchCounterUpdate = legacy;
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: pageKey,
            renderPageKey: pageKey,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          <BatchKeyLikePanel {...props} />
        </PanelNavProvider>,
      );
    });
  };

  const renderNotePanel = (
    legacy: PanelProps['handleBatchKeyOnlyStyleChangeComplete'],
  ) => {
    const props = panelProps();
    props.activeTab = 'note';
    props.handleBatchKeyOnlyStyleChangeComplete = legacy;
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          <BatchKeyLikePanel {...props} />
        </PanelNavProvider>,
      );
    });
  };

  it.each(['main', 'panel'] as const)(
    '%s batch counter picker는 open 시점 key/stat만 한 exact intent로 보낸다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const statA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const statB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      selectCounterTargets(ID_A, statA);
      const legacy = vi.fn();
      renderCounterPanel(legacy);
      expect(captured.animation?.completionBinding).toBe('element-id');

      selectCounterTargets(ID_B, statB);
      renderCounterPanel(legacy);
      act(() =>
        captured.animation!.onAnimationChange({
          ...createDefaultKeyPosition().counter.animation,
          presetId: 'preset-b',
          bezier: [0.2, 0, 0.8, 1],
          scale: 1.3,
          durationMs: 450,
        }),
      );

      const exact = {
        presetId: 'preset-b',
        applyPresetId: true,
        bezier: [0.2, 0, 0.8, 1],
        scale: 1.3,
        durationMs: 450,
      };
      const targets = [
        { elementType: 'key', id: ID_A },
        { elementType: 'stat', id: statA },
      ];
      if (windowType === 'panel') {
        expect(
          patches.patchCounterAnimationPresetViaAuthority,
        ).toHaveBeenCalledWith(targets, exact);
        expect(
          patches.patchCounterAnimationPresetByTargets,
        ).not.toHaveBeenCalled();
      } else {
        expect(
          patches.patchCounterAnimationPresetByTargets,
        ).toHaveBeenCalledWith(targets, exact);
        expect(
          patches.patchCounterAnimationPresetViaAuthority,
        ).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    'batch mixed active paint는 latest key와 knob subset만 %s authority로 보낸다',
    async (windowType) => {
      window.__dmn_window_type = windowType;
      const legacy = vi.fn();
      selectImageTargets('mixed', 'a');
      renderImagePanel('mixed', legacy);
      const allTargets = selectImageTargets('mixed', 'b');
      renderImagePanel('mixed', legacy);

      await commitBackgroundPaint('active', 'active-final');

      const targets = allTargets.filter(
        ({ elementType }) => elementType === 'key' || elementType === 'knob',
      );
      const patch = {
        property: 'activeBackgroundPaint',
        value: { color: 'active-final', gradient: null },
      } as const;
      if (windowType === 'panel') {
        expect(patches.patchPaintViaAuthority).toHaveBeenCalledWith(
          targets,
          patch,
        );
        expect(patches.patchPaintByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchPaintByTargets).toHaveBeenCalledWith(
          targets,
          patch,
        );
        expect(patches.patchPaintViaAuthority).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('batch active paint는 irrelevant synthetic stat/graph를 무시하고 stable key/knob만 쓴다', async () => {
    const legacy = vi.fn();
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: ID_A, index: 0 },
        { type: 'stat', id: 'stat-0', index: 0 },
        { type: 'graph', id: 'graph-0', index: 0 },
        { type: 'knob', id: ID_B, index: 0 },
      ],
    });
    renderImagePanel('mixed', legacy);

    await commitBackgroundPaint('active', 'active-stable');

    expect(patches.patchPaintByTargets).toHaveBeenCalledWith(
      [
        { elementType: 'key', id: ID_A },
        { elementType: 'knob', id: ID_B },
      ],
      {
        property: 'activeBackgroundPaint',
        value: { color: 'active-stable', gradient: null },
      },
    );
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['main', 'panel'] as const)(
    '%s batch noteGlowSize는 current key subset에 gesture 없이 exact commit한다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const keys = [keyAt(ID_A), keyAt(ID_B)];
      useKeyStore.setState({
        selectedKeyType: '4key',
        canonicalPositions: { '4key': keys },
        positions: { '4key': keys },
      });
      useGridSelectionStore.setState({
        selectedElements: [
          { type: 'key', id: ID_A, index: 0 },
          { type: 'stat', id: 'stat-0', index: 0 },
          { type: 'graph', id: 'graph-0', index: 0 },
          { type: 'knob', id: 'knob-0', index: 0 },
        ],
      });
      const legacy = vi.fn();
      renderNotePanel(legacy);
      act(() => {
        useGridSelectionStore.setState({
          selectedElements: [
            { type: 'key', id: ID_B, index: 1 },
            { type: 'stat', id: 'stat-0', index: 0 },
          ],
        });
      });
      renderNotePanel(legacy);
      const glow = captured.numbers
        .filter((input) => input.min === 0 && input.max === 50)
        .at(-1);
      act(() => glow?.onChange(20.5));

      const writer =
        windowType === 'panel'
          ? patches.patchDisplayTextViaAuthority
          : patches.patchDisplayTextByTargets;
      if (windowType === 'panel') {
        expect(writer).toHaveBeenCalledWith(
          [{ elementType: 'key', id: ID_B }],
          { property: 'noteGlowSize', value: 20.5 },
          undefined,
        );
      } else {
        expect(writer).toHaveBeenCalledWith(
          [{ elementType: 'key', id: ID_B }],
          { property: 'noteGlowSize', value: 20.5 },
          { gestureId: undefined },
        );
      }
      expect(gestures.preview).not.toHaveBeenCalled();
      expect(gestures.settleCommit).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s batch note numeric은 latest key에 nullable exact leaf를 gesture 없이 commit한다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const keys = [
        { ...keyAt(ID_A), noteOffsetX: 0, noteOffsetY: 0 },
        { ...keyAt(ID_B), noteOffsetX: 0, noteOffsetY: 0 },
      ];
      useKeyStore.setState({
        selectedKeyType: '4key',
        canonicalPositions: { '4key': keys },
        positions: { '4key': keys },
      });
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id: ID_A, index: 0 }],
      });
      const legacy = vi.fn();
      renderNotePanel(legacy);
      act(() => {
        useGridSelectionStore.setState({
          selectedElements: [{ type: 'key', id: ID_B, index: 1 }],
        });
      });
      renderNotePanel(legacy);
      const offsetX = captured.optionalNumbers
        .filter((input) => input.prefix === 'X')
        .at(-1);
      const offsetY = captured.optionalNumbers
        .filter((input) => input.prefix === 'Y')
        .at(-1);
      const width = captured.optionalNumbers
        .filter((input) => input.suffix === 'px' && input.min === 1)
        .at(-1);
      const borderWidth = captured.numbers
        .filter((input) => input.min === 0 && input.max === 20)
        .at(-1);
      const borderRadius = captured.numbers
        .filter((input) => input.min === 1 && input.max === 100)
        .at(-1);
      expect(offsetX?.value).toBeUndefined();
      act(() => offsetX?.onChange(0));
      act(() => offsetY?.onChange(undefined));
      act(() => width?.onChange(55.5));
      act(() => borderWidth?.onChange(2.5));
      act(() => borderRadius?.onChange(18.5));

      const writer =
        windowType === 'panel'
          ? patches.patchDisplayTextViaAuthority
          : patches.patchDisplayTextByTargets;
      const target = [{ elementType: 'key', id: ID_B }];
      const patchesInOrder = [
        { property: 'noteOffsetX', value: 0 },
        { property: 'noteOffsetY', value: null },
        { property: 'noteWidth', value: 55.5 },
        { property: 'noteBorderWidth', value: 2.5 },
        { property: 'noteBorderRadius', value: 18.5 },
      ];
      expect(writer).toHaveBeenCalledTimes(5);
      for (const [index, patch] of patchesInOrder.entries()) {
        expect(writer.mock.calls[index]).toEqual(
          windowType === 'panel'
            ? [target, patch, undefined]
            : [target, patch, { gestureId: undefined }],
        );
      }
      expect(gestures.preview).not.toHaveBeenCalled();
      expect(gestures.settleCommit).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s soundVolume commit은 current key subset만 쓴다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      act(() => selectKey(ID_A));
      renderPanel({ active: null, renderKey: null });
      act(() => selectKey(ID_B));
      renderPanel({ active: null, renderKey: null });

      changeSoundVolume(137.5);
      if (windowType === 'panel') {
        expect(patches.patchSoundVolumeViaAuthority).toHaveBeenCalledWith(
          [ID_B],
          137.5,
        );
        expect(patches.patchSoundVolumeByIds).not.toHaveBeenCalled();
      } else {
        expect(patches.patchSoundVolumeByIds).toHaveBeenCalledWith(
          [ID_B],
          137.5,
        );
        expect(patches.patchSoundVolumeViaAuthority).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s displayText actual input은 mixed 4-type stable IDs를 preview하고 같은 gesture로 commit한다',
    async (windowType) => {
      window.__dmn_window_type = windowType;
      const keyId = ID_A;
      const statId = ID_B;
      const graphId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const knobId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
      useKeyStore.setState({
        selectedKeyType: '4key',
        canonicalPositions: { '4key': [keyAt(otherId), keyAt(keyId)] },
        positions: { '4key': [keyAt(otherId), keyAt(keyId)] },
      });
      useStatItemStore.setState({
        positions: { '4key': [{ ...keyAt(statId), statType: 'kps' }] },
      });
      useGraphItemStore.setState({
        positions: { '4key': [keyAt(graphId)] } as never,
      });
      useKnobItemStore.setState({
        positions: { '4key': [keyAt(knobId)] } as never,
      });
      useGridSelectionStore.setState({
        selectedElements: [
          { type: 'key', id: keyId, index: 0 },
          { type: 'stat', id: statId, index: 0 },
          { type: 'graph', id: graphId, index: 0 },
          { type: 'knob', id: knobId, index: 0 },
        ],
      });
      renderPanel({ active: null, renderKey: null });
      const input = host.querySelector<HTMLInputElement>('input[type="text"]');
      expect(input).not.toBeNull();

      act(() => input?.focus());
      act(() => setInputValue(input!, '  Preview label  '));
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      expect(gestures.preview.mock.calls).toEqual([
        [
          '4key',
          [
            {
              id: keyId,
              patch: { displayText: '  Preview label  ' },
            },
          ],
          { domain: 'keyPosition' },
        ],
        [
          '4key',
          [
            {
              id: statId,
              patch: { displayText: '  Preview label  ' },
            },
          ],
          { domain: 'statPosition' },
        ],
        [
          '4key',
          [
            {
              id: graphId,
              patch: { displayText: '  Preview label  ' },
            },
          ],
          { domain: 'graphPosition' },
        ],
        [
          '4key',
          [
            {
              id: knobId,
              patch: { displayText: '  Preview label  ' },
            },
          ],
          { domain: 'knobPosition' },
        ],
      ]);
      act(() => input?.blur());

      const targets = [
        { elementType: 'key', id: keyId },
        { elementType: 'stat', id: statId },
        { elementType: 'graph', id: graphId },
        { elementType: 'knob', id: knobId },
      ];
      const writer =
        windowType === 'panel'
          ? patches.patchDisplayTextViaAuthority
          : patches.patchDisplayTextByTargets;
      expect(writer).toHaveBeenCalledWith(
        targets,
        { property: 'displayText', value: '  Preview label  ' },
        windowType === 'panel'
          ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
          : { gestureId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      );
      expect(gestures.settleCommit).toHaveBeenCalledWith(
        writer.mock.results[0]?.value,
      );
    },
  );

  it('displayText stable target 하나가 사라지면 partial preview 없이 중단한다', async () => {
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(ID_A)] },
      positions: { '4key': [keyAt(ID_A)] },
    });
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: ID_A, index: 0 },
        { type: 'graph', id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', index: 0 },
      ],
    });
    useGraphItemStore.setState({ positions: {} });
    renderPanel({ active: null, renderKey: null });
    const input = host.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => input.focus());
    act(() => setInputValue(input, 'Preview'));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(gestures.preview).not.toHaveBeenCalled();
  });

  type ClassNamePanelKind = 'mixed' | 'graph' | 'knob';

  const setClassNameTargets = (
    kind: ClassNamePanelKind,
    ids: readonly string[],
  ) => {
    const types =
      kind === 'mixed'
        ? (['key', 'stat', 'graph', 'knob'] as const)
        : ([kind] as const);
    const byType = new Map<string, string>(
      types.map((type, index) => [type, ids[index] ?? ''] as const),
    );
    const keyId = byType.get('key');
    const statId = byType.get('stat');
    const graphId = byType.get('graph');
    const knobId = byType.get('knob');
    if (keyId !== undefined) {
      useKeyStore.setState({
        selectedKeyType: '4key',
        positions: { '4key': [keyAt(keyId)] },
        canonicalPositions: { '4key': [keyAt(keyId)] },
      });
    }
    if (statId !== undefined) {
      useStatItemStore.setState({
        positions: { '4key': [{ ...keyAt(statId), statType: 'kps' }] },
      });
    }
    if (graphId !== undefined) {
      useGraphItemStore.setState({
        positions: { '4key': [keyAt(graphId)] } as never,
      });
    }
    if (knobId !== undefined) {
      useKnobItemStore.setState({
        positions: { '4key': [keyAt(knobId)] } as never,
      });
    }
    useGridSelectionStore.setState({
      selectedElements: types.map((type, index) => ({
        type,
        id: ids[index],
        index: 0,
      })),
    });
    return types.map((elementType, index) => ({
      elementType,
      id: ids[index],
    }));
  };

  const renderClassNamePanel = (
    kind: ClassNamePanelKind,
    legacyPreview: ReturnType<typeof vi.fn>,
    legacyCommit: ReturnType<typeof vi.fn>,
  ) => {
    const shared = {
      ...panelProps(),
      useCustomCSS: true,
      handleBatchStyleChange: legacyPreview,
      handleBatchStyleChangeComplete: legacyCommit,
      handleActiveCapableStyleChangeComplete: legacyCommit,
    };
    const panel =
      kind === 'mixed' ? (
        <BatchKeyLikePanel {...(shared as unknown as PanelProps)} />
      ) : kind === 'graph' ? (
        <BatchGraphOnlyPanel
          {...(shared as unknown as React.ComponentProps<
            typeof BatchGraphOnlyPanel
          >)}
        />
      ) : (
        <BatchKnobOnlyPanel
          {...(shared as unknown as React.ComponentProps<
            typeof BatchKnobOnlyPanel
          >)}
        />
      );
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          {panel}
        </PanelNavProvider>,
      );
    });
  };

  it.each([
    ['main', 'mixed'],
    ['panel', 'mixed'],
    ['main', 'graph'],
    ['panel', 'graph'],
    ['main', 'knob'],
    ['panel', 'knob'],
  ] as const)(
    '%s %s batch className actual input은 preview하고 같은 gesture로 commit한다',
    async (windowType, kind) => {
      window.__dmn_window_type = windowType;
      const ids =
        kind === 'mixed'
          ? [
              'a1111111-1111-4111-8111-111111111111',
              'a2222222-2222-4222-8222-222222222222',
              'a3333333-3333-4333-8333-333333333333',
              'a4444444-4444-4444-8444-444444444444',
            ]
          : kind === 'graph'
          ? ['a5555555-5555-4555-8555-555555555555']
          : ['a6666666-6666-4666-8666-666666666666'];
      const targets = setClassNameTargets(kind, ids);
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      renderClassNamePanel(kind, legacyPreview, legacyCommit);
      const input = host.querySelector<HTMLInputElement>(
        'input[placeholder="className"]',
      );
      expect(input).not.toBeNull();

      act(() => input?.focus());
      act(() => setInputValue(input!, '  Raw class  '));
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      expect(gestures.preview).toHaveBeenCalled();
      expect(
        gestures.preview.mock.calls.flatMap((call) =>
          (call[1] as Array<{ patch: unknown }>).map(({ patch }) => patch),
        ),
      ).toContainEqual({ className: '  Raw class  ' });
      act(() => input?.blur());

      const writer =
        windowType === 'panel'
          ? patches.patchDisplayTextViaAuthority
          : patches.patchDisplayTextByTargets;
      expect(writer).toHaveBeenCalledWith(
        targets,
        { property: 'className', value: '  Raw class  ' },
        windowType === 'panel'
          ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
          : { gestureId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      );
      expect(gestures.settleCommit).toHaveBeenCalledWith(
        writer.mock.results[0]?.value,
      );
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main idle', 'main', 'idle'],
    ['panel active', 'panel', 'active'],
  ] as const)(
    '%s mixed batch font color는 latest current type subset과 기존 gesture timing을 쓴다',
    async (_label, windowType, state) => {
      window.__dmn_window_type = windowType;
      const idsA = [
        'f1111111-1111-4111-8111-111111111111',
        'f2222222-2222-4222-8222-222222222222',
        'f3333333-3333-4333-8333-333333333333',
        'f4444444-4444-4444-8444-444444444444',
      ];
      const idsB = [
        'f5111111-1111-4111-8111-111111111111',
        'f5222222-2222-4222-8222-222222222222',
        'f5333333-3333-4333-8333-333333333333',
        'f5444444-4444-4444-8444-444444444444',
      ];
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      setClassNameTargets('mixed', idsA);
      renderClassNamePanel('mixed', legacyPreview, legacyCommit);
      setClassNameTargets('mixed', idsB);
      renderClassNamePanel('mixed', legacyPreview, legacyCommit);
      await openFontColorPicker();
      if (state === 'active') {
        act(() => captured.color?.onStateModeChange?.('active'));
      }
      gestures.preview.mockClear();
      gestures.settleCommit.mockClear();

      act(() => captured.color?.onColorChange('local-only'));
      expect(gestures.preview).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete(' final raw '));

      const targets = [
        { elementType: 'key' as const, id: idsB[0] },
        ...(state === 'idle'
          ? [
              { elementType: 'stat' as const, id: idsB[1] },
              { elementType: 'graph' as const, id: idsB[2] },
            ]
          : []),
        { elementType: 'knob' as const, id: idsB[3] },
      ];
      const patch =
        state === 'active'
          ? { property: 'activeFontColor', value: ' final raw ' }
          : { property: 'fontColor', value: ' final raw ' };
      const writer =
        windowType === 'panel'
          ? patches.patchFontColorViaAuthority
          : patches.patchFontColorByTargets;
      const gestureId =
        state === 'idle' ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' : undefined;
      if (windowType === 'panel') {
        expect(writer).toHaveBeenCalledWith(targets, patch, gestureId);
      } else {
        expect(writer).toHaveBeenCalledWith(
          targets,
          patch,
          gestureId === undefined ? {} : { gestureId },
        );
      }
      if (state === 'idle') {
        expect(gestures.preview).toHaveBeenCalled();
        expect(gestures.settleCommit).toHaveBeenCalledWith(
          writer.mock.results[0]?.value,
        );
      } else {
        expect(gestures.preview).not.toHaveBeenCalled();
        expect(gestures.settleCommit).not.toHaveBeenCalled();
      }
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
    },
  );

  it.each(['graph', 'knob'] as const)(
    '%s-only batch는 font color UI를 노출하지 않는다',
    (kind) => {
      setClassNameTargets(kind, [ID_A]);
      renderClassNamePanel(kind, vi.fn(), vi.fn());
      expect(
        Array.from(host.querySelectorAll('p')).some(
          (element) => element.textContent === 'propertiesPanel.fontColor',
        ),
      ).toBe(false);
    },
  );

  it.each([
    ['main', 'mixed', 'borderWidth', 0, 20, 12.5],
    ['panel', 'mixed', 'borderRadius', 0, 100, 88.5],
    ['main', 'mixed', 'fontSize', 8, 72, 31.5],
    ['panel', 'graph', 'borderWidth', 0, 20, 14.5],
    ['main', 'graph', 'borderRadius', 0, 100, 77.5],
    ['panel', 'knob', 'borderWidth', 0, 20, 18.5],
    ['main', 'knob', 'borderRadius', 0, 100, 99.5],
  ] as const)(
    '%s %s batch %s actual input은 current stable targets를 preview하고 commit한다',
    (windowType, kind, property, min, max, value) => {
      window.__dmn_window_type = windowType;
      const ids =
        kind === 'mixed'
          ? [
              'b1111111-1111-4111-8111-111111111111',
              'b2222222-2222-4222-8222-222222222222',
              'b3333333-3333-4333-8333-333333333333',
              'b4444444-4444-4444-8444-444444444444',
            ]
          : kind === 'graph'
          ? ['b5555555-5555-4555-8555-555555555555']
          : ['b6666666-6666-4666-8666-666666666666'];
      const targets = setClassNameTargets(kind, ids);
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      const captureStart = captured.numbers.length;
      renderClassNamePanel(kind, legacyPreview, legacyCommit);
      const input = captured.numbers
        .slice(captureStart)
        .find(
          (candidate) =>
            candidate.min === min &&
            candidate.max === max &&
            candidate.onPreview !== undefined,
        );
      expect(input).toBeDefined();
      expect(input?.onPreview).toBeTypeOf('function');

      act(() => input?.onPreview?.(value));
      expect(
        gestures.preview.mock.calls.flatMap((call) =>
          (call[1] as Array<{ patch: unknown }>).map(({ patch }) => patch),
        ),
      ).toContainEqual({ [property]: value });
      act(() => input?.onChange(value));

      const writer =
        windowType === 'panel'
          ? patches.patchDisplayTextViaAuthority
          : patches.patchDisplayTextByTargets;
      expect(writer).toHaveBeenCalledWith(
        targets,
        { property, value },
        windowType === 'panel'
          ? 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
          : { gestureId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' },
      );
      expect(gestures.settleCommit).toHaveBeenCalledWith(
        writer.mock.results[0]?.value,
      );
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
      if (kind === 'knob' && property === 'borderRadius') {
        expect(input).toMatchObject({ min: 0, max: 100 });
      }
    },
  );

  it('soundVolume은 graph/knob synthetic를 무시하고 stable key subset만 쓴다', () => {
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: ID_A, index: 0 },
        { type: 'graph', id: 'graph-0', index: 0 },
        { type: 'knob', id: 'knob-0', index: 0 },
      ],
    });
    renderPanel({ active: null, renderKey: null });

    changeSoundVolume(80);
    expect(patches.patchSoundVolumeByIds).toHaveBeenCalledWith([ID_A], 80);
  });

  it.each(['main', 'panel'] as const)(
    '%s batch counter bool 토글은 클릭 시점 current key/stat만 쓴다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const statA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const statB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const legacy = vi.fn();
      selectCounterTargets(ID_A, statA);
      renderCounterPanel(legacy);
      selectCounterTargets(ID_B, statB);
      renderCounterPanel(legacy);

      const currentCheckboxes = captured.checkboxes.slice(-2);
      act(() => currentCheckboxes[0]?.onChange());
      act(() => currentCheckboxes[1]?.onChange());
      const targets = [
        { elementType: 'key', id: ID_B },
        { elementType: 'stat', id: statB },
      ];
      if (windowType === 'panel') {
        expect(
          patches.patchCounterBooleanByTargetsViaAuthority.mock.calls,
        ).toEqual([
          [targets, { property: 'counterEnabled', value: false }],
          [targets, { property: 'counterAnimationEnabled', value: true }],
        ]);
        expect(patches.patchCounterEnabledByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchCounterEnabledByTargets).toHaveBeenCalledWith(
          targets,
          false,
        );
        expect(
          patches.patchCounterAnimationEnabledByTargets,
        ).toHaveBeenCalledWith(targets, true);
        expect(
          patches.patchCounterBooleanByTargetsViaAuthority,
        ).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s batch counter layout은 current key/stat에 4 exact leaf를 적용한다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const statA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const statB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const legacy = vi.fn();
      act(() => selectCounterTargets(ID_A, statA));
      renderCounterPanel(legacy);
      act(() => selectCounterTargets(ID_B, statB));
      renderCounterPanel(legacy);

      act(() => latestCounterDropdown('inside')?.onChange('outside'));
      act(() => latestCounterDropdown('bottom')?.onChange('right'));
      act(() => latestCounterDropdown('center')?.onChange('between'));
      changeCounterGap(9999);
      const targets = [
        { elementType: 'key', id: ID_B },
        { elementType: 'stat', id: statB },
      ];
      const calls = [
        [targets, { property: 'counterPlacement', value: 'outside' }],
        [targets, { property: 'counterAlign', value: 'right' }],
        [targets, { property: 'counterAlignMode', value: 'between' }],
        [targets, { property: 'counterGap', value: 9999 }],
      ];
      if (windowType === 'panel') {
        expect(patches.patchCounterLayoutViaAuthority.mock.calls).toEqual(
          calls,
        );
        expect(patches.patchCounterLayoutByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchCounterLayoutByTargets.mock.calls).toEqual(calls);
        expect(patches.patchCounterLayoutViaAuthority).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s batch counter typography는 current key/stat에 5 exact leaf를 적용한다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const statA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const statB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const legacy = vi.fn();
      act(() => selectCounterTargets(ID_A, statA));
      renderCounterPanel(legacy);
      act(() => selectCounterTargets(ID_B, statB));
      renderCounterPanel(legacy);

      const fontSize = captured.numbers
        .filter((input) => input.min === 8 && input.max === 72)
        .at(-1);
      const fontStyle = captured.fontStyles.at(-1);
      act(() => fontSize?.onChange(72));
      act(() => fontStyle?.onBoldChange(true));
      act(() => fontStyle?.onItalicChange(true));
      act(() => fontStyle?.onUnderlineChange(true));
      act(() => fontStyle?.onStrikethroughChange(true));
      const targets = [
        { elementType: 'key', id: ID_B },
        { elementType: 'stat', id: statB },
      ];
      const calls = [
        [targets, { property: 'counterFontSize', value: 72 }],
        [targets, { property: 'counterFontWeight', value: 700 }],
        [targets, { property: 'counterFontItalic', value: true }],
        [targets, { property: 'counterFontUnderline', value: true }],
        [targets, { property: 'counterFontStrikethrough', value: true }],
      ];
      if (windowType === 'panel') {
        expect(patches.patchCounterTypographyViaAuthority.mock.calls).toEqual(
          calls,
        );
        expect(patches.patchCounterTypographyByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchCounterTypographyByTargets.mock.calls).toEqual(
          calls,
        );
        expect(
          patches.patchCounterTypographyViaAuthority,
        ).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['main', 'panel'] as const)(
    '%s batch counter FontPicker는 open A가 아니라 최신 B key/stat targets에 적용한다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const statA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const statB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const legacy = vi.fn();
      act(() => selectCounterTargets(ID_A, statA));
      renderCounterPanel(legacy, 'batch-counter:font');
      act(() => selectCounterTargets(ID_B, statB));
      renderCounterPanel(legacy, 'batch-counter:font');

      act(() => captured.font?.onFontSelect('  Raw Counter Family  '));

      const targets = [
        { elementType: 'key', id: ID_B },
        { elementType: 'stat', id: statB },
      ];
      const args = [
        targets,
        { property: 'counterFontFamily', value: '  Raw Counter Family  ' },
      ];
      if (windowType === 'panel') {
        expect(patches.patchCounterTypographyViaAuthority).toHaveBeenCalledWith(
          ...args,
        );
        expect(patches.patchCounterTypographyByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchCounterTypographyByTargets).toHaveBeenCalledWith(
          ...args,
        );
        expect(
          patches.patchCounterTypographyViaAuthority,
        ).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['idle', 'active'] as const)(
    'batch counter stroke %s actual ColorPicker는 drag와 final callback을 분리한다',
    (state) => {
      const preview = vi.fn();
      const commit = vi.fn();
      const props = panelProps();
      props.activeTab = 'counter';
      props.batchPickerFor = 'stroke';
      props.batchCounterColorState = state;
      props.handleBatchPickerColorChange = preview;
      props.handleBatchPickerColorChangeComplete = commit;
      act(() => {
        root.render(
          <PanelNavProvider
            value={{
              activePageKey: null,
              renderPageKey: null,
              openPage: vi.fn(),
              closePage: vi.fn(),
              pageHost,
            }}
          >
            <BatchKeyLikePanel {...props} />
          </PanelNavProvider>,
        );
      });

      expect(captured.color?.stateMode).toBe(state);
      act(() => captured.color?.onColorChange('  local only  '));
      expect(preview).toHaveBeenCalledWith('  local only  ');
      expect(commit).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete('  final raw  '));
      expect(commit).toHaveBeenCalledWith('  final raw  ');
    },
  );

  it.each([
    ['main idle', 'main', 'idle'],
    ['panel active', 'panel', 'active'],
  ] as const)(
    '%s batch counter fill은 open A가 아니라 latest B key/stat targets에 solid descriptor를 보낸다',
    (_label, windowType, state) => {
      window.__dmn_window_type = windowType;
      const statA = 'c7111111-1111-4111-8111-111111111111';
      const statB = 'c7222222-2222-4222-8222-222222222222';
      const legacy = vi.fn();
      const renderFill = (keyId: string, statId: string) => {
        selectCounterTargets(keyId, statId);
        const currentKey = keyAt(keyId);
        const withGradient = {
          ...currentKey,
          counter: {
            ...currentKey.counter,
            fillIdleGradient: {
              angle: 45,
              stops: [
                { color: '#112233', pos: 0 },
                { color: '#445566', pos: 1 },
              ],
            },
          },
        };
        useKeyStore.setState({
          selectedKeyType: '4key',
          canonicalPositions: { '4key': [withGradient] },
          positions: { '4key': [withGradient] },
        });
        const props = panelProps();
        props.activeTab = 'counter';
        props.batchPickerFor = 'fill';
        props.batchCounterColorState = state;
        props.handleBatchCounterUpdate = legacy;
        props.handleBatchFillPickerColorChangeComplete = (color, semantic) =>
          semantic(
            state === 'active'
              ? { property: 'counterFillActive', value: { color } }
              : { property: 'counterFillIdle', value: { color } },
          );
        act(() => {
          root.render(
            <PanelNavProvider
              value={{
                activePageKey: null,
                renderPageKey: null,
                openPage: vi.fn(),
                closePage: vi.fn(),
                pageHost,
              }}
            >
              <BatchKeyLikePanel {...props} />
            </PanelNavProvider>,
          );
        });
      };

      renderFill(ID_A, statA);
      renderFill(ID_B, statB);
      act(() => captured.color?.onColorChange('drag-only'));
      expect(patches.patchCounterFillByTargets).not.toHaveBeenCalled();
      expect(patches.patchCounterFillViaAuthority).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete(' solid final '));

      const targets = [
        { elementType: 'key' as const, id: ID_B },
        ...(state === 'idle'
          ? [{ elementType: 'stat' as const, id: statB }]
          : []),
      ];
      const patch =
        state === 'active'
          ? { property: 'counterFillActive', value: { color: ' solid final ' } }
          : { property: 'counterFillIdle', value: { color: ' solid final ' } };
      if (windowType === 'panel') {
        expect(patches.patchCounterFillViaAuthority).toHaveBeenCalledWith(
          targets,
          patch,
        );
        expect(patches.patchCounterFillByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchCounterFillByTargets).toHaveBeenCalledWith(
          targets,
          patch,
        );
        expect(patches.patchCounterFillViaAuthority).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['active ignores synthetic stat', 'active', 'stat', true],
    ['active rejects synthetic key', 'active', 'key', false],
    ['idle rejects synthetic stat', 'idle', 'stat', false],
    ['idle rejects empty key', 'idle', 'key-empty', false],
  ] as const)(
    'batch counter fill %s',
    (_label, state, syntheticType, exact) => {
      const stableKeyId = 'c7333333-3333-4333-8333-333333333333';
      const other =
        syntheticType === 'stat'
          ? { type: 'stat' as const, id: 'stat-0', index: 0 }
          : {
              type: 'key' as const,
              id: syntheticType === 'key-empty' ? '' : 'key-0',
              index: 1,
            };
      const keyPositions = [
        keyAt(stableKeyId),
        keyAt(other.type === 'key' ? other.id : 'unused'),
      ];
      useKeyStore.setState({
        selectedKeyType: '4key',
        canonicalPositions: { '4key': keyPositions },
        positions: { '4key': keyPositions },
      });
      if (other.type === 'stat') {
        useStatItemStore.setState({
          positions: {
            '4key': [{ ...keyAt(other.id), statType: 'kps' }],
          },
        });
      }
      useGridSelectionStore.setState({
        selectedElements: [{ type: 'key', id: stableKeyId, index: 0 }, other],
      });
      const legacy = vi.fn();
      const props = panelProps();
      props.activeTab = 'counter';
      props.batchPickerFor = 'fill';
      props.batchCounterColorState = state;
      props.handleBatchCounterUpdate = legacy;
      props.handleBatchPickerColorChangeComplete = legacy;
      props.handleBatchFillPickerColorChangeComplete = (color, semantic) =>
        semantic(
          state === 'active'
            ? { property: 'counterFillActive', value: { color } }
            : { property: 'counterFillIdle', value: { color } },
        );
      act(() => {
        root.render(
          <PanelNavProvider
            value={{
              activePageKey: null,
              renderPageKey: null,
              openPage: vi.fn(),
              closePage: vi.fn(),
              pageHost,
            }}
          >
            <BatchKeyLikePanel {...props} />
          </PanelNavProvider>,
        );
      });
      act(() => captured.color?.onColorChangeComplete('#778899'));

      if (exact) {
        expect(patches.patchCounterFillByTargets).toHaveBeenCalledWith(
          [{ elementType: 'key', id: stableKeyId }],
          { property: 'counterFillActive', value: { color: '#778899' } },
        );
        expect(legacy).not.toHaveBeenCalled();
      } else {
        expect(patches.patchCounterFillByTargets).not.toHaveBeenCalled();
        expect(patches.patchCounterFillViaAuthority).not.toHaveBeenCalled();
        expect(legacy).toHaveBeenCalledOnce();
      }
    },
  );

  it('batch graph+knob counter fill completion은 빈 legacy commit을 만들지 않는다', () => {
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'graph', id: 'graph-0', index: 0 },
        { type: 'knob', id: 'knob-0', index: 0 },
      ],
    });
    const legacy = vi.fn();
    const genericComplete = vi.fn();
    const props = panelProps();
    props.activeTab = 'counter';
    props.batchPickerFor = 'fill';
    props.handleBatchCounterUpdate = legacy;
    props.handleBatchPickerColorChangeComplete = genericComplete;
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          <BatchKeyLikePanel {...props} />
        </PanelNavProvider>,
      );
    });

    act(() => captured.color?.onColorChangeComplete('#aabbcc'));

    expect(patches.patchCounterFillByTargets).not.toHaveBeenCalled();
    expect(patches.patchCounterFillViaAuthority).not.toHaveBeenCalled();
    expect(genericComplete).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  type ImagePanelKind = 'mixed' | 'graph' | 'knob';

  const selectImageTargets = (
    kind: ImagePanelKind,
    suffix: 'a' | 'b' | 'synthetic',
  ) => {
    const ids =
      suffix === 'synthetic'
        ? kind === 'mixed'
          ? [ID_A, 'stat-0']
          : [`${kind}-0`]
        : kind === 'mixed'
        ? ['key', 'stat', 'graph', 'knob'].map(
            (type, index) =>
              `${suffix}${index + 1}${index + 1}${index + 1}${index + 1}${
                index + 1
              }${index + 1}${index + 1}-${index + 1}${index + 1}${index + 1}${
                index + 1
              }-4${index + 1}${index + 1}${index + 1}-8${index + 1}${
                index + 1
              }${index + 1}-${index + 1}${index + 1}${index + 1}${index + 1}${
                index + 1
              }${index + 1}${index + 1}${index + 1}${index + 1}${index + 1}${
                index + 1
              }${index + 1}`,
          )
        : [
            suffix === 'a'
              ? kind === 'graph'
                ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
                : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
              : kind === 'graph'
              ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'
              : 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
          ];
    const types =
      kind === 'mixed'
        ? suffix === 'synthetic'
          ? (['key', 'stat'] as const)
          : (['key', 'stat', 'graph', 'knob'] as const)
        : ([kind] as const);
    useGridSelectionStore.setState({
      selectedElements: types.map((type, index) => ({
        type,
        id: ids[index],
        index,
      })),
    });
    return types.map((elementType, index) => ({
      elementType,
      id: ids[index],
    }));
  };

  const renderImagePanel = (
    kind: ImagePanelKind,
    legacy: ReturnType<typeof vi.fn>,
  ) => {
    const props = panelProps();
    const shared = {
      ...props,
      showBatchImagePicker: true,
      handleBatchStyleChangeComplete: kind === 'mixed' ? legacy : vi.fn(),
      handleActiveCapableStyleChangeComplete:
        kind === 'mixed' ? legacy : vi.fn(),
      handleBatchGradientCommit: legacy,
      handleBatchShadowChangeComplete: legacy,
      handleBatchShadowEnabledChange: legacy,
      handleGraphBatchSharedSetting: kind === 'graph' ? legacy : vi.fn(),
      handleKnobBatchSharedSetting: kind === 'knob' ? legacy : vi.fn(),
    };
    const panel =
      kind === 'mixed' ? (
        <BatchKeyLikePanel {...(shared as unknown as PanelProps)} />
      ) : kind === 'graph' ? (
        <BatchGraphOnlyPanel
          {...(shared as unknown as React.ComponentProps<
            typeof BatchGraphOnlyPanel
          >)}
        />
      ) : (
        <BatchKnobOnlyPanel
          {...(shared as unknown as React.ComponentProps<
            typeof BatchKnobOnlyPanel
          >)}
        />
      );
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          {panel}
        </PanelNavProvider>,
      );
    });
  };

  const commitShadow = (
    state: 'idle' | 'active',
    patch: Partial<ReturnType<typeof shadowSpec>>,
  ) => {
    const controls = captured.shadows.at(-1);
    expect(controls).toBeDefined();
    act(() => controls?.onChange(state, { ...shadowSpec(), ...patch }, patch));
  };

  const selectShadowTargets = (suffix: 'a' | 'b') => {
    const ids =
      suffix === 'a'
        ? [
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
          ]
        : [
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
          ];
    const types = ['key', 'stat', 'knob'] as const;
    useGridSelectionStore.setState({
      selectedElements: types.map((type, index) => ({
        type,
        id: ids[index],
        index: 0,
      })),
    });
    return types.map((elementType, index) => ({
      elementType,
      id: ids[index],
    }));
  };

  it('batch graph가 포함되면 shadow controls는 비도달이다', () => {
    const legacy = vi.fn();
    selectImageTargets('mixed', 'a');
    renderImagePanel('mixed', legacy);

    expect(captured.shadows).toHaveLength(0);
    expect(patches.patchShadowByTargets).not.toHaveBeenCalled();
    expect(patches.patchShadowViaAuthority).not.toHaveBeenCalled();
  });

  it.each(['main', 'panel'] as const)(
    'batch shadow는 latest current key/stat/knob targets에 %s exact partial을 보낸다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      const legacy = vi.fn();
      selectShadowTargets('a');
      renderImagePanel('mixed', legacy);
      const targets = selectShadowTargets('b');
      renderImagePanel('mixed', legacy);
      commitShadow('idle', { blur: 22.5 });

      const writer =
        windowType === 'panel'
          ? patches.patchShadowViaAuthority
          : patches.patchShadowByTargets;
      expect(writer).toHaveBeenCalledWith(targets, {
        property: 'shadow',
        value: { leaf: 'blur', value: 22.5 },
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('batch active shadow는 key/knob만 쓰고 synthetic stat은 무관하다', () => {
    const legacy = vi.fn();
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: ID_A, index: 0 },
        { type: 'stat', id: 'stat-0', index: 0 },
        { type: 'knob', id: ID_B, index: 0 },
      ],
    });
    renderImagePanel('mixed', legacy);
    commitShadow('active', { color: ' raw active ' });

    expect(patches.patchShadowByTargets).toHaveBeenCalledWith(
      [
        { elementType: 'key', id: ID_A },
        { elementType: 'knob', id: ID_B },
      ],
      {
        property: 'activeShadow',
        value: { leaf: 'color', value: ' raw active ' },
      },
    );
    expect(legacy).not.toHaveBeenCalled();
  });

  const commitBackgroundPaint = async (
    state: 'idle' | 'active',
    color: string,
  ) => {
    const label = Array.from(host.querySelectorAll('p')).find(
      (element) => element.textContent === 'propertiesPanel.backgroundColor',
    );
    const button = label?.parentElement?.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]',
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
    await waitForColorPicker(button!);
    if (state === 'active') {
      await act(async () => {
        captured.color?.onStateModeChange?.('active');
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
    }
    await act(async () => {
      captured.color?.onColorChange('local-drag');
      await Promise.resolve();
    });
    expect(patches.patchPaintByTargets).not.toHaveBeenCalled();
    expect(patches.patchPaintViaAuthority).not.toHaveBeenCalled();
    await act(async () => {
      captured.color?.onColorChangeComplete(color);
      await Promise.resolve();
    });
  };

  it.each(['main', 'panel'] as const)(
    'batch mixed paint는 latest current target과 final-only %s authority를 사용한다',
    async (windowType) => {
      window.__dmn_window_type = windowType;
      const legacy = vi.fn();
      selectImageTargets('mixed', 'a');
      renderImagePanel('mixed', legacy);
      const targets = selectImageTargets('mixed', 'b');
      renderImagePanel('mixed', legacy);

      await commitBackgroundPaint('idle', ' raw final ');

      const args = [
        targets,
        {
          property: 'backgroundPaint',
          value: { color: ' raw final ', gradient: null },
        },
      ] as const;
      if (windowType === 'panel') {
        expect(patches.patchPaintViaAuthority).toHaveBeenCalledWith(...args);
        expect(patches.patchPaintByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchPaintByTargets).toHaveBeenCalledWith(...args);
        expect(patches.patchPaintViaAuthority).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['graph', 'idle'],
    ['knob', 'active'],
  ] as const)(
    'batch %s-only paint %s actual ColorPicker는 exact targets를 쓴다',
    async (kind, state) => {
      const legacy = vi.fn();
      const targets = selectImageTargets(kind, 'a');
      renderImagePanel(kind, legacy);

      await commitBackgroundPaint(state, `${kind}-${state}`);

      expect(patches.patchPaintByTargets).toHaveBeenCalledWith(targets, {
        property:
          state === 'active' ? 'activeBackgroundPaint' : 'backgroundPaint',
        value: {
          color: `${kind}-${state}`,
          gradient: null,
        },
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main', 'mixed'],
    ['main', 'graph'],
    ['main', 'knob'],
    ['panel', 'mixed'],
    ['panel', 'graph'],
    ['panel', 'knob'],
  ] as const)(
    '%s %s batch ImagePicker load와 reset은 open 시점 ID를 고정한다',
    (windowType, kind) => {
      window.__dmn_window_type = windowType;
      const targetsA = selectImageTargets(kind, 'a');
      const legacy = vi.fn();
      renderImagePanel(kind, legacy);
      expect(captured.image?.completionBinding).toBe('element-id');

      selectImageTargets(kind, 'b');
      renderImagePanel(kind, legacy);
      act(() => {
        captured.image?.onIdleImageChange('  frozen.png  ');
        captured.image?.onIdleImageReset();
      });

      if (windowType === 'panel') {
        expect(
          patches.patchElementPropertyByTargetsViaAuthority.mock.calls,
        ).toEqual([
          [targetsA, { property: 'inactiveImage', value: '  frozen.png  ' }],
          [targetsA, { property: 'inactiveImage', value: '' }],
        ]);
        expect(patches.patchInactiveImageByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchInactiveImageByTargets.mock.calls).toEqual([
          [targetsA, '  frozen.png  '],
          [targetsA, ''],
        ]);
        expect(
          patches.patchElementPropertyByTargetsViaAuthority,
        ).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
      expect(patches.onElementPropertyCommit).not.toHaveBeenCalled();
    },
  );

  it('graph-only batch ImagePicker는 active writer를 노출하지 않는다', () => {
    selectImageTargets('graph', 'a');
    renderImagePanel('graph', vi.fn());

    expect(captured.image?.onActiveImageChange).toBeUndefined();
    expect(captured.image?.onActiveImageReset).toBeUndefined();
    expect(captured.image?.onIdleImageChange).toBeTypeOf('function');
    expect(captured.image?.onIdleImageReset).toBeTypeOf('function');
  });

  it.each(['graph', 'knob'] as const)(
    '%s-only batch는 displayText input을 노출하지 않는다',
    (kind) => {
      selectImageTargets(kind, 'a');
      renderImagePanel(kind, vi.fn());
      expect(host.querySelector('input[type="text"]')).toBeNull();
    },
  );

  it.each([
    ['main', 'mixed'],
    ['main', 'knob'],
    ['panel', 'mixed'],
    ['panel', 'knob'],
  ] as const)(
    '%s %s batch active image load와 reset은 open 시점 key/knob ID만 쓴다',
    (windowType, kind) => {
      window.__dmn_window_type = windowType;
      const targetsA = selectImageTargets(kind, 'a').filter(
        (target): target is { elementType: 'key' | 'knob'; id: string } =>
          target.elementType === 'key' || target.elementType === 'knob',
      );
      const legacy = vi.fn();
      renderImagePanel(kind, legacy);

      selectImageTargets(kind, 'b');
      renderImagePanel(kind, legacy);
      act(() => {
        captured.image?.onActiveImageChange('  active.png  ');
        captured.image?.onActiveImageReset();
      });

      if (windowType === 'panel') {
        expect(
          patches.patchElementPropertyByTargetsViaAuthority.mock.calls,
        ).toEqual([
          [targetsA, { property: 'activeImage', value: '  active.png  ' }],
          [targetsA, { property: 'activeImage', value: '' }],
        ]);
        expect(patches.patchActiveImageByTargets).not.toHaveBeenCalled();
      } else {
        expect(patches.patchActiveImageByTargets.mock.calls).toEqual([
          [targetsA, '  active.png  '],
          [targetsA, ''],
        ]);
        expect(
          patches.patchElementPropertyByTargetsViaAuthority,
        ).not.toHaveBeenCalled();
      }
      expect(legacy).not.toHaveBeenCalled();
      expect(patches.onElementPropertyCommit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['main', 'mixed', 'idle'],
    ['panel', 'graph', 'idle'],
    ['main', 'knob', 'active'],
    ['panel', 'mixed', 'active'],
  ] as const)(
    '%s %s batch %s transparency는 picker open이 아니라 최신 선택 ID를 쓴다',
    (windowType, kind, state) => {
      window.__dmn_window_type = windowType;
      selectImageTargets(kind, 'a');
      const legacy = vi.fn();
      renderImagePanel(kind, legacy);
      const targetsB = selectImageTargets(kind, 'b').filter((target) =>
        state === 'idle'
          ? true
          : target.elementType === 'key' || target.elementType === 'knob',
      );
      renderImagePanel(kind, legacy);

      act(() => {
        if (state === 'idle') {
          captured.image?.onIdleTransparentChange?.(true);
        } else {
          captured.image?.onActiveTransparentChange?.(true);
        }
      });

      const property =
        state === 'idle' ? 'idleTransparent' : 'activeTransparent';
      if (windowType === 'panel') {
        expect(
          patches.patchElementPropertyByTargetsViaAuthority,
        ).toHaveBeenCalledWith(targetsB, { property, value: true });
      } else {
        const dockedWriter =
          state === 'idle'
            ? patches.patchIdleTransparentByTargets
            : patches.patchActiveTransparentByTargets;
        expect(dockedWriter).toHaveBeenCalledWith(targetsB, true);
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('active transparency는 stat synthetic를 무시하고 stable key subset만 쓴다', () => {
    window.__dmn_window_type = 'main';
    selectImageTargets('mixed', 'synthetic');
    const legacy = vi.fn();
    renderImagePanel('mixed', legacy);

    act(() => captured.image?.onActiveTransparentChange?.(true));

    expect(patches.patchActiveTransparentByTargets).toHaveBeenCalledWith(
      [{ elementType: 'key', id: ID_A }],
      true,
    );
    expect(legacy).not.toHaveBeenCalled();
  });

  it('페이지가 열려 있는 동안 동일 개수 선택 교체에도 시작 선택에 적용한다', () => {
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });
    expect(captured.sound?.completionBinding).toBe('element-id');

    act(() => captured.sound!.onSoundSelect('first.wav'));
    expect(patches.patchSoundPathByIds).toHaveBeenLastCalledWith(
      [ID_A],
      'first.wav',
    );

    // 같은 개수의 다른 선택으로 교체 - 경계는 리마운트되지만 결합은 유지
    act(() => selectKey(ID_B));
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });

    act(() => captured.sound!.onSoundSelect('second.wav'));
    act(() => captured.sound!.onSoundSelect(''));
    expect(patches.patchSoundPathByIds.mock.calls).toEqual([
      [[ID_A], 'first.wav'],
      [[ID_A], 'second.wav'],
      [[ID_A], ''],
    ]);
    expect(
      patches.patchElementPropertyByTargetsViaAuthority,
    ).not.toHaveBeenCalled();
    expect(patches.onElementPropertyCommit).not.toHaveBeenCalled();
  });

  it('panel sound select와 clear는 open 시점 key ID를 authority에만 보낸다', () => {
    window.__dmn_window_type = 'panel';
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });
    act(() => selectKey(ID_B));
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });

    act(() => captured.sound!.onSoundSelect('  sounds/raw.wav  '));
    act(() => captured.sound!.onSoundSelect(''));

    const keyTargets = [{ elementType: 'key', id: ID_A }];
    expect(
      patches.patchElementPropertyByTargetsViaAuthority.mock.calls,
    ).toEqual([
      [keyTargets, { property: 'soundPath', value: '  sounds/raw.wav  ' }],
      [keyTargets, { property: 'soundPath', value: '' }],
    ]);
    expect(patches.patchSoundPathByIds).not.toHaveBeenCalled();
    expect(patches.onElementPropertyCommit).not.toHaveBeenCalled();
  });

  it.each(['main', 'panel'] as const)(
    '%s soundEnabled 토글은 picker binding이 아니라 current key subset만 쓴다',
    (windowType) => {
      window.__dmn_window_type = windowType;
      act(() => selectKey(ID_A));
      renderPanel({ active: null, renderKey: null });
      act(() => selectKey(ID_B));
      renderPanel({ active: null, renderKey: null });

      clickSoundEnabled();
      if (windowType === 'panel') {
        expect(
          patches.patchElementPropertyByTargetsViaAuthority,
        ).toHaveBeenCalledWith([{ elementType: 'key', id: ID_B }], {
          property: 'soundEnabled',
          value: true,
        });
        expect(patches.patchSoundEnabledByIds).not.toHaveBeenCalled();
      } else {
        expect(patches.patchSoundEnabledByIds).toHaveBeenCalledWith(
          [ID_B],
          true,
        );
        expect(
          patches.patchElementPropertyByTargetsViaAuthority,
        ).not.toHaveBeenCalled();
      }
    },
  );

  it('soundEnabled는 graph/knob synthetic를 무시하고 stable key subset만 쓴다', () => {
    useGridSelectionStore.setState({
      selectedElements: [
        { type: 'key', id: ID_A, index: 0 },
        { type: 'graph', id: 'graph-0', index: 0 },
        { type: 'knob', id: 'knob-0', index: 0 },
      ],
    });
    renderPanel({ active: null, renderKey: null });

    clickSoundEnabled();
    expect(patches.patchSoundEnabledByIds).toHaveBeenCalledWith([ID_A], true);
  });

  it('exit 애니메이션 중 재열기는 새 선택을 캡처한다', () => {
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });
    act(() => captured.sound!.onSoundSelect('first.wav'));
    expect(patches.patchSoundPathByIds).toHaveBeenLastCalledWith(
      [ID_A],
      'first.wav',
    );

    // close: activePageKey는 즉시 null, renderPageKey는 exit 동안 유지
    renderPanel({ active: null, renderKey: BATCH_STYLE_SOUND_PAGE_KEY });

    // exit 만료 전 다른 선택으로 재열기
    act(() => selectKey(ID_B));
    renderPanel({ active: null, renderKey: BATCH_STYLE_SOUND_PAGE_KEY });
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });

    act(() => captured.sound!.onSoundSelect('second.wav'));
    expect(patches.patchSoundPathByIds).toHaveBeenLastCalledWith(
      [ID_B],
      'second.wav',
    );
  });
});
