// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyPosition } from '@src/types/key/keys';
import type { ElementShadowSpec } from '@src/types/key/shadows';
import ActualBatchStyleTabContent from '@components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent';
import { BatchGraphOnlyPanel as ActualBatchGraphOnlyPanel } from '@components/main/Grid/PropertiesPanel/batch/BatchSelectionPanel';
import { PanelNavProvider } from '@components/main/Grid/PropertiesPanel/navigation/PanelNavContext';
import { editGestureController } from '@src/renderer/editor/runtime/gesture/editGestureController';

interface CapturedShadowProps {
  activeShadow: ElementShadowSpec;
  activeMixed?: boolean;
  anyEnabled?: boolean;
}

const captured = vi.hoisted(() => ({
  shadowProps: null as CapturedShadowProps | null,
  colorTabs: [] as Array<boolean | undefined>,
  textInputs: [] as Array<{ onCancel?: () => void }>,
}));

vi.mock(
  '@components/main/Grid/PropertiesPanel/controls/PropertyInputs',
  async (importOriginal) => {
    const mod = await importOriginal<
      typeof import('@components/main/Grid/PropertiesPanel/controls/PropertyInputs')
    >();
    return {
      ...mod,
      ColorInput: (props: { showStateTabs?: boolean }) => {
        captured.colorTabs.push(props.showStateTabs);
        return <div data-testid="color-input" />;
      },
      TextInput: (props: { onCancel?: () => void }) => {
        captured.textInputs.push(props);
        return <div data-testid="text-input" />;
      },
    };
  },
);

vi.mock(
  '@components/main/Grid/PropertiesPanel/controls/ShadowControls',
  () => ({
    default: (props: CapturedShadowProps) => {
      captured.shadowProps = props;
      return <div data-testid="shadow-controls" />;
    },
  }),
);

const position = (
  shadow: ElementShadowSpec,
  activeShadow: ElementShadowSpec,
): KeyPosition =>
  ({
    dx: 0,
    dy: 0,
    width: 60,
    height: 60,
    count: 0,
    shadow,
    activeShadow,
  } as KeyPosition);

const mixedGetter = (positions: KeyPosition[]) =>
  function getMixedValue<T>(
    getter: (pos: KeyPosition) => T | undefined,
    defaultValue: T,
  ): { isMixed: boolean; value: T } {
    const values = positions.map((item) => getter(item) ?? defaultValue);
    const value = values[0] ?? defaultValue;
    return {
      value,
      isMixed: values.some(
        (candidate) => JSON.stringify(candidate) !== JSON.stringify(value),
      ),
    };
  };

type CompatStyleProps = Omit<
  React.ComponentProps<typeof ActualBatchStyleTabContent>,
  'handleBatchResizePreview'
> &
  Record<string, unknown>;

type CompatGraphProps = Omit<
  React.ComponentProps<typeof ActualBatchGraphOnlyPanel>,
  'handleBatchResizePreview'
> &
  Record<string, unknown>;

const BatchStyleTabContent = ({
  handleBatchStyleChange: _handleBatchStyleChange,
  handleBatchStyleChangeComplete: _handleBatchStyleChangeComplete,
  handleBatchShadowChangeComplete: _handleBatchShadowChangeComplete,
  handleBatchShadowEnabledChange: _handleBatchShadowEnabledChange,
  ...props
}: CompatStyleProps) => (
  <ActualBatchStyleTabContent handleBatchResizePreview={vi.fn()} {...props} />
);

const BatchGraphOnlyPanel = ({
  handleBatchStyleChange: _handleBatchStyleChange,
  handleBatchStyleChangeComplete: _handleBatchStyleChangeComplete,
  handleBatchGradientCommit: _handleBatchGradientCommit,
  ...props
}: CompatGraphProps) => (
  <ActualBatchGraphOnlyPanel handleBatchResizePreview={vi.fn()} {...props} />
);

