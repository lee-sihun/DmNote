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
    }
  >(),
  dropdowns: [] as Array<{
    value: string;
    onChange: (value: string) => void;
  }>,
  image: null as null | {
    completionBinding?: string;
    onIdleImageChange: (value: string) => void;
    onIdleImageReset: () => void;
  },
}));
const elementPatch = vi.hoisted(() => ({
  applyElementPatchById: vi.fn(async () => true),
}));

vi.mock('@src/renderer/editor/runtime/elementPatch', () => elementPatch);
vi.mock('@src/renderer/editor/runtime/elementIntent', () => ({
  reportElementOpError: vi.fn(),
}));

vi.mock('../PropertyInputs', () => ({
  PropertyRow: ({ children }: { children: React.ReactNode }) => children,
  PropertySection: ({ children }: { children: React.ReactNode }) => children,
  NumberInput: (props: {
    prefix: string;
    onChange: (value: number) => void;
    onBlur?: (value?: number) => void;
    onPreview?: (value: number) => void;
  }) => {
    captured.numbers.set(props.prefix, props);
    return null;
  },
  TextInput: () => null,
  ColorInput: () => null,
  FontStyleToggle: () => null,
  Tabs: () => null,
}));
vi.mock('@components/main/common/Dropdown', () => ({
  default: (props: { value: string; onChange: (value: string) => void }) => {
    captured.dropdowns.push(props);
    return null;
  },
}));
vi.mock('@components/main/common/Checkbox', () => ({ default: () => null }));
vi.mock('@components/main/Modal/content/pickers/ColorPicker', () => ({
  default: () => null,
}));
vi.mock('@components/main/Modal/content/pickers/ImagePicker', () => ({
  default: (props: NonNullable<(typeof captured)['image']>) => {
    captured.image = props;
    return null;
  },
}));
vi.mock('@components/main/Modal/content/pickers/ColorSwatch', () => ({
  ColorSwatchButton: () => null,
}));
vi.mock('@components/main/Modal/PopupExit', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock('../ShadowControls', () => ({ default: () => null }));
vi.mock('../EditSessionBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../PanelNavContext', () => ({
  usePanelNav: () => ({ openPage: vi.fn(), closePage: vi.fn() }),
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
  useGradientColorState: () => ({}),
}));
vi.mock('@utils/core/axisEventBus', () => ({
  axisEventBus: { subscribe: () => vi.fn() },
}));

import StyleTabContent from './StyleTabContent';
import {
  SingleGraphPanel,
  SingleKeyStatPanel,
  SingleKnobPanel,
} from './SingleSelectionPanel';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('single geometry input bindings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured.numbers.clear();
    captured.dropdowns.length = 0;
    captured.image = null;
    elementPatch.applyElementPatchById.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
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
});
