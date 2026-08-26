import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  numbers: new Map<
    string,
    {
      onChange: (value: number) => void;
      onBlur?: (value?: number) => void;
      onPreview?: (value: number) => void;
      min?: number;
      max?: number;
    }
  >(),
  numberList: [] as Array<{
    value?: number;
    onChange: (value: number) => void;
    onPreview?: (value: number) => void;
    min?: number;
    max?: number;
  }>,
  optionalNumbers: [] as Array<{
    value?: number;
    prefix?: string;
    suffix?: string;
    min?: number;
    max?: number;
    onChange: (value?: number) => void;
    onPreview?: (value?: number) => void;
  }>,
  dropdowns: [] as Array<{
    value: string;
    onChange: (value: string) => void;
  }>,
  checkboxes: [] as Array<{
    checked: boolean;
    onChange: () => void;
  }>,
  fontStyle: null as null | {
    onBoldChange: (value: boolean) => void;
    onItalicChange: (value: boolean) => void;
    onUnderlineChange: (value: boolean) => void;
    onStrikethroughChange: (value: boolean) => void;
  },
  font: null as null | {
    onFontSelect: (fontName: string | null) => void;
  },
  texts: [] as Array<{
    value: string;
    onChange: (value: string) => void;
    onBlur?: (value: string) => void;
    onPreview?: (value: string) => void;
    onCancel?: () => void;
  }>,
  image: null as null | {
    completionBinding?: string;
    onIdleImageChange: (value: string) => void;
    onIdleImageReset: () => void;
    onActiveImageChange?: (value: string) => void;
    onActiveImageReset?: () => void;
    idleTransparent?: boolean;
    activeTransparent?: boolean;
    onIdleTransparentChange?: (value: boolean) => void;
    onActiveTransparentChange?: (value: boolean) => void;
    idleImageFit?: string;
    activeImageFit?: string;
    onIdleImageFitChange?: (value: string) => void;
    onActiveImageFitChange?: (value: string) => void;
  },
  sound: null as null | {
    completionBinding?: string;
    onSoundSelect: (soundPath: string | null) => void;
  },
  animation: null as null | {
    completionBinding?: string;
    onAnimationChange: (
      animation: ReturnType<
        typeof createDefaultKeyPosition
      >['counter']['animation'],
    ) => void;
  },
  color: null as null | {
    color?: string;
    stateMode?: string;
    onStateModeChange?: (mode: string) => void;
    onColorChange: (color: string) => void;
    onColorChangeComplete: (color: string) => void;
    onGradientSpecSelect?: (spec: {
      angle: number;
      stops: Array<{ color: string; pos: number }>;
    }) => void;
    onOpacityPercentChange?: (
      value: number,
      target: 'solid' | 'top' | 'bottom',
    ) => void;
    onOpacityPercentChangeComplete?: (
      value: number,
      target: 'solid' | 'top' | 'bottom',
    ) => void;
  },
  colorInputs: [] as Array<{
    canvasAnchor?:
      | { kind: 'key' | 'stat' | 'graph' | 'knob'; id: string }
      | { kind: 'batch' };
    onModeCommit?: (
      state: 'idle' | 'active',
      value:
        | { mode: 'solid'; color: string }
        | {
            mode: 'gradient';
            spec: {
              angle: number;
              stops: Array<{ color: string; pos: number }>;
            };
          },
    ) => void;
  }>,
  swatches: [] as Array<{ onClick: () => void }>,
  shadows: [] as Array<{
    showActiveState?: boolean;
    onChange: (
      state: 'idle' | 'active',
      shadow: ReturnType<typeof shadowSpec>,
      patch: Partial<ReturnType<typeof shadowSpec>>,
    ) => void;
    onEnabledChange: (enabled: boolean) => void;
  }>,
  nav: {
    activePageKey: null as string | null,
    renderPageKey: null as string | null,
    pageHost: null as HTMLElement | null,
  },
}));
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: vi.fn(),
  reportElementOpSkipped: vi.fn(),
}));