describe('혼합 선택 active 그림자 집계', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured.shadowProps = null;
    captured.colorTabs = [];
    captured.textInputs = [];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('키와 통계를 함께 골라도 active 대표값·Mixed·anyEnabled는 키만 본다', () => {
    const idleShadow: ElementShadowSpec = {
      enabled: false,
      color: '#111111',
      offsetX: 0,
      offsetY: 4,
      blur: 10,
    };
    const keyActiveShadow: ElementShadowSpec = {
      enabled: false,
      color: '#22aa22',
      offsetX: 1,
      offsetY: 2,
      blur: 7,
    };
    const staleStatActiveShadow: ElementShadowSpec = {
      enabled: true,
      color: '#ff0000',
      offsetX: 90,
      offsetY: 91,
      blur: 92,
    };
    const keyPosition = position(idleShadow, keyActiveShadow);
    const statPosition = position(idleShadow, staleStatActiveShadow);

    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost: null,
          }}
        >
          <BatchStyleTabContent
            selectedCount={2}
            hideDisplayText
            hideFontControls
            shadowActiveState
            getMixedValue={mixedGetter([statPosition, keyPosition])}
            getKeyOnlyMixedValue={mixedGetter([keyPosition])}
            getSelectedKeysData={() => []}
            handleBatchAlign={vi.fn()}
            handleBatchDistribute={vi.fn()}
            handleBatchSpacing={vi.fn()}
            batchSpacing={{ isMixed: false, value: 0 }}
            handleBatchResize={vi.fn()}
            handleBatchStyleChange={vi.fn()}
            handleBatchStyleChangeComplete={vi.fn()}
            handleBatchShadowChangeComplete={vi.fn()}
            handleBatchShadowEnabledChange={vi.fn()}
            showBatchImagePicker={false}
            onToggleBatchImagePicker={vi.fn()}
            batchImageButtonRef={React.createRef<HTMLButtonElement>()}
            panelElement={null}
            useCustomCSS={false}
            t={(key) => key}
          />
        </PanelNavProvider>,
      );
    });

    expect(captured.shadowProps?.activeShadow).toEqual(keyActiveShadow);
    expect(captured.shadowProps?.activeMixed).toBe(false);
    expect(captured.shadowProps?.anyEnabled).toBe(false);
  });

  it('shadowActiveState=false(그래프 배치)면 색상 입력 탭이 전부 꺼진다', () => {
    const shadow: ElementShadowSpec = {
      enabled: false,
      color: '#111111',
      offsetX: 0,
      offsetY: 4,
      blur: 10,
    };
    const graphPosition = position(shadow, shadow);

    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost: null,
          }}
        >
          <BatchStyleTabContent
            selectedCount={2}
            hideDisplayText
            hideFontControls
            showShadowControls={false}
            shadowActiveState={false}
            getMixedValue={mixedGetter([graphPosition])}
            getSelectedKeysData={() => []}
            handleBatchAlign={vi.fn()}
            handleBatchDistribute={vi.fn()}
            handleBatchSpacing={vi.fn()}
            batchSpacing={{ isMixed: false, value: 0 }}
            handleBatchResize={vi.fn()}
            handleBatchStyleChange={vi.fn()}
            handleBatchStyleChangeComplete={vi.fn()}
            handleBatchShadowChangeComplete={vi.fn()}
            handleBatchShadowEnabledChange={vi.fn()}
            showBatchImagePicker={false}
            onToggleBatchImagePicker={vi.fn()}
            batchImageButtonRef={React.createRef<HTMLButtonElement>()}
            panelElement={null}
            useCustomCSS={false}
            t={(key) => key}
          />
        </PanelNavProvider>,
      );
    });

    // 배경·테두리 ColorInput 모두 상태 탭 미노출
    expect(captured.colorTabs.length).toBeGreaterThan(0);
    expect(captured.colorTabs.every((tabs) => tabs === false)).toBe(true);
  });

  it('표시 텍스트와 클래스명 Escape를 모두 진행 게스처 취소로 연결한다', () => {
    const cancelGesture = vi
      .spyOn(editGestureController, 'cancel')
      .mockImplementation(() => undefined);
    const shadow: ElementShadowSpec = {
      enabled: false,
      color: '#111111',
      offsetX: 0,
      offsetY: 4,
      blur: 10,
    };
    const keyPosition = position(shadow, shadow);

    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost: null,
          }}
        >
          <BatchStyleTabContent
            selectedCount={2}
            hideFontControls
            showShadowControls={false}
            getMixedValue={mixedGetter([keyPosition, keyPosition])}
            getSelectedKeysData={() => []}
            handleBatchAlign={vi.fn()}
            handleBatchDistribute={vi.fn()}
            handleBatchSpacing={vi.fn()}
            batchSpacing={{ isMixed: false, value: 0 }}
            handleBatchResize={vi.fn()}
            handleBatchStyleChange={vi.fn()}
            handleBatchStyleChangeComplete={vi.fn()}
            showBatchImagePicker={false}
            onToggleBatchImagePicker={vi.fn()}
            batchImageButtonRef={React.createRef<HTMLButtonElement>()}
            panelElement={null}
            useCustomCSS
            t={(key) => key}
          />
        </PanelNavProvider>,
      );
    });

    expect(captured.textInputs).toHaveLength(2);
    act(() => {
      captured.textInputs.forEach((props) => props.onCancel?.());
    });
    expect(cancelGesture).toHaveBeenCalledTimes(2);
  });
});

