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
    stateMode?: string;
    onStateModeChange?: (mode: string) => void;
    onColorChange: (color: string) => void;
    onColorChangeComplete: (color: string) => void;
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
const elementPatch = vi.hoisted(() => ({
  applyElementPatchById: vi.fn(async () => true),
}));

vi.mock('@src/renderer/editor/runtime/elementPatch', () => elementPatch);
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: vi.fn(),
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
    onPreview?: (value: { mode: 'solid'; color: string }) => void;
    onCommit: (value: { mode: 'solid'; color: string }) => void;
  }) => ({
    pickerColor: '#ffffff',
    handlePickerColorChange: (color: string, commit: boolean) =>
      commit
        ? onCommit({ mode: 'solid', color })
        : onPreview?.({ mode: 'solid', color }),
  }),
}));
vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: { subscribe: () => vi.fn() },
}));

import StyleTabContent from './StyleTabContent';
import NoteTabContent from './NoteTabContent';
import CounterTabContent from './CounterTabContent';
import {
  SingleGraphPanel,
  SingleKeyStatPanel,
  SingleKnobPanel,
} from './SingleSelectionPanel';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

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
    elementPatch.applyElementPatchById.mockClear();
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
        [{ shadow: { blur: 22 } }],
        [{ shadowEnabled: false }],
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
      [{ activeShadow: { color: ' raw ' } }],
      [{ shadowEnabled: true }],
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
    expect(preview).toHaveBeenCalledWith({ noteGlowSize: 20.5 });
    expect(commit).not.toHaveBeenCalled();
    act(() => glow?.onChange(21.5));
    expect(commit).toHaveBeenCalledWith({ noteGlowSize: 21.5 });
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
      [{ noteOffsetX: 0 }],
      [{ noteOffsetY: null }],
    ]);
    expect(commit.mock.calls).toEqual([
      [{ noteOffsetX: 0 }],
      [{ noteOffsetY: null }],
      [{ noteWidth: null }],
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
      [{ noteBorderWidth: 2.5 }],
      [{ noteBorderRadius: 12.5 }],
    ]);
    expect(commit.mock.calls).toEqual([
      [{ noteBorderWidth: 3.5 }],
      [{ noteBorderRadius: 13.5 }],
    ]);
  });

  it('single NoteTab actual picker는 local drag 뒤 color, full opacity, border pair를 exact commit한다', () => {
    const commit = vi.fn();
    const legacyPreview = vi.fn();
    const legacyCommit = vi.fn();
    act(() => {
      root.render(
        <NoteTabContent
          keyIndex={4}
          keyPosition={{
            ...createDefaultKeyPosition(),
            noteOpacity: 80,
            noteOpacityTop: 70,
            noteOpacityBottom: 60,
          }}
          onKeyUpdate={legacyCommit}
          onKeyPreview={legacyPreview}
          onNotePaintCommit={commit}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.swatches[0]?.onClick());
    act(() => captured.color?.onColorChange('drag-only'));
    expect(legacyPreview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    act(() => captured.color?.onColorChangeComplete(' final-note '));
    expect(legacyPreview).toHaveBeenLastCalledWith(4, {
      noteColor: ' final-note ',
    });
    expect(commit).toHaveBeenLastCalledWith({
      notePaint: { color: ' final-note ' },
    });

    act(() => captured.color?.onOpacityPercentChangeComplete?.(45, 'top'));
    expect(legacyPreview).toHaveBeenLastCalledWith(4, {
      noteOpacity: 53,
      noteOpacityTop: 45,
      noteOpacityBottom: 60,
    });
    expect(commit).toHaveBeenLastCalledWith({
      notePaint: { opacity: 53, opacityTop: 45, opacityBottom: 60 },
    });

    act(() => captured.swatches[2]?.onClick());
    act(() => captured.color?.onColorChangeComplete(' final-glow '));
    expect(commit).toHaveBeenLastCalledWith({
      noteGlowPaint: { color: ' final-glow ' },
    });
    act(() => captured.color?.onOpacityPercentChangeComplete?.(35, 'solid'));
    expect(commit).toHaveBeenLastCalledWith({
      noteGlowPaint: { opacity: 35, opacityTop: 35, opacityBottom: 35 },
    });

    act(() => captured.swatches[1]?.onClick());
    act(() => captured.color?.onColorChangeComplete('#A0B1C280'));
    expect(commit).toHaveBeenLastCalledWith({
      noteBorderPaint: { color: '#A0B1C2', opacity: 50 },
    });
    expect(legacyCommit).not.toHaveBeenCalled();
  });

  it('single NoteTab actual picker callback이 없으면 preview와 whole legacy writer를 유지한다', () => {
    const preview = vi.fn();
    const legacy = vi.fn();
    act(() => {
      root.render(
        <NoteTabContent
          keyIndex={2}
          keyPosition={createDefaultKeyPosition()}
          onKeyUpdate={legacy}
          onKeyPreview={preview}
          t={(key) => key}
        />,
      );
    });
    act(() => captured.swatches[2]?.onClick());
    act(() => captured.color?.onColorChangeComplete('legacy-glow'));

    expect(preview).toHaveBeenCalledWith(2, { noteGlowColor: 'legacy-glow' });
    expect(legacy).toHaveBeenCalledWith({
      index: 2,
      noteGlowColor: 'legacy-glow',
    });
  });

  it('single NoteTab noteGlowSize callback이 없으면 기존 preview와 whole writer다', () => {
    const legacyPreview = vi.fn();
    const legacyCommit = vi.fn();
    act(() => {
      root.render(
        <NoteTabContent
          keyIndex={3}
          keyPosition={{ ...createDefaultKeyPosition(), noteGlowSize: 20 }}
          onKeyUpdate={legacyCommit}
          onKeyPreview={legacyPreview}
          t={(key) => key}
        />,
      );
    });
    const glow = captured.numberList.find(
      (input) => input.min === 0 && input.max === 50,
    );
    act(() => glow?.onPreview?.(20.5));
    act(() => glow?.onChange(21.5));
    expect(legacyPreview).toHaveBeenCalledWith(3, { noteGlowSize: 20.5 });
    expect(legacyCommit).toHaveBeenCalledWith({
      index: 3,
      noteGlowSize: 21.5,
    });
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

      expect(preview).toHaveBeenCalledWith({ [property]: value });
      expect(commit).toHaveBeenCalledWith({ [property]: value });
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
        backgroundPaint: { color: ' final ', gradient: null },
      });
      if (activeReachable) {
        act(() => captured.color?.onStateModeChange?.('active'));
        act(() => captured.color?.onColorChangeComplete(' active '));
        expect(paint).toHaveBeenLastCalledWith({
          activeBackgroundPaint: { color: ' active ', gradient: null },
        });
      }
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it('graph paint는 exact gradient pair를 final callback으로만 전달한다', async () => {
    const paint = vi.fn();
    const legacy = vi.fn();
    act(() => {
      root.render(
        <SingleGraphPanel
          setPanelElement={vi.fn()}
          singleGraphPosition={{
            ...createDefaultKeyPosition(),
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
      backgroundPaint: {
        color: '#first',
        gradient,
      },
    });
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['key', 'stat'] as const)(
    '%s synthetic numeric style actual input은 preview와 final 모두 기존 writer를 쓴다',
    (type) => {
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      const captureStart = captured.numberList.length;
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={3}
            keyPosition={{
              ...createDefaultKeyPosition(),
              id: `${type}-3`,
            }}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacyCommit}
            onKeyPreview={legacyPreview}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      const input = captured.numberList
        .slice(captureStart)
        .find(({ min, max }) => min === 0 && max === 20);

      act(() => input?.onPreview?.(15));
      act(() => input?.onChange(15));

      expect(legacyPreview).toHaveBeenCalledWith(3, { borderWidth: 15 });
      expect(legacyCommit).toHaveBeenCalledWith({
        index: 3,
        borderWidth: 15,
      });
    },
  );

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

      expect(preview).toHaveBeenCalledWith({ displayText: '  Preview  ' });
      expect(commit).toHaveBeenCalledWith({ displayText: '  Final  ' });
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
        className: '  Preview class  ',
      });
      expect(commit).toHaveBeenCalledWith({ className: '  Final class  ' });
      expect(legacyPreview).not.toHaveBeenCalled();
      expect(legacyCommit).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'stat'] as const)(
    '%s StyleTab className exact callback이 없으면 preview와 whole legacy를 유지한다',
    (type) => {
      const preview = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={3}
            keyPosition={{
              ...createDefaultKeyPosition(),
              id: `${type}-3`,
              className: 'BeforeClass',
            }}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onKeyPreview={preview}
            showSoundControls={false}
            useCustomCSS
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      const input = captured.texts.find(
        (candidate) => candidate.value === 'BeforeClass',
      );
      act(() => input?.onChange('PreviewClass'));
      act(() => input?.onBlur?.('FinalClass'));

      expect(preview).toHaveBeenCalledWith(3, {
        className: 'PreviewClass',
      });
      expect(legacy).toHaveBeenCalledWith({
        index: 3,
        className: 'FinalClass',
      });
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
      displayText: '  Final label  ',
    });

    act(() => input.blur());
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith({ displayText: '  Final label  ' });
    expect(preview.mock.invocationCallOrder[0]).toBeLessThan(
      commit.mock.invocationCallOrder[0],
    );
  });

  it.each(['key', 'stat'] as const)(
    '%s StyleTab displayText exact callback이 없으면 preview와 whole legacy를 유지한다',
    (type) => {
      const preview = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={3}
            keyPosition={{ ...createDefaultKeyPosition(), displayText: '' }}
            keyCode={type === 'key' ? 'A' : null}
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacy}
            onKeyPreview={preview}
            showSoundControls={false}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });
      const displayText = captured.texts.find((input) => input.value === '');
      act(() => displayText?.onChange('Preview'));
      act(() => displayText?.onBlur?.('Final'));

      expect(preview).toHaveBeenCalledWith(3, { displayText: 'Preview' });
      expect(legacy).toHaveBeenCalledWith({
        index: 3,
        displayText: 'Final',
      });
    },
  );

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
        counterFontFamily: '  Raw Counter Family  ',
      });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['key', 'stat'] as const)(
    '%s counter FontPicker는 exact callback이 없으면 raw family whole legacy를 유지한다',
    (type) => {
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
            t={(key) => key}
          />,
        );
      });

      act(() => captured.font?.onFontSelect('  Legacy Counter Family  '));

      expect(legacy).toHaveBeenCalledWith({
        index: 0,
        counter: expect.objectContaining({
          fontFamily: '  Legacy Counter Family  ',
        }),
      });
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
        [{ counterFontSize: 72 }],
        [{ counterFontWeight: 700 }],
        [{ counterFontItalic: true }],
        [{ counterFontUnderline: true }],
        [{ counterFontStrikethrough: true }],
      ]);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['key', 'idle', { counterStrokeIdle: '  idle stroke  ' }],
    ['key', 'active', { counterStrokeActive: '  active stroke  ' }],
    ['stat', 'idle', { counterStrokeIdle: '' }],
  ] as const)(
    '%s counter stroke %s picker는 drag local-only 뒤 final exact commit한다',
    (type, state, expected) => {
      const stroke = vi.fn();
      const legacy = vi.fn();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={createDefaultKeyPosition()}
            isStat={type === 'stat'}
            onKeyUpdate={legacy}
            onCounterStrokeCommit={stroke}
            t={(key) => key}
          />,
        );
      });
      act(() => captured.swatches.at(-1)?.onClick());
      if (state === 'active') {
        act(() => captured.color?.onStateModeChange?.('active'));
      }
      const value = Object.values(expected)[0];
      act(() => captured.color?.onColorChange(value));
      expect(stroke).not.toHaveBeenCalled();
      act(() => captured.color?.onColorChangeComplete(value));

      expect(stroke).toHaveBeenCalledWith(expected);
      expect(legacy).not.toHaveBeenCalled();
      if (type === 'stat') {
        expect(captured.color?.onStateModeChange).toBeUndefined();
      }
    },
  );

  it.each([
    ['key synthetic', false],
    ['stat empty', true],
  ] as const)(
    '%s counter stroke actual picker는 whole-counter legacy로 폴백한다',
    (_label, isStat) => {
      const legacy = vi.fn();
      act(() => {
        root.render(
          <CounterTabContent
            keyIndex={0}
            keyPosition={{
              ...createDefaultKeyPosition(),
              id: isStat ? '' : 'key-0',
            }}
            isStat={isStat}
            onKeyUpdate={legacy}
            t={(key) => key}
          />,
        );
      });
      act(() => captured.swatches.at(-1)?.onClick());
      act(() => captured.color?.onColorChangeComplete('legacy-stroke'));

      expect(legacy).toHaveBeenCalledWith({
        index: 0,
        counter: expect.objectContaining({
          stroke: expect.objectContaining({ idle: 'legacy-stroke' }),
        }),
      });
    },
  );

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

  it.each([
    ['synthetic', 'key-0'],
    ['empty', undefined],
  ] as const)(
    '%s key transparency는 stable callback이 없으면 preview와 index legacy를 유지한다',
    (_label, id) => {
      const preview = vi.fn();
      const legacy = vi.fn();
      const position = { ...createDefaultKeyPosition(), ...(id ? { id } : {}) };
      act(() => {
        root.render(
          <StyleTabContent
            keyIndex={0}
            keyPosition={position}
            keyCode="A"
            keyInfo={null}
            onPositionChange={vi.fn()}
            onKeyPreview={preview}
            onKeyUpdate={legacy}
            showImagePicker
            onToggleImagePicker={vi.fn()}
            imageButtonRef={{ current: document.createElement('button') }}
            panelElement={null}
            t={(key) => key}
          />,
        );
      });

      act(() => captured.image?.onIdleTransparentChange?.(true));
      expect(preview).toHaveBeenCalledWith(0, { idleTransparent: true });
      expect(legacy).toHaveBeenCalledWith({ index: 0, idleTransparent: true });
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
        [{ counterPlacement: 'outside' }],
        [{ counterAlign: 'right' }],
        [{ counterAlignMode: 'between' }],
        [{ counterGap: 9999 }],
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

  it('key StyleTab soundEnabled callback이 없으면 preview와 index legacy를 유지한다', () => {
    const legacy = vi.fn();
    const preview = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={3}
          keyPosition={{
            ...createDefaultKeyPosition(),
            id: 'key-3',
            soundEnabled: false,
          }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={legacy}
          onKeyPreview={preview}
          showSoundControls
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.checkboxes.at(-1)?.onChange());
    expect(preview).toHaveBeenCalledWith(3, { soundEnabled: true });
    expect(legacy).toHaveBeenCalledWith({ index: 3, soundEnabled: true });
  });

  it('key StyleTab soundVolume은 preview를 유지하고 clamp된 final만 exact callback에 보낸다', () => {
    const commit = vi.fn();
    const legacy = vi.fn();
    const preview = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={3}
          keyPosition={{ ...createDefaultKeyPosition(), soundVolume: 80 }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={legacy}
          onKeyPreview={preview}
          onSoundVolumeCommit={commit}
          showSoundControls
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.numbers.get('%')?.onPreview?.(137.5));
    act(() => captured.numbers.get('%')?.onChange(250));
    expect(preview).toHaveBeenCalledWith(3, { soundVolume: 137.5 });
    expect(commit).toHaveBeenCalledWith(200);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('key StyleTab soundVolume callback이 없으면 preview와 index legacy를 유지한다', () => {
    const legacy = vi.fn();
    const preview = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={3}
          keyPosition={{ ...createDefaultKeyPosition(), id: 'key-3' }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={legacy}
          onKeyPreview={preview}
          showSoundControls
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.numbers.get('%')?.onPreview?.(42));
    act(() => captured.numbers.get('%')?.onChange(-1));
    expect(preview).toHaveBeenCalledWith(3, { soundVolume: 42 });
    expect(legacy).toHaveBeenCalledWith({ index: 3, soundVolume: 0 });
  });

  it('synthetic key SoundPicker select와 clear는 기존 index writer를 유지한다', () => {
    const legacy = vi.fn();
    captured.nav.activePageKey = 'single-style:sound';
    captured.nav.renderPageKey = 'single-style:sound';
    captured.nav.pageHost = document.body;
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={3}
          keyPosition={{ ...createDefaultKeyPosition(), id: 'key-3' }}
          keyCode="A"
          keyInfo={null}
          onPositionChange={vi.fn()}
          onKeyUpdate={legacy}
          showSoundControls
          panelElement={null}
          t={(key) => key}
        />,
      );
    });

    expect(captured.sound?.completionBinding).toBe('session-mode');
    act(() => captured.sound?.onSoundSelect('legacy.wav'));
    act(() => captured.sound?.onSoundSelect(''));

    expect(legacy.mock.calls).toEqual([
      [{ index: 3, soundPath: 'legacy.wav' }],
      [{ index: 3, soundPath: '' }],
    ]);
    expect(elementPatch.applyElementPatchById).not.toHaveBeenCalled();
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

  it('synthetic CounterAnimationPicker는 whole counter legacy를 유지한다', () => {
    const legacy = vi.fn();
    captured.nav.activePageKey = 'single-counter:animation';
    captured.nav.renderPageKey = 'single-counter:animation';
    captured.nav.pageHost = document.body;
    const position = { ...createDefaultKeyPosition(), id: 'key-0' };
    act(() => {
      root.render(
        <CounterTabContent
          keyIndex={0}
          keyPosition={position}
          onKeyUpdate={legacy}
          t={(key) => key}
        />,
      );
    });
    expect(captured.animation?.completionBinding).toBe('session-mode');
    const next = { ...position.counter.animation, presetId: 'preset-b' };
    act(() => captured.animation?.onAnimationChange(next));
    expect(legacy).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 0,
        counter: expect.objectContaining({ animation: next }),
      }),
    );
  });

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

  it('graph ImagePicker는 active writer를 노출하지 않는다', () => {
    const legacy = vi.fn();
    const fit = vi.fn();
    act(() => {
      root.render(
        <SingleGraphPanel
          setPanelElement={vi.fn()}
          singleGraphPosition={{
            ...createDefaultKeyPosition(),
            statType: 'kps',
            graphType: 'line',
            graphSpeed: 1000,
            graphColor: '#fff',
            idleTransparent: true,
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
          onIdleImageFitCommit={fit}
          showGraphImagePicker
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

    expect(captured.image?.onActiveImageChange).toBeUndefined();
    expect(captured.image?.onActiveImageReset).toBeUndefined();
    expect(captured.image?.idleTransparent).toBe(true);
    expect(captured.image?.onActiveImageFitChange).toBeUndefined();
    act(() => captured.image?.onIdleTransparentChange?.(false));
    act(() => captured.image?.onIdleImageFitChange?.('contain'));
    expect(legacy).toHaveBeenCalledWith({ index: 0, idleTransparent: false });
    expect(fit).toHaveBeenCalledWith('contain');
    expect(captured.image?.onIdleImageChange).toBeTypeOf('function');
    expect(captured.image?.onIdleImageReset).toBeTypeOf('function');
  });

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

  it.each(['key', 'knob'] as const)(
    '%s idless active ImagePicker load와 reset은 기존 writer만 쓴다',
    (type) => {
      const legacy = vi.fn();
      const idless = { ...createDefaultKeyPosition(), id: undefined };
      act(() => {
        root.render(
          type === 'key' ? (
            <StyleTabContent
              keyIndex={0}
              keyPosition={idless}
              keyCode="A"
              keyInfo={null}
              onPositionChange={vi.fn()}
              onKeyUpdate={legacy}
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
                ...idless,
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
        captured.image?.onActiveImageChange?.('legacy-active.png');
        captured.image?.onActiveImageReset?.();
      });

      expect(captured.image?.completionBinding).toBe('session-mode');
      expect(elementPatch.applyElementPatchById).not.toHaveBeenCalled();
      expect(legacy).toHaveBeenCalledTimes(2);
    },
  );

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

  it.each(['key', 'stat', 'graph', 'knob'] as const)(
    '%s idless ImagePicker load와 reset은 기존 writer만 쓴다',
    (type) => {
      const legacy = vi.fn();
      const idless = { ...createDefaultKeyPosition(), id: undefined };
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
        singleScrollRefFor: () => vi.fn(),
        panelElement: null,
        useCustomCSS: false,
        t: (key: string) => key,
      };
      act(() => {
        root.render(
          type === 'key' || type === 'stat' ? (
            <StyleTabContent
              keyIndex={0}
              keyPosition={idless}
              keyCode={type === 'key' ? 'A' : null}
              keyInfo={null}
              onPositionChange={vi.fn()}
              onKeyUpdate={legacy}
              showImagePicker
              onToggleImagePicker={vi.fn()}
              imageButtonRef={{ current: document.createElement('button') }}
              shadowActiveState={false}
              showSoundControls={false}
              panelElement={null}
              t={(key) => key}
            />
          ) : type === 'graph' ? (
            <SingleGraphPanel
              {...common}
              singleGraphPosition={{
                ...idless,
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
                ...idless,
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
        captured.image?.onIdleImageChange('legacy.png');
        captured.image?.onIdleImageReset();
      });

      expect(captured.image?.completionBinding).toBe('session-mode');
      expect(elementPatch.applyElementPatchById).not.toHaveBeenCalled();
      expect(legacy).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['graph', 'knob'] as const)(
    '%s stable ImagePicker 기존 경로는 load ID 적용과 reset index 저장을 구분한다',
    (type) => {
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
        captured.image?.onIdleImageChange('legacy.png');
        captured.image?.onIdleImageReset();
      });
      expect(captured.image?.completionBinding).toBe('element-id');
      expect(elementPatch.applyElementPatchById).toHaveBeenCalledTimes(1);
      expect(legacy).toHaveBeenCalledTimes(1);
    },
  );

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('key/stat StyleTab은 X/Y preview와 blur commit을 축별로 연결한다', () => {
    const geometry = vi.fn();
    const legacyPosition = vi.fn();
    const legacySize = vi.fn();
    const preview = vi.fn();
    act(() => {
      root.render(
        <StyleTabContent
          keyIndex={0}
          keyPosition={createDefaultKeyPosition()}
          keyCode="A"
          keyInfo={{ globalKey: 'A', displayName: 'A' }}
          onPositionChange={legacyPosition}
          onKeyUpdate={vi.fn()}
          onKeyPreview={preview}
          onGeometryCommit={geometry}
          onLocalDxChange={vi.fn()}
          onLocalDyChange={vi.fn()}
          onLocalWidthChange={vi.fn()}
          onLocalHeightChange={vi.fn()}
          onSizeBlur={legacySize}
          t={(key) => key}
        />,
      );
    });

    act(() => captured.numbers.get('X')?.onPreview?.(12));
    act(() => captured.numbers.get('X')?.onChange(12));
    act(() => captured.numbers.get('Y')?.onChange(13));
    act(() => captured.numbers.get('W')?.onChange(140));
    act(() => captured.numbers.get('W')?.onBlur?.(140));
    act(() => captured.numbers.get('H')?.onChange(150));
    act(() => captured.numbers.get('H')?.onBlur?.(150));

    expect(preview).toHaveBeenCalledWith(0, { dx: 12 });
    expect(geometry.mock.calls).toEqual([
      ['dx', 12],
      ['dy', 13],
      ['width', 140],
      ['height', 150],
    ]);
    expect(legacyPosition).not.toHaveBeenCalled();
    expect(legacySize).not.toHaveBeenCalled();
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

  it('stat type 두 dropdown은 계산 완료된 absolute enum을 기존 handler에 넘긴다', () => {
    const update = vi.fn();
    const statPosition = {
      ...createDefaultKeyPosition(),
      statType: 'kpsAvg' as const,
    };
    act(() => {
      root.render(
        <SingleKeyStatPanel
          setPanelElement={vi.fn()}
          isSingleStat
          isSingleKey={false}
          singleKeyIndex={null}
          singleStatIndex={0}
          singleKeyPosition={null}
          singleStatPosition={statPosition}
          singleKeyCode={null}
          singleKeySlot={null}
          singleKeyInfo={null}
          selectedKeyType="4key"
          isRenaming={false}
          renameInputRef={createRef<HTMLInputElement>()}
          renameValue=""
          setRenameValue={vi.fn()}
          renameCancelledRef={{ current: false }}
          handleRenameCommit={vi.fn()}
          handleRenameCancel={vi.fn()}
          handleRenameStart={vi.fn()}
          activeTab="style"
          setActiveTab={vi.fn()}
          onPositionChange={vi.fn()}
          onKeyUpdate={vi.fn()}
          handleStatUpdate={update}
          handleStatPreview={vi.fn()}
          localState={{}}
          setLocalState={vi.fn()}
          handleSizeBlur={vi.fn()}
          showImagePicker={false}
          setShowImagePicker={vi.fn()}
          imageButtonRef={createRef<HTMLButtonElement>()}
          panelElement={null}
          useCustomCSS={false}
          singleScrollRefFor={() => vi.fn()}
          t={(key) => key}
        />,
      );
    });
    const base = captured.dropdowns.find(
      (dropdown) => dropdown.value === 'kps',
    );
    const detail = captured.dropdowns.find(
      (dropdown) => dropdown.value === 'kpsAvg',
    );

    act(() => base?.onChange('total'));
    act(() => base?.onChange('kps'));
    act(() => detail?.onChange('kpsMax'));

    expect(update.mock.calls).toEqual([
      [{ index: 0, statType: 'total' }],
      [{ index: 0, statType: 'kpsAvg' }],
      [{ index: 0, statType: 'kpsMax' }],
    ]);
  });

  it.each([
    ['synthetic', 'key-0'],
    ['empty', ''],
  ] as const)(
    'SingleKeyStatPanel %s noteGlowSize는 actual NoteTab에서 legacy preview와 writer를 유지한다',
    (_label, id) => {
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      act(() => {
        root.render(
          <SingleKeyStatPanel
            setPanelElement={vi.fn()}
            isSingleStat={false}
            isSingleKey
            singleKeyIndex={0}
            singleStatIndex={null}
            singleKeyPosition={{
              ...createDefaultKeyPosition(),
              id,
              noteGlowSize: 20,
            }}
            singleStatPosition={null}
            singleKeyCode="A"
            singleKeySlot="A"
            singleKeyInfo={null}
            selectedKeyType="4key"
            isRenaming={false}
            renameInputRef={createRef<HTMLInputElement>()}
            renameValue=""
            setRenameValue={vi.fn()}
            renameCancelledRef={{ current: false }}
            handleRenameCommit={vi.fn()}
            handleRenameCancel={vi.fn()}
            handleRenameStart={vi.fn()}
            activeTab="note"
            setActiveTab={vi.fn()}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacyCommit}
            onKeyPreview={legacyPreview}
            onKeyMappingChange={vi.fn()}
            handleStatUpdate={vi.fn()}
            handleStatPreview={vi.fn()}
            localState={{}}
            setLocalState={vi.fn()}
            handleSizeBlur={vi.fn()}
            showImagePicker={false}
            setShowImagePicker={vi.fn()}
            imageButtonRef={createRef<HTMLButtonElement>()}
            panelElement={null}
            useCustomCSS={false}
            singleScrollRefFor={() => vi.fn()}
            t={(key) => key}
          />,
        );
      });
      const glow = captured.numberList.find(
        (input) => input.min === 0 && input.max === 50,
      );
      act(() => glow?.onPreview?.(20.5));
      act(() => glow?.onChange(21.5));

      expect(legacyPreview).toHaveBeenCalledWith(0, {
        noteGlowSize: 20.5,
      });
      expect(legacyCommit).toHaveBeenCalledWith({
        index: 0,
        noteGlowSize: 21.5,
      });
    },
  );

  it.each([
    ['synthetic', 'key-0'],
    ['empty', ''],
  ] as const)(
    'SingleKeyStatPanel %s note numeric은 actual NoteTab에서 whole legacy를 유지한다',
    (_label, id) => {
      const legacyPreview = vi.fn();
      const legacyCommit = vi.fn();
      act(() => {
        root.render(
          <SingleKeyStatPanel
            setPanelElement={vi.fn()}
            isSingleStat={false}
            isSingleKey
            singleKeyIndex={0}
            singleStatIndex={null}
            singleKeyPosition={{ ...createDefaultKeyPosition(), id }}
            singleStatPosition={null}
            singleKeyCode="A"
            singleKeySlot="A"
            singleKeyInfo={null}
            selectedKeyType="4key"
            isRenaming={false}
            renameInputRef={createRef<HTMLInputElement>()}
            renameValue=""
            setRenameValue={vi.fn()}
            renameCancelledRef={{ current: false }}
            handleRenameCommit={vi.fn()}
            handleRenameCancel={vi.fn()}
            handleRenameStart={vi.fn()}
            activeTab="note"
            setActiveTab={vi.fn()}
            onPositionChange={vi.fn()}
            onKeyUpdate={legacyCommit}
            onKeyPreview={legacyPreview}
            onKeyMappingChange={vi.fn()}
            handleStatUpdate={vi.fn()}
            handleStatPreview={vi.fn()}
            localState={{}}
            setLocalState={vi.fn()}
            handleSizeBlur={vi.fn()}
            showImagePicker={false}
            setShowImagePicker={vi.fn()}
            imageButtonRef={createRef<HTMLButtonElement>()}
            panelElement={null}
            useCustomCSS={false}
            singleScrollRefFor={() => vi.fn()}
            t={(key) => key}
          />,
        );
      });
      const offsetX = captured.optionalNumbers.find(
        (input) => input.prefix === 'X',
      );
      const borderRadius = captured.numberList.find(
        (input) => input.min === 1 && input.max === 100,
      );
      act(() => offsetX?.onPreview?.(0));
      act(() => offsetX?.onChange(undefined));
      act(() => borderRadius?.onPreview?.(12.5));
      act(() => borderRadius?.onChange(13.5));

      expect(legacyPreview.mock.calls).toEqual([
        [0, { noteOffsetX: 0 }],
        [0, { noteBorderRadius: 12.5 }],
      ]);
      expect(legacyCommit.mock.calls).toEqual([
        [{ index: 0, noteOffsetX: undefined }],
        [{ index: 0, noteBorderRadius: 13.5 }],
      ]);
    },
  );

  it.each(['graph', 'knob'] as const)(
    '%s synthetic 경로는 geometry handler가 없으면 기존 writer를 유지한다',
    (type) => {
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

      expect(legacy).toHaveBeenCalledTimes(4);
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
      expect(commit).toHaveBeenCalledWith({ className: '  Final class  ' });
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

      expect(commit).toHaveBeenCalledWith({ [property]: value });
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['graph', 'borderWidth', 0, 20, 20],
    ['knob', 'borderRadius', 0, 999, 999],
  ] as const)(
    '%s synthetic %s actual input은 preview 없이 기존 direct writer를 쓴다',
    (type, property, min, max, value) => {
      const legacy = vi.fn();
      const captureStart = captured.numberList.length;
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
                id: 'graph-0',
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
                id: 'knob-0',
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
      const input = captured.numberList
        .slice(captureStart)
        .reverse()
        .find((candidate) => candidate.min === min && candidate.max === max);
      expect(input?.onPreview).toBeUndefined();
      act(() => input?.onChange(value));

      expect(legacy).toHaveBeenCalledWith({ index: 0, [property]: value });
    },
  );

  it.each(['graph', 'knob'] as const)(
    '%s synthetic className은 local draft 뒤 기존 index writer로 commit한다',
    (type) => {
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
                id: 'graph-0',
                className: 'BeforeClass',
                statType: 'kps',
                graphType: 'line',
                graphSpeed: 1000,
                graphColor: '#fff',
              }}
              singleGraphIndex={4}
              handleGraphUpdate={legacy}
              showGraphImagePicker={false}
              setShowGraphImagePicker={vi.fn()}
              graphImageButtonRef={createRef<HTMLButtonElement>()}
              graphClassNameDraft="BeforeClass"
              setGraphClassNameDraft={vi.fn()}
            />
          ) : (
            <SingleKnobPanel
              {...common}
              singleKnobPosition={{
                ...createDefaultKeyPosition(),
                id: 'knob-0',
                className: 'BeforeClass',
                axisId: 'HIDA:test',
                sensitivity: 1,
                reverse: false,
              }}
              singleKnobIndex={4}
              handleKnobUpdate={legacy}
            />
          ),
        );
      });
      const input = captured.texts.find(
        (candidate) => candidate.value === 'BeforeClass',
      );
      act(() => input?.onChange('DraftClass'));
      expect(legacy).not.toHaveBeenCalled();
      act(() => input?.onBlur?.('FinalClass'));

      expect(legacy).toHaveBeenCalledWith({
        index: 4,
        className: 'FinalClass',
      });
    },
  );
});
