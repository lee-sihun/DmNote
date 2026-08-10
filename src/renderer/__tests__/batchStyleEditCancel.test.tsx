// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';
import type { KeyPosition } from '@src/types/key/keys';
import BatchStyleTabContent from '@components/main/Grid/PropertiesPanel/batch/BatchStyleTabContent';
import { PanelNavProvider } from '@components/main/Grid/PropertiesPanel/PanelNavContext';
import { editGestureController } from '@src/renderer/editor/runtime/editGestureController';

interface CapturedNumberInput {
  min?: number;
  max?: number;
  prefix?: string;
  onChange?: (value: number) => void;
  onCancel?: () => void;
}

const captured = vi.hoisted(() => ({
  numberInputs: [] as CapturedNumberInput[],
}));

vi.mock(
  '@components/main/Grid/PropertiesPanel/PropertyInputs',
  async (importOriginal) => {
    const mod = await importOriginal<
      typeof import('@components/main/Grid/PropertiesPanel/PropertyInputs')
    >();
    return {
      ...mod,
      NumberInput: (props: CapturedNumberInput) => {
        captured.numberInputs.push(props);
        return <div data-testid="number-input" />;
      },
      ColorInput: () => <div data-testid="color-input" />,
      TextInput: () => <div data-testid="text-input" />,
    };
  },
);

vi.mock('@components/main/Grid/PropertiesPanel/ShadowControls', () => ({
  default: () => <div data-testid="shadow-controls" />,
}));

const flatPosition = () =>
  ({
    dx: 0,
    dy: 0,
    width: 60,
    height: 60,
    count: 0,
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

// max로 필드를 가른다. 간격 500, 테두리 두께 20, 모서리 100, 글자 크기 72
const fieldByMax = (max: number) =>
  captured.numberInputs.find((props) => props.max === max);

type BatchSpacingHandler = (
  spacing: number,
  options?: { gestureId?: string },
) => void;

describe('배치 스타일 숫자 필드 취소', () => {
  let host: HTMLDivElement;
  let root: Root;
  let handleBatchSpacing: Mock<BatchSpacingHandler>;

  const renderPanel = () => {
    const positions = [flatPosition(), flatPosition()];
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
            shadowActiveState
            getMixedValue={mixedGetter(positions)}
            getKeyOnlyMixedValue={mixedGetter(positions)}
            getSelectedKeysData={() => []}
            handleBatchAlign={vi.fn()}
            handleBatchDistribute={vi.fn()}
            handleBatchSpacing={handleBatchSpacing}
            batchSpacing={{ isMixed: false, value: 10 }}
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
  };

  beforeEach(() => {
    vi.useFakeTimers();
    captured.numberInputs = [];
    handleBatchSpacing = vi.fn<BatchSpacingHandler>();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('간격 취소는 예약만 되고 아직 안 나간 커밋을 걷는다', () => {
    renderPanel();
    const spacing = fieldByMax(500);
    expect(spacing).toBeDefined();

    act(() => spacing!.onChange?.(40));
    act(() => spacing!.onCancel?.());
    act(() => vi.advanceTimersByTime(1000));

    expect(handleBatchSpacing).not.toHaveBeenCalled();
  });

  it('취소가 없으면 예약된 간격이 그대로 나간다', () => {
    renderPanel();
    const spacing = fieldByMax(500);

    act(() => spacing!.onChange?.(40));
    act(() => vi.advanceTimersByTime(1000));

    expect(handleBatchSpacing).toHaveBeenCalled();
  });

  it('스타일 숫자 필드 취소는 진행 중 gesture를 취소한다', () => {
    const cancel = vi
      .spyOn(editGestureController, 'cancel')
      .mockImplementation(() => undefined);
    renderPanel();

    // 테두리 두께
    act(() => fieldByMax(20)?.onCancel?.());
    expect(cancel).toHaveBeenCalledTimes(1);

    // 모서리 반경
    act(() => fieldByMax(100)?.onCancel?.());
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('배치 크기 필드 취소는 진행 중 gesture를 취소한다', () => {
    const cancel = vi
      .spyOn(editGestureController, 'cancel')
      .mockImplementation(() => undefined);
    renderPanel();

    const width = captured.numberInputs.find((props) => props.prefix === 'W');
    const height = captured.numberInputs.find((props) => props.prefix === 'H');

    act(() => width?.onCancel?.());
    act(() => height?.onCancel?.());

    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