describe('그래프 전용 배치 패널 배선', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    captured.colorTabs = [];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('그래프 패널 색상 피커는 실제 배선으로 입력 탭이 꺼진다', () => {
    const mixedGraphs = <T,>(
      _getter: unknown,
      defaultValue: T,
    ): { isMixed: boolean; value: T } => ({
      isMixed: false,
      value: defaultValue,
    });

    act(() => {
      root.render(
        <PanelNavProvider
          value={{
            activePageKey: null,
            renderPageKey: null,
            openPage: vi.fn(),
            closePage: vi.fn(),
            pageHost: null,
          }}
        >
          <BatchGraphOnlyPanel
            setPanelElement={vi.fn()}
            selectedGraphElements={[{ id: 'graph-0', type: 'graph', index: 0 }]}
            selectedGroupInfo={null}
            isRenaming={false}
            renameInputRef={React.createRef<HTMLInputElement>()}
            renameValue=""
            setRenameValue={vi.fn()}
            renameCancelledRef={{ current: false }}
            handleRenameCommit={vi.fn()}
            handleRenameCancel={vi.fn()}
            handleRenameStart={vi.fn()}
            handleBatchAlign={vi.fn()}
            handleBatchDistribute={vi.fn()}
            handleBatchSpacing={vi.fn()}
            handleBatchSpacingPreview={vi.fn()}
            handleBatchSpacingCommit={vi.fn()}
            getBatchSpacingValue={() => ({ isMixed: false, value: 0 })}
            handleBatchResize={vi.fn()}
            handleBatchStyleChange={vi.fn()}
            handleBatchStyleChangeComplete={vi.fn()}
            handleGraphBatchSharedSetting={vi.fn()}
            getMixedValueGraphs={mixedGraphs}
            getMixedValueGraphsAsKey={mixedGraphs}
            getSelectedGraphsData={() => []}
            batchScrollRefFor={() => () => {}}
            batchImageButtonRef={React.createRef<HTMLButtonElement>()}
            showBatchImagePicker={false}
            setShowBatchImagePicker={vi.fn()}
            panelElement={null}
            useCustomCSS={false}
            selectedKeyType="4key"
            t={(key) => key}
          />
        </PanelNavProvider>,
      );
    });

    // 실제 배선 고정 — BatchGraphOnlyPanel의 shadowActiveState={false}를
    // 지우면 기본값 true로 탭이 켜져 이 테스트가 실패해야 함
    expect(captured.colorTabs.length).toBeGreaterThan(0);
    expect(captured.colorTabs.some((tabs) => tabs === false)).toBe(true);
    expect(captured.colorTabs.every((tabs) => tabs !== true)).toBe(true);
  });
});
