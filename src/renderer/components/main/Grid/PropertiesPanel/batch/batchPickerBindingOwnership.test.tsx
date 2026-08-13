// @vitest-environment jsdom
import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useKeyStore } from '@stores/data/useKeyStore';
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
  },
}));

const patches = vi.hoisted(() => ({
  applyElementPatchesById: vi.fn(async () => 1),
  applyElementPatchById: vi.fn(async () => true),
  patchInactiveImageByTargets: vi.fn(async () => true),
  patchInactiveImageViaAuthority: vi.fn(async () => true),
}));

vi.mock('@src/renderer/editor/runtime/elementPatch', () => patches);
vi.mock('@src/renderer/editor/runtime/elementOps', () => ({
  patchInactiveImageByTargets: patches.patchInactiveImageByTargets,
}));
vi.mock('@plugins/rpc/pluginElementActions', () => ({
  patchInactiveImageViaAuthority: patches.patchInactiveImageViaAuthority,
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: vi.fn(),
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
    default: () => null,
  }),
);
vi.mock('@components/main/Modal/content/pickers/ImagePicker', () => ({
  default: (props: (typeof captured)['image']) => {
    captured.image = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/pickers/FontPicker', () => ({
  default: (props: (typeof captured)['font']) => {
    captured.font = props;
    return null;
  },
}));
vi.mock('@components/main/Grid/PropertiesPanel/ShadowControls', () => ({
  default: () => null,
}));
vi.mock('@src/renderer/editor/runtime/editGestureController', () => ({
  editGestureController: {
    preview: vi.fn(),
    cancel: vi.fn(),
    settleCommit: vi.fn(),
    activeGestureId: () => null,
    commitPendingAsync: vi.fn(async () => true),
  },
}));

import { PanelNavProvider } from '@components/main/Grid/PropertiesPanel/PanelNavContext';
import { BatchKeyLikePanel } from '@components/main/Grid/PropertiesPanel/batch/BatchSelectionPanel';
import {
  BatchGraphOnlyPanel,
  BatchKnobOnlyPanel,
} from '@components/main/Grid/PropertiesPanel/batch/BatchSelectionPanel';
import { BATCH_STYLE_SOUND_PAGE_KEY } from '@components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent';

const BATCH_STYLE_FONT_PAGE_KEY = 'batch-style:font';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const keyAt = (id: string) => ({ ...createDefaultKeyPosition(), id });

type PanelProps = React.ComponentProps<typeof BatchKeyLikePanel>;

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
      getBatchPickerColor: () => '#ffffff',
      getBatchPickerRef: () => createRef<HTMLButtonElement>(),
      batchColorPickerInteractiveRefs: [],
      batchScrollRefFor: () => () => {},
      panelElement: null,
      useCustomCSS: false,
      selectedKeyType: '4key',
      t: (key: string) => key,
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
    captured.sound = null;
    captured.font = null;
    captured.image = null;
    selectKey(ID_A);
    host = document.createElement('div');
    pageHost = document.createElement('div');
    document.body.appendChild(host);
    document.body.appendChild(pageHost);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    pageHost.remove();
    delete window.__dmn_window_type;
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

      const selectedWriter =
        windowType === 'panel'
          ? patches.patchInactiveImageViaAuthority
          : patches.patchInactiveImageByTargets;
      const otherWriter =
        windowType === 'panel'
          ? patches.patchInactiveImageByTargets
          : patches.patchInactiveImageViaAuthority;
      expect(selectedWriter.mock.calls).toEqual([
        [targetsA, '  frozen.png  '],
        [targetsA, ''],
      ]);
      expect(otherWriter).not.toHaveBeenCalled();
      expect(legacy).not.toHaveBeenCalled();
      expect(patches.applyElementPatchesById).not.toHaveBeenCalled();
    },
  );

  it.each(['mixed', 'graph', 'knob'] as const)(
    '%s batch ImagePicker에 synthetic ID가 있으면 load와 reset 전체가 legacy다',
    (kind) => {
      window.__dmn_window_type = 'panel';
      selectImageTargets(kind, 'synthetic');
      const legacy = vi.fn();
      renderImagePanel(kind, legacy);

      expect(captured.image?.completionBinding).toBe('session-mode');
      act(() => {
        captured.image?.onIdleImageChange('legacy.png');
        captured.image?.onIdleImageReset();
      });

      expect(patches.patchInactiveImageByTargets).not.toHaveBeenCalled();
      expect(patches.patchInactiveImageViaAuthority).not.toHaveBeenCalled();
      if (kind === 'mixed') {
        expect(legacy.mock.calls).toEqual([
          ['inactiveImage', 'legacy.png'],
          ['inactiveImage', ''],
        ]);
      } else {
        expect(legacy.mock.calls).toEqual([
          [{ inactiveImage: 'legacy.png' }],
          [{ inactiveImage: '' }],
        ]);
      }
    },
  );

  it('페이지가 열려 있는 동안 동일 개수 선택 교체에도 시작 선택에 적용한다', () => {
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });
    expect(captured.sound?.completionBinding).toBe('element-id');

    act(() => captured.sound!.onSoundSelect('first.wav'));
    expect(patches.applyElementPatchesById).toHaveBeenLastCalledWith(
      { key: [ID_A] },
      expect.any(Function),
    );

    // 같은 개수의 다른 선택으로 교체 - 경계는 리마운트되지만 결합은 유지
    act(() => selectKey(ID_B));
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });

    act(() => captured.sound!.onSoundSelect('second.wav'));
    expect(patches.applyElementPatchesById).toHaveBeenLastCalledWith(
      { key: [ID_A] },
      expect.any(Function),
    );
  });

  it('BatchStyle FontPicker 선택은 raw top-level fontFamily로 전달한다', () => {
    const handleBatchStyleChangeComplete = vi.fn();
    const props = panelProps();
    props.handleBatchStyleChangeComplete = handleBatchStyleChangeComplete;
    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: BATCH_STYLE_FONT_PAGE_KEY,
            renderPageKey: BATCH_STYLE_FONT_PAGE_KEY,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost,
          }}
        >
          <BatchKeyLikePanel {...props} />
        </PanelNavProvider>,
      );
    });

    act(() => captured.font!.onFontSelect('  Raw Family  '));

    expect(handleBatchStyleChangeComplete).toHaveBeenCalledWith(
      'fontFamily',
      '  Raw Family  ',
    );
  });

  it('exit 애니메이션 중 재열기는 새 선택을 캡처한다', () => {
    renderPanel({
      active: BATCH_STYLE_SOUND_PAGE_KEY,
      renderKey: BATCH_STYLE_SOUND_PAGE_KEY,
    });
    act(() => captured.sound!.onSoundSelect('first.wav'));
    expect(patches.applyElementPatchesById).toHaveBeenLastCalledWith(
      { key: [ID_A] },
      expect.any(Function),
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
    expect(patches.applyElementPatchesById).toHaveBeenLastCalledWith(
      { key: [ID_B] },
      expect.any(Function),
    );
  });
});