vi.mock('../PropertyInputs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../PropertyInputs')>();
  return {
    ...actual,
    PropertyRow: ({ children }: { children: React.ReactNode }) => children,
    PropertySection: ({ children }: { children: React.ReactNode }) => children,
    NumberInput: (props: {
      prefix?: string;
      suffix?: string;
      max?: number;
      min?: number;
      onChange: (value: number) => void;
      onBlur?: (value?: number) => void;
      onPreview?: (value: number) => void;
    }) => {
      captured.numberList.push(props);
      captured.numbers.set(
        !props.prefix && props.suffix === 'px' && props.max === 9999
          ? 'counter-gap'
          : props.prefix ?? props.suffix ?? '',
        props as never,
      );
      return null;
    },
    OptionalNumberInput: (props: (typeof captured.optionalNumbers)[number]) => {
      captured.optionalNumbers.push(props);
      return null;
    },
    TextInput: (props: (typeof captured.texts)[number]) => {
      captured.texts.push(props);
      return <actual.TextInput {...props} />;
    },
    ColorInput: (props: (typeof captured.colorInputs)[number]) => {
      captured.colorInputs.push(props);
      return null;
    },
    FontStyleToggle: (props: NonNullable<(typeof captured)['fontStyle']>) => {
      captured.fontStyle = props;
      return null;
    },
    Tabs: () => null,
  };
});
vi.mock('@components/main/common/Dropdown', () => ({
  default: (props: { value: string; onChange: (value: string) => void }) => {
    captured.dropdowns.push(props);
    return null;
  },
}));
vi.mock('@components/main/common/Checkbox', () => ({
  default: (props: { checked: boolean; onChange: () => void }) => {
    captured.checkboxes.push(props);
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: (props: NonNullable<(typeof captured)['color']>) => {
    captured.color = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/ImagePicker', () => ({
  default: (props: NonNullable<(typeof captured)['image']>) => {
    captured.image = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/SoundPicker', () => ({
  default: (props: NonNullable<(typeof captured)['sound']>) => {
    captured.sound = props;
    return null;
  },
}));
vi.mock(
  '@components/main/Modal/content/pickers/CounterAnimationPicker',
  () => ({
    default: (props: NonNullable<(typeof captured)['animation']>) => {
      captured.animation = props;
      return null;
    },
  }),
);
vi.mock('@components/main/Modal/content/pickers/FontPicker', () => ({
  default: (props: NonNullable<(typeof captured)['font']>) => {
    captured.font = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/ColorSwatch', () => ({
  ColorSwatchButton: (props: { onClick: () => void }) => {
    captured.swatches.push(props);
    return null;
  },
}));
vi.mock('@components/main/Modal/PopupExit', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('../ShadowControls', () => ({
  default: (props: (typeof captured.shadows)[number]) => {
    captured.shadows.push(props);
    return null;
  },
}));
vi.mock('../EditSessionBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../PanelNavContext', () => ({
  usePanelNav: () => ({
    ...captured.nav,
    openPage: vi.fn(),
    closePage: vi.fn(),
  }),
}));
vi.mock('@hooks/useKeySlotCapture', () => ({
  useKeySlotCapture: () => ({
    listening: false,
    listenIndex: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));
vi.mock('@hooks/pickers/useGradientColorState', () => ({
  useGradientColorState: ({
    onPreview,
    onCommit,
  }: {
    onPreview?: (
      value:
        | { mode: 'solid'; color: string }
        | {
            mode: 'gradient';
            spec: {
              angle: number;
              stops: Array<{ color: string; pos: number }>;
            };
          },
    ) => void;
    onCommit: (
      value:
        | { mode: 'solid'; color: string }
        | {
            mode: 'gradient';
            spec: {
              angle: number;
              stops: Array<{ color: string; pos: number }>;
            };
          },
    ) => void;
  }) => ({
    pickerColor: '#ffffff',
    handlePickerColorChange: (color: string, commit: boolean) =>
      commit
        ? onCommit({ mode: 'solid', color })
        : onPreview?.({ mode: 'solid', color }),
    handleGradientSpecSelect: (spec: {
      angle: number;
      stops: Array<{ color: string; pos: number }>;
    }) => onCommit({ mode: 'gradient', spec }),
  }),
}));
vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: { subscribe: () => vi.fn() },
}));

import ActualStyleTabContent from './StyleTabContent';
import ActualNoteTabContent from './NoteTabContent';
import ActualCounterTabContent from './CounterTabContent';
import {
  SingleGraphPanel as ActualSingleGraphPanel,
  SingleKnobPanel as ActualSingleKnobPanel,
} from './SingleSelectionPanel';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { isEditorElementPropertyPatchV1 } from '@src/types/editor';

type CompatProps<T extends React.ElementType> = React.ComponentProps<T> &
  Record<string, unknown>;

const StyleTabContent = (props: CompatProps<typeof ActualStyleTabContent>) => (
  <ActualStyleTabContent {...props} />
);
const NoteTabContent = (props: CompatProps<typeof ActualNoteTabContent>) => (
  <ActualNoteTabContent {...props} />
);
const CounterTabContent = (
  props: CompatProps<typeof ActualCounterTabContent>,
) => <ActualCounterTabContent {...props} />;
const SingleGraphPanel = (
  props: CompatProps<typeof ActualSingleGraphPanel>,
) => <ActualSingleGraphPanel {...props} />;
const SingleKnobPanel = (props: CompatProps<typeof ActualSingleKnobPanel>) => (
  <ActualSingleKnobPanel {...props} />
);

const shadowSpec = () => ({
  enabled: true,
  color: '#0008',
  offsetX: 0,
  offsetY: 4,
  blur: 10,
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('single geometry input bindings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      window.clearTimeout(id),
    );
    captured.numbers.clear();
    captured.numberList.length = 0;
    captured.optionalNumbers.length = 0;
    captured.dropdowns.length = 0;
    captured.checkboxes.length = 0;
    captured.fontStyle = null;
    captured.font = null;
    captured.texts.length = 0;
    captured.image = null;
    captured.sound = null;
    captured.animation = null;
    captured.color = null;
    captured.colorInputs.length = 0;
    captured.swatches.length = 0;
    captured.shadows.length = 0;
    captured.nav.activePageKey = null;
    captured.nav.renderPageKey = null;
    captured.nav.pageHost = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  it.each([
    ['key', true],
    ['stat', false],
  ] as const)(
    '%s shadow actual control은 exact partial/master callback을 쓴다',
    (type, active) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={{
              ...createDefaultKeyPosition(),
              shadow: shadowSpec(),
              activeShadow: shadowSpec(),
            }}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onShadowCommit={commit}
            shadowActiveState={active}
            showSoundControls={false}
            t={(key) => key}
          />,
        );
      });
      const controls = captured.shadows.at(-1)!;
      act(() => {
        controls.onChange('idle', { ...shadowSpec(), blur: 22 }, { blur: 22 });
        controls.onEnabledChange(false);
      });
      expect(commit.mock.calls).toEqual([
        [{ property: 'shadow', value: { leaf: 'blur', value: 22 } }],
        [{ property: 'shadowEnabled', value: false }],
      ]);
      expect(legacy).not.toHaveBeenCalled();
      expect(controls.showActiveState).toBe(active);
    },
  );

  it('knob shadow actual control은 active partial/master callback을 쓴다', () => {
    const commit = vi.fn();
    const legacy = vi.fn();
    act(() => {
      root.render(
        <SingleKnobPanel
          setPanelElement={vi.fn()}
          singleKnobPosition={{
            ...createDefaultKeyPosition(),
            axisId: 'HIDA:test',
            sensitivity: 1,
            reverse: false,
            shadow: shadowSpec(),
            activeShadow: shadowSpec(),
          }}
          singleKnobIndex={0}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>()}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          handleKnobUpdate={legacy}
          singleScrollRefFor={() => vi.fn()}
          panelElement={null}
          useCustomCSS={false}
          t={(key) => key}
          onShadowCommit={commit}
        />,
      );
    });
    const controls = captured.shadows.at(-1)!;
    act(() => {
      controls.onChange(
        'active',
        { ...shadowSpec(), color: ' raw ' },
        { color: ' raw ' },
      );
      controls.onEnabledChange(true);
    });
    expect(commit.mock.calls).toEqual([
      [{ property: 'activeShadow', value: { leaf: 'color', value: ' raw ' } }],
      [{ property: 'shadowEnabled', value: true }],
    ]);
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['key', 'stat'] as const)(
    '%s StyleTab ImagePicker load와 reset은 inactiveImage callback만 호출한다',
    (type) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onInactiveImageCommit={commit}
            showImagePicker
            onToggleImagePicker={vi.fn()}
            imageButtonRef={{ current: document.createElement('button') }}
            shadowActiveState={false}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      act(() => {
        captured.image?.onIdleImageChange('  picked.png  ');
        captured.image?.onIdleImageReset();
      });

      expect(captured.image?.completionBinding).toBe('element-id');
      expect(commit.mock.calls).toEqual([['  picked.png  '], ['']]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('single NoteTab noteGlowSize는 preview와 final exact callback을 분리한다', () => {
    const preview = vi.fn();
    const commit = vi.fn();
    const legacyPreview = vi.fn();
    const legacyCommit = vi.fn();
    act(() => {
      root.render(
        <NoteTabContent
          keyIndex={0}
          keyPosition={{ ...createDefaultKeyPosition(), noteGlowSize: 20 }}
          onKeyUpdate={legacyCommit}
          onKeyPreview={legacyPreview}
          onStylePropertyPreview={preview}
          onStylePropertyCommit={commit}
          t={(key) => key}
        />,
      );
    });
    const glow = captured.numberList.find(
      (input) => input.min === 0 && input.max === 50,
    );
    expect(glow).toMatchObject({ min: 0, max: 50 });
    act(() => glow?.onPreview?.(20.5));
    expect(preview).toHaveBeenCalledWith({
      property: 'noteGlowSize',
      value: 20.5,
    });
    expect(commit).not.toHaveBeenCalled();
    act(() => glow?.onChange(21.5));
    expect(commit).toHaveBeenCalledWith({
      property: 'noteGlowSize',
      value: 21.5,
    });
    expect(legacyPreview).not.toHaveBeenCalled();
    expect(legacyCommit).not.toHaveBeenCalled();
  });

  it('single NoteTab note numeric은 0 placeholder와 explicit 0/null wire를 구분한다', () => {
    const preview = vi.fn();
    const commit = vi.fn();
    act(() => {
      root.render(
        <NoteTabContent
          keyIndex={0}
          keyPosition={{
            ...createDefaultKeyPosition(),
            noteOffsetX: 0,
            noteOffsetY: 0,
            noteWidth: 40,
          }}
          onKeyUpdate={vi.fn()}
          onKeyPreview={vi.fn()}
          onStylePropertyPreview={preview}
          onStylePropertyCommit={commit}
          t={(key) => key}
        />,
      );
    });
    const offsetX = captured.optionalNumbers.find(
      (input) => input.prefix === 'X',
    );
    const offsetY = captured.optionalNumbers.find(
      (input) => input.prefix === 'Y',
    );
    const width = captured.optionalNumbers.find(
      (input) => input.suffix === 'px' && input.min === 1,
    );
    expect(offsetX?.value).toBeUndefined();
    expect(offsetY?.value).toBeUndefined();

    act(() => offsetX?.onPreview?.(0));
    act(() => offsetX?.onChange(0));
    act(() => offsetY?.onPreview?.(undefined));
    act(() => offsetY?.onChange(undefined));
    act(() => width?.onChange(undefined));

    expect(preview.mock.calls).toEqual([
      [{ property: 'noteOffsetX', value: 0 }],
      [{ property: 'noteOffsetY', value: null }],
    ]);
    expect(commit.mock.calls).toEqual([
      [{ property: 'noteOffsetX', value: 0 }],
      [{ property: 'noteOffsetY', value: null }],
      [{ property: 'noteWidth', value: null }],
    ]);
  });

  it('single NoteTab note border numeric은 exact preview와 commit을 사용한다', () => {
    const preview = vi.fn();
    const commit = vi.fn();
    act(() => {
      root.render(
        <NoteTabContent
          keyIndex={0}
          keyPosition={createDefaultKeyPosition()}
          onKeyUpdate={vi.fn()}
          onKeyPreview={vi.fn()}
          onStylePropertyPreview={preview}
          onStylePropertyCommit={commit}
          t={(key) => key}
        />,
      );
    });
    const borderWidth = captured.numberList.find(
      (input) => input.min === 0 && input.max === 20,
    );
    const borderRadius = captured.numberList.find(
      (input) => input.min === 1 && input.max === 100,
    );
    act(() => borderWidth?.onPreview?.(2.5));
    act(() => borderWidth?.onChange(3.5));
    act(() => borderRadius?.onPreview?.(12.5));
    act(() => borderRadius?.onChange(13.5));

    expect(preview.mock.calls).toEqual([
      [{ property: 'noteBorderWidth', value: 2.5 }],
      [{ property: 'noteBorderRadius', value: 12.5 }],
    ]);
    expect(commit.mock.calls).toEqual([
      [{ property: 'noteBorderWidth', value: 3.5 }],
      [{ property: 'noteBorderRadius', value: 13.5 }],
    ]);
  });

  it.each([
    ['borderWidth', 0, 20, 12.5],
    ['borderRadius', 0, 100, 88.5],
    ['fontSize', 8, 72, 31.5],
  ] as const)(
    'key/stat StyleTab %s는 preview와 final을 공용 style callbacks로 분리한다',
    (property, min, max, value) => {
      const preview = vi.fn();
      const commit = vi.fn();
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={3}
            keyPosition={createDefaultKeyPosition()}
            keyCode="A"
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacyCommit}
            onKeyPreview={legacyPreview}
            onStylePropertyPreview={preview}
            onStylePropertyCommit={commit}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      const input = captured.numberList.find(
        (candidate) => candidate.min === min && candidate.max === max,
      );
      act(() => input?.onPreview?.(value));
      act(() => input?.onChange(value));

      expect(preview).toHaveBeenCalledWith({ property, value });
      expect(commit).toHaveBeenCalledWith({ property, value });
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key', true],
    ['stat', false],
  ] as const)(
    '%s background paint actual ColorPicker는 local drag 뒤 final descriptor만 commit한다',
    (type, activeReachable) => {
      const paint = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onPaintCommit={paint}
            shadowActiveState={activeReachable}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      act(() => captured.swatches[0]?.onClick());
      if (activeReachable) {
        expect(captured.color?.onStateModeChange).toBeTypeOf('function');
      } else {
        expect(captured.color?.onStateModeChange).toBeUndefined();
      }
      act(() => captured.color?.onColorChange('drag'));
      expect(paint).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete(' final '));
      expect(paint).toHaveBeenLastCalledWith({
        property: 'backgroundPaint',
        value: { color: ' final ', gradient: null },
      });
      if (activeReachable) {
        act(() => captured.color?.onStateModeChange?.('active'));
        act(() => captured.color?.onColorChangeComplete(' active '));
        expect(paint).toHaveBeenLastCalledWith({
          property: 'activeBackgroundPaint',
          value: { color: ' active ', gradient: null },
        });
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key', true],
    ['stat', false],
  ] as const)(
    '%s font color actual ColorPicker는 local drag 뒤 final raw leaf만 commit한다',
    (type, activeReachable) => {
      const paint = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onPaintCommit={paint}
            shadowActiveState={activeReachable}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      // 글꼴 색상은 마지막 스와치
      act(() => captured.swatches.at(-1)?.onClick());
      act(() => captured.color?.onColorChange('local-only'));
      expect(paint).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete(' idle raw '));
      expect(paint).toHaveBeenLastCalledWith({
        property: 'fontPaint',
        value: { color: ' idle raw ', gradient: null },
      });
      if (activeReachable) {
        act(() => captured.color?.onStateModeChange?.('active'));
        act(() => captured.color?.onColorChange('active-local'));
        expect(paint).toHaveBeenCalledOnce();
        act(() => captured.color?.onColorChangeComplete(' active raw '));
        expect(paint).toHaveBeenLastCalledWith({
          property: 'activeFontPaint',
          value: { color: ' active raw ', gradient: null },
        });
      } else {
        expect(captured.color?.onStateModeChange).toBeUndefined();
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('graph paint는 exact gradient pair를 final callback으로만 전달한다', async () => {
    const paint = vi.fn();
    const legacy = vi.fn();
    const graphId = '11111111-1111-4111-8111-111111111111';
    act(() => {
      root.render(
        <SingleGraphPanel
          setPanelElement={vi.fn()}
          singleGraphPosition={{
            ...createDefaultKeyPosition(),
            id: graphId,
            statType: 'kps',
            graphType: 'line',
            graphSpeed: 1000,
            graphColor: '#fff',
          }}
          singleGraphIndex={0}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>()}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          handleGraphUpdate={legacy}
          onPaintCommit={paint}
          showGraphImagePicker={false}
          setShowGraphImagePicker={vi.fn()}
          graphImageButtonRef={{ current: document.createElement('button') }}
          graphClassNameDraft=""
          setGraphClassNameDraft={vi.fn()}
          singleScrollRefFor={() => vi.fn()}
          panelElement={null}
          useCustomCSS={false}
          t={(key) => key}
        />,
      );
    });
    const paints = captured.colorInputs.filter(
      (input) => input.onModeCommit !== undefined,
    );
    expect(paints).toHaveLength(2);
    expect(paints.map((input) => input.canvasAnchor)).toEqual([
      { kind: 'graph', id: graphId },
      { kind: 'graph', id: graphId },
    ]);
    const gradient = {
      angle: 45,
      stops: [
        { color: '#first', pos: 0 },
        { color: '#last', pos: 1 },
      ],
    };
    act(() =>
      paints[0]?.onModeCommit?.('idle', {
        mode: 'gradient',
        spec: gradient,
      }),
    );
    expect(paint).toHaveBeenCalledWith({
      property: 'backgroundPaint',
      value: { color: '#first', gradient },
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['key', 'stat'] as const)(
    '%s StyleTab displayText는 preview와 blur를 exact callbacks로 분리한다',
    (type) => {
      const preview = vi.fn();
      const commit = vi.fn();
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={3}
            keyPosition={{
              ...createDefaultKeyPosition(),
              displayText: 'Before',
            }}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacyCommit}
            onKeyPreview={legacyPreview}
            onStylePropertyPreview={preview}
            onStylePropertyCommit={commit}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      const displayText = captured.texts.find(
        (input) => input.value === 'Before',
      );
      act(() => displayText?.onChange('  Preview  '));
      act(() => displayText?.onBlur?.('  Final  '));

      expect(preview).toHaveBeenCalledWith({
        property: 'displayText',
        value: '  Preview  ',
      });
      expect(commit).toHaveBeenCalledWith({
        property: 'displayText',
        value: '  Final  ',
      });
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'stat'] as const)(
    '%s StyleTab className은 custom CSS에서 preview와 blur를 공용 text callbacks로 분리한다',
    (type) => {
      const preview = vi.fn();
      const commit = vi.fn();
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={3}
            keyPosition={{
              ...createDefaultKeyPosition(),
              className: 'BeforeClass',
            }}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacyCommit}
            onKeyPreview={legacyPreview}
            onStylePropertyPreview={preview}
            onStylePropertyCommit={commit}
            showSoundControls={false}
            useCustomCSS
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      const className = captured.texts.find(
        (input) => input.value === 'BeforeClass',
      );
      act(() => className?.onChange('  Preview class  '));
      act(() => className?.onBlur?.('  Final class  '));

      expect(preview).toHaveBeenCalledWith({
        property: 'className',
        value: '  Preview class  ',
      });
      expect(commit).toHaveBeenCalledWith({
        property: 'className',
        value: '  Final class  ',
      });
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
    },
  );

  it('StyleTab은 custom CSS가 꺼지면 className input을 노출하지 않는다', () => {
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={{
            ...createDefaultKeyPosition(),
            className: 'HiddenClass',
          }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={vi.fn()}
          onStylePropertyPreview={vi.fn()}
          onStylePropertyCommit={vi.fn()}
          showSoundControls={false}
          useCustomCSS={false}
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    expect(captured.texts.some((input) => input.value === 'HiddenClass')).toBe(
      false,
    );
  });

  it('displayText actual TextInput은 preview 뒤 blur commit을 같은 final literal로 호출한다', async () => {
    const preview = vi.fn();
    const commit = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={{
            ...createDefaultKeyPosition(),
            displayText: 'Before',
          }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={vi.fn()}
          onStylePropertyPreview={preview}
          onStylePropertyCommit={commit}
          showSoundControls={false}
          panelElement={null}
          t={(key) => key}
        />,
      );
    });
    const input =
      container.querySelector<HTMLInputElement>('input[type="text"]')!;
    act(() => input.focus());
    act(() => setInputValue(input, '  Final label  '));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(preview).toHaveBeenLastCalledWith({
      property: 'displayText',
      value: '  Final label  ',
    });

    act(() => input.blur());
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({
      property: 'displayText',
      value: '  Final label  ',
    });
    expect(preview.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[0],
    );
  });

  it.each(['key', 'stat'] as const)(
    '%s counter FontPicker는 raw family를 typography callback으로 전달한다',
    (type) => {
      const typography = vi.fn();
      const legacy = vi.fn();
      captured.nav.activePageKey = 'single-counter:font';
      captured.nav.renderPageKey = 'single-counter:font';
      captured.nav.pageHost = document.body;
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterTypographyCommit={typography}
            t={(key) => key}
          />,
        );
      });

      act(() => captured.font?.onFontSelect('  Raw Counter Family  '));

      expect(typography).toHaveBeenCalledWith({
        property: 'counterFontFamily',
        value: '  Raw Counter Family  ',
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'stat'] as const)(
    '%s counter typography 5 입력은 exact one-leaf callback만 호출한다',
    (type) => {
      const typography = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterTypographyCommit={typography}
            t={(key) => key}
          />,
        );
      });

      const fontSize = [...captured.numbers.values()].find(
        (input) => input.min === 8,
      );
      act(() => fontSize?.onChange(72));
      act(() => captured.fontStyle?.onBoldChange(true));
      act(() => captured.fontStyle?.onItalicChange(true));
      act(() => captured.fontStyle?.onUnderlineChange(true));
      act(() => captured.fontStyle?.onStrikethroughChange(true));
      expect(typography.mock.calls).toEqual([
        [{ property: 'counterFontSize', value: 72 }],
        [{ property: 'counterFontBold', value: true }],
        [{ property: 'counterFontItalic', value: true }],
        [{ property: 'counterFontUnderline', value: true }],
        [{ property: 'counterFontStrikethrough', value: true }],
      ]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'key',
      'idle',
      { property: 'counterFillIdle', value: { color: ' final fill ' } },
    ],
    [
      'key',
      'active',
      { property: 'counterFillActive', value: { color: ' final fill ' } },
    ],
    [
      'stat',
      'idle',
      { property: 'counterFillIdle', value: { color: ' final fill ' } },
    ],
  ] as const)(
    '%s counter fill %s picker는 local drag 뒤 final exact descriptor만 commit한다',
    (type, state, expected) => {
      const fill = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterFillCommit={fill}
            t={(key) => key}
          />,
        );
      });
      act(() => captured.swatches.at(-1)?.onClick());
      if (state === 'active') {
        act(() => captured.color?.onStateModeChange?.('active'));
      }
      act(() => captured.color?.onColorChange('drag-only'));
      expect(fill).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete(' final fill '));

      expect(fill).toHaveBeenCalledWith(expected);
      expect(legacy).not.toHaveBeenCalled();
      if (type === 'stat') {
        expect(captured.color?.onStateModeChange).toBeUndefined();
      }
    },
  );

  it('counter fill gradient 선택은 first-stop compact 대표값과 exact spec을 함께 commit한다', () => {
    const fill = vi.fn();
    const gradient = {
      angle: 45,
      stops: [
        { color: '#112233', pos: 0 },
        { color: '#445566', pos: 1 },
      ],
    };
    act(() => {
      root.render(
        <CounterTabContent
          keyIndex={0}
          keyPosition={createDefaultKeyPosition()}
          isStat={false}
          onKeyUpdate={vi.fn()}
          onCounterFillCommit={fill}
          t={(key) => key}
        />,
      );
    });
    act(() => captured.swatches.at(-1)?.onClick());
    act(() => captured.color?.onColorChange('local-only'));
    expect(fill).not.toHaveBeenCalled();
    act(() => captured.color?.onGradientSpecSelect?.(gradient));

    expect(fill).toHaveBeenCalledWith({
      property: 'counterFillIdle',
      value: { color: 'rgba(17,34,51,1)', gradient },
    });
  });

  it.each([
    ['key', true],
    ['stat', false],
  ] as const)(
    '%s StyleTab transparency는 도달 가능한 exact callback만 호출한다',
    (type, activeReachable) => {
      const idle = vi.fn();
      const active = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onIdleTransparentCommit={idle}
            onActiveTransparentCommit={activeReachable ? active : undefined}
            showImagePicker
            onToggleImagePicker={vi.fn()}
            imageButtonRef={{ current: document.createElement('button') }}
            shadowActiveState={activeReachable}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });

      act(() => captured.image?.onIdleTransparentChange?.(true));
      expect(idle).toHaveBeenCalledWith(true);
      if (activeReachable) {
        act(() => captured.image?.onActiveTransparentChange?.(false));
        expect(active).toHaveBeenCalledWith(false);
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key', true],
    ['stat', false],
  ] as const)(
    '%s StyleTab image fit은 도달 가능한 exact callback만 호출한다',
    (type, activeReachable) => {
      const idle = vi.fn();
      const active = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onIdleImageFitCommit={idle}
            onActiveImageFitCommit={activeReachable ? active : undefined}
            showImagePicker
            onToggleImagePicker={vi.fn()}
            imageButtonRef={{ current: document.createElement('button') }}
            shadowActiveState={activeReachable}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });

      act(() => captured.image?.onIdleImageFitChange?.('contain'));
      expect(idle).toHaveBeenCalledWith('contain');
      if (activeReachable) {
        act(() => captured.image?.onActiveImageFitChange?.('fill'));
        expect(active).toHaveBeenCalledWith('fill');
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'stat'] as const)(
    '%s counter bool 두 토글은 exact callback만 호출한다',
    (type) => {
      const counterEnabled = vi.fn();
      const animationEnabled = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterEnabledCommit={counterEnabled}
            onCounterAnimationEnabledCommit={animationEnabled}
            t={(key) => key}
          />,
        );
      });

      act(() => captured.checkboxes[0]?.onChange());
      act(() => captured.checkboxes[1]?.onChange());
      expect(counterEnabled).toHaveBeenCalledWith(false);
      expect(animationEnabled).toHaveBeenCalledWith(true);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'stat'] as const)(
    '%s counter layout 4 입력은 exact one-leaf callback만 호출한다',
    (type) => {
      const layout = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterLayoutCommit={layout}
            t={(key) => key}
          />,
        );
      });

      act(() => captured.dropdowns[0]?.onChange('outside'));
      act(() => captured.dropdowns[1]?.onChange('right'));
      act(() => captured.dropdowns[2]?.onChange('between'));
      const gap = captured.numbers.get('counter-gap');
      expect(gap).toMatchObject({ min: 0, max: 9999 });
      act(() => gap?.onChange(9999));
      expect(layout.mock.calls).toEqual([
        [{ property: 'counterPlacement', value: 'outside' }],
        [{ property: 'counterAlign', value: 'right' }],
        [{ property: 'counterAlignMode', value: 'between' }],
        [{ property: 'counterGap', value: 9999 }],
      ]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('key StyleTab SoundPicker select와 clear는 exact callback으로 raw path를 전달한다', () => {
    const commit = vi.fn();
    const legacy = vi.fn();
    captured.nav.activePageKey = 'single-style:sound';
    captured.nav.renderPageKey = 'single-style:sound';
    captured.nav.pageHost = document.body;
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={{
            ...createDefaultKeyPosition(),
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={legacy}
          onSoundPathCommit={commit}
          showSoundControls
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    expect(captured.sound?.completionBinding).toBe('element-id');
    act(() => captured.sound?.onSoundSelect('  sounds/raw.wav  '));
    act(() => captured.sound?.onSoundSelect(null));

    expect(commit.mock.calls).toEqual([['  sounds/raw.wav  '], ['']]);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('key StyleTab soundEnabled 토글은 exact callback만 호출한다', () => {
    const commit = vi.fn();
    const legacy = vi.fn();
    const preview = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={{
            ...createDefaultKeyPosition(),
            soundEnabled: false,
          }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={legacy}
          onKeyPreview={preview}
          onSoundEnabledCommit={commit}
          showSoundControls
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.checkboxes.at(-1)?.onChange());
    expect(commit).toHaveBeenCalledWith(true);
    expect(preview).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('stat StyleTab은 SoundPicker를 렌더하지 않는다', () => {
    captured.nav.activePageKey = 'single-style:sound';
    captured.nav.renderPageKey = 'single-style:sound';
    captured.nav.pageHost = document.body;
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={createDefaultKeyPosition()}
          keyCode={null}
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={vi.fn()}
          showSoundControls={false}
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    expect(captured.sound).toBeNull();
    expect(captured.checkboxes).toHaveLength(0);
  });

  it.each(['key', 'stat'] as const)(
    '%s CounterAnimationPicker는 single exact diff intent를 전달한다',
    (type) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      captured.nav.activePageKey = 'single-counter:animation';
      captured.nav.renderPageKey = 'single-counter:animation';
      captured.nav.pageHost = document.body;
      const position = createDefaultKeyPosition();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={position}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterAnimationPresetCommit={commit}
            t={(key) => key}
          />,
        );
      });

      expect(captured.animation?.completionBinding).toBe('element-id');
      act(() =>
        captured.animation?.onAnimationChange({
          ...position.counter.animation,
          presetId: 'preset-b',
          scale: 1.4,
        }),
      );
      expect(commit).toHaveBeenCalledWith({
        presetId: 'preset-b',
        applyPresetId: true,
        scale: 1.4,
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'knob'] as const)(
    '%s ImagePicker active load와 reset은 exact callback만 호출한다',
    (type) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          type === 'key' ? (
            <StyleTabContent
              keyIndex={0}
              keyPosition={createDefaultKeyPosition()}
              keyCode="A"
              keyInfo={null}
              onPositionChange={vi.fn()}
              onKeyUpdate={legacy}
              onActiveImageCommit={commit}
              showImagePicker
              onToggleImagePicker={vi.fn()}
              imageButtonRef={{ current: document.createElement('button') }}
              shadowActiveState
              showSoundControls={false}
              panelElement={null}
              t={(key) => key}
            />
          ) : (
            <SingleKnobPanel
              setPanelElement={vi.fn()}
              singleKnobPosition={{
                ...createDefaultKeyPosition(),
                axisId: 'HIDA:test',
                sensitivity: 1,
                reverse: false,
              }}
              singleKnobIndex={0}
              selectedKeyType="4key"
              isRenaming={false}
              renameInputRef={createRef<HTMLInputElement>()}
              renameValue=""
              setRenameValue={vi.fn()}
              renameCancelledRef={{ current: false }}
              handleRenameCommit={vi.fn()}
              handleRenameCancel={vi.fn()}
              handleRenameStart={vi.fn()}
              handleKnobUpdate={legacy}
              onActiveImageCommit={commit}
              singleScrollRefFor={() => vi.fn()}
              panelElement={null}
              useCustomCSS={false}
              t={(key) => key}
            />
          ),
        );
      });
      if (type === 'knob') {
        const configure = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'propertiesPanel.configure',
        );
        act(() => configure?.click());
      }

      act(() => {
        captured.image?.onActiveImageChange('  active.png  ');
        captured.image?.onActiveImageReset();
      });

      expect(captured.image?.completionBinding).toBe('element-id');
      expect(commit.mock.calls).toEqual([['  active.png  '], ['']]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('knob ImagePicker는 두 state image fit exact callback만 호출한다', () => {
    const idleFit = vi.fn();
    const activeFit = vi.fn();
    const legacy = vi.fn();
    act(() => {
      root.render(
        <SingleKnobPanel
          setPanelElement={vi.fn()}
          singleKnobPosition={{
            ...createDefaultKeyPosition(),
            axisId: 'HIDA:test',
            sensitivity: 1,
            reverse: false,
          }}
          singleKnobIndex={0}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>()}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          handleKnobUpdate={legacy}
          onIdleImageFitCommit={idleFit}
          onActiveImageFitCommit={activeFit}
          singleScrollRefFor={() => vi.fn()}
          panelElement={null}
          useCustomCSS={false}
          t={(key) => key}
        />,
      );
    });
    const configure = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'propertiesPanel.configure',
    );
    act(() => configure?.click());
    act(() => {
      captured.image?.onIdleImageFitChange?.('contain');
      captured.image?.onActiveImageFitChange?.('fill');
    });

    expect(idleFit).toHaveBeenCalledWith('contain');
    expect(activeFit).toHaveBeenCalledWith('fill');
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['graph', 'knob'] as const)(
    '%s ImagePicker load와 reset은 stable callback이 있으면 legacy를 쓰지 않는다',
    (type) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      const common = {
        setPanelElement: vi.fn(),
        selectedKeyType: '4key',
        isRenaming: false,
        renameInputRef: createRef<HTMLInputElement>(),
        renameValue: '',
        setRenameValue: vi.fn(),
        renameCancelledRef: { current: false },
        handleRenameCommit: vi.fn(),
        handleRenameCancel: vi.fn(),
        handleRenameStart: vi.fn(),
        onInactiveImageCommit: commit,
        singleScrollRefFor: () => vi.fn(),
        panelElement: null,
        useCustomCSS: false,
        t: (key: string) => key,
      };
      act(() => {
        root.render(
          type === 'graph' ? (
            <SingleGraphPanel
              {...common}
              singleGraphPosition={{
                ...createDefaultKeyPosition(),
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1000,
                graphColor: '#fff',
              }}
              singleGraphIndex={0}
              handleGraphUpdate={legacy}
              showGraphImagePicker
              setShowGraphImagePicker={vi.fn()}
              graphImageButtonRef={{
                current: document.createElement('button'),
              }}
              graphClassNameDraft=""
              setGraphClassNameDraft={vi.fn()}
            />
          ) : (
            <SingleKnobPanel
              {...common}
              singleKnobPosition={{
                ...createDefaultKeyPosition(),
                axisId: 'HIDA:test',
                sensitivity: 1,
                reverse: false,
              }}
              singleKnobIndex={0}
              handleKnobUpdate={legacy}
            />
          ),
        );
      });
      if (type === 'knob') {
        const configure = [...container.querySelectorAll('button')].find(
          (button) => button.textContent === 'propertiesPanel.configure',
        );
        act(() => configure?.click());
      }

      act(() => {
        captured.image?.onIdleImageChange('picked.png');
        captured.image?.onIdleImageReset();
      });

      expect(captured.image?.completionBinding).toBe('element-id');
      expect(commit.mock.calls).toEqual([['picked.png'], ['']]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  // 커밋 패치 모양 계약. 단일 패널은 태그 유니온만 받는 핸들러에 물리므로
  // 단일 키 객체를 보내면 wire 검증에서 조용히 폐기된다
  describe('요소 속성 커밋 패치 모양', () => {
    const assertTagged = (commit: ReturnType<typeof vi.fn>) => {
      expect(commit).toHaveBeenCalled();
      for (const [patch] of commit.mock.calls) {
        expect(isEditorElementPropertyPatchV1(patch, 'key')).toBe(true);
      }
    };

    it('NOTE 탭 리터럴 토글이 태그 유니온으로 커밋한다', () => {
      const commit = vi.fn();
      act(() => {
        root.render(
          <NoteTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            onElementPropertyCommit={commit}
            t={(key: string) => key}
          />,
        );
      });
      expect(captured.checkboxes.length).toBeGreaterThan(0);
      act(() => {
        captured.checkboxes.forEach((checkbox) => checkbox.onChange());
      });
      assertTagged(commit);
    });

    it('NOTE 탭 드롭다운 선택이 태그 유니온 모양으로 커밋한다', () => {
      const commit = vi.fn();
      act(() => {
        root.render(
          <NoteTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            onElementPropertyCommit={commit}
            t={(key: string) => key}
          />,
        );
      });
      expect(captured.dropdowns.length).toBeGreaterThan(0);
      act(() => {
        captured.dropdowns.forEach((dropdown) => dropdown.onChange('center'));
      });
      // 값 유효성은 드롭다운마다 다르므로 여기서는 모양만 본다.
      // 회귀는 단일 키 객체를 보내던 데서 났다
      expect(commit).toHaveBeenCalled();
      for (const [patch] of commit.mock.calls) {
        expect(Object.keys(patch as object).sort()).toEqual([
          'property',
          'value',
        ]);
      }
    });

    it('STYLE 탭 글꼴 스타일 토글이 태그 유니온으로 커밋한다', () => {
      const commit = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyCode="A"
            keyInfo={null}
            keyPosition={createDefaultKeyPosition()}
            onElementPropertyCommit={commit}
            t={(key: string) => key}
          />,
        );
      });
      expect(captured.fontStyle).not.toBeNull();
      act(() => {
        captured.fontStyle?.onBoldChange?.(true);
        captured.fontStyle?.onItalicChange?.(true);
        captured.fontStyle?.onUnderlineChange?.(true);
        captured.fontStyle?.onStrikethroughChange?.(true);
      });
      assertTagged(commit);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('stable W/H untouched blur는 stale local sibling을 저장하지 않는다', () => {
    const geometry = vi.fn();
    const legacySize = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={createDefaultKeyPosition()}
          keyCode="A"
          keyInfo={{ globalKey: 'A', displayName: 'A' }}
          onPositionChange={vi.fn()}
          onKeyUpdate={vi.fn()}
          onGeometryCommit={geometry}
          localWidth={999}
          localHeight={998}
          onLocalDxChange={vi.fn()}
          onLocalDyChange={vi.fn()}
          onLocalWidthChange={vi.fn()}
          onLocalHeightChange={vi.fn()}
          onSizeBlur={legacySize}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.numbers.get('W')?.onBlur?.());
    act(() => captured.numbers.get('H')?.onBlur?.());

    expect(geometry).not.toHaveBeenCalled();
    expect(legacySize).not.toHaveBeenCalled();
  });

  it.each(['graph', 'knob'] as const)(
    '%s X/Y/W/H는 stable handler가 있으면 legacy writer를 호출하지 않는다',
    (type) => {
      const geometry = vi.fn();
      const legacy = vi.fn();
      const common = {
        setPanelElement: vi.fn(),
        selectedKeyType: '4key',
        isRenaming: false,
        renameInputRef: createRef<HTMLInputElement>(),
        renameValue: '',
        setRenameValue: vi.fn(),
        renameCancelledRef: { current: false },
        handleRenameCommit: vi.fn(),
        handleRenameCancel: vi.fn(),
        handleRenameStart: vi.fn(),
        handleGeometryCommit: geometry,
        singleScrollRefFor: () => vi.fn(),
        panelElement: null,
        useCustomCSS: false,
        t: (key: string) => key,
      };
      act(() => {
        root.render(
          type === 'graph' ? (
            <SingleGraphPanel
              {...common}
              singleGraphPosition={{
                ...createDefaultKeyPosition(),
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1000,
                graphColor: '#fff',
              }}
              singleGraphIndex={0}
              handleGraphUpdate={legacy}
              showGraphImagePicker={false}
              setShowGraphImagePicker={vi.fn()}
              graphImageButtonRef={createRef<HTMLButtonElement>()}
              graphClassNameDraft=""
              setGraphClassNameDraft={vi.fn()}
            />
          ) : (
            <SingleKnobPanel
              {...common}
              singleKnobPosition={{
                ...createDefaultKeyPosition(),
                axisId: 'HIDA:test',
                sensitivity: 1,
                reverse: false,
              }}
              singleKnobIndex={0}
              handleKnobUpdate={legacy}
            />
          ),
        );
      });

      act(() => captured.numbers.get('X')?.onChange(12));
      act(() => captured.numbers.get('Y')?.onChange(13));
      act(() => captured.numbers.get('W')?.onChange(140));
      act(() => captured.numbers.get('H')?.onChange(150));

      expect(geometry.mock.calls).toEqual([
        ['dx', 12],
        ['dy', 13],
        ['width', 140],
        ['height', 150],
      ]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['graph', 'knob'] as const)(
    '%s className은 local draft 뒤 blur에서만 stable exact commit한다',
    (type) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      const setGraphDraft = vi.fn();
      const common = {
        setPanelElement: vi.fn(),
        selectedKeyType: '4key',
        isRenaming: false,
        renameInputRef: createRef<HTMLInputElement>(),
        renameValue: '',
        setRenameValue: vi.fn(),
        renameCancelledRef: { current: false },
        handleRenameCommit: vi.fn(),
        handleRenameCancel: vi.fn(),
        handleRenameStart: vi.fn(),
        onStylePropertyCommit: commit,
        singleScrollRefFor: () => vi.fn(),
        panelElement: null,
        useCustomCSS: true,
        t: (key: string) => key,
      };
      act(() => {
        root.render(
          type === 'graph' ? (
            <SingleGraphPanel
              {...common}
              singleGraphPosition={{
                ...createDefaultKeyPosition(),
                className: 'BeforeClass',
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1000,
                graphColor: '#fff',
              }}
              singleGraphIndex={0}
              handleGraphUpdate={legacy}
              showGraphImagePicker={false}
              setShowGraphImagePicker={vi.fn()}
              graphImageButtonRef={createRef<HTMLButtonElement>()}
              graphClassNameDraft="BeforeClass"
              setGraphClassNameDraft={setGraphDraft}
            />
          ) : (
            <SingleKnobPanel
              {...common}
              singleKnobPosition={{
                ...createDefaultKeyPosition(),
                className: 'BeforeClass',
                axisId: 'HIDA:test',
                sensitivity: 1,
                reverse: false,
              }}
              singleKnobIndex={0}
              handleKnobUpdate={legacy}
            />
          ),
        );
      });
      const input = captured.texts.find(
        (candidate) => candidate.value === 'BeforeClass',
      );
      act(() => input?.onChange('DraftClass'));
      expect(commit).not.toHaveBeenCalled();
      if (type === 'graph') {
        expect(setGraphDraft).toHaveBeenCalledWith('DraftClass');
      }
      act(() => input?.onBlur?.('  Final class  '));

      expect(commit).toHaveBeenCalledOnce();
      expect(commit).toHaveBeenCalledWith({
        property: 'className',
        value: '  Final class  ',
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['graph', 'borderWidth', 0, 20, 20],
    ['graph', 'borderRadius', 0, 100, 100],
    ['knob', 'borderWidth', 0, 20, 20],
    ['knob', 'borderRadius', 0, 999, 999],
  ] as const)(
    '%s %s direct NumberInput은 preview 없이 stable exact commit한다',
    (type, property, min, max, value) => {
      const commit = vi.fn();
      const legacy = vi.fn();
      const common = {
        setPanelElement: vi.fn(),
        selectedKeyType: '4key',
        isRenaming: false,
        renameInputRef: createRef<HTMLInputElement>(),
        renameValue: '',
        setRenameValue: vi.fn(),
        renameCancelledRef: { current: false },
        handleRenameCommit: vi.fn(),
        handleRenameCancel: vi.fn(),
        handleRenameStart: vi.fn(),
        onStylePropertyCommit: commit,
        singleScrollRefFor: () => vi.fn(),
        panelElement: null,
        useCustomCSS: false,
        t: (key: string) => key,
      };
      act(() => {
        root.render(
          type === 'graph' ? (
            <SingleGraphPanel
              {...common}
              singleGraphPosition={{
                ...createDefaultKeyPosition(),
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1000,
                graphColor: '#fff',
              }}
              singleGraphIndex={0}
              handleGraphUpdate={legacy}
              showGraphImagePicker={false}
              setShowGraphImagePicker={vi.fn()}
              graphImageButtonRef={createRef<HTMLButtonElement>()}
              graphClassNameDraft=""
              setGraphClassNameDraft={vi.fn()}
            />
          ) : (
            <SingleKnobPanel
              {...common}
              singleKnobPosition={{
                ...createDefaultKeyPosition(),
                axisId: 'HIDA:test',
                sensitivity: 1,
                reverse: false,
              }}
              singleKnobIndex={0}
              handleKnobUpdate={legacy}
            />
          ),
        );
      });
      const input = [...captured.numberList]
        .reverse()
        .find((candidate) => candidate.min === min && candidate.max === max);
      expect(input?.onPreview).toBeUndefined();
      act(() => input?.onChange(value));

      expect(commit).toHaveBeenCalledWith({ property, value });
      expect(legacy).not.toHaveBeenCalled();
    },
  );
});
