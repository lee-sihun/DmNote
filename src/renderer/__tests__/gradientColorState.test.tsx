// @vitest-environment jsdom
import React, { act, useEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGradientColorState } from '@hooks/pickers/useGradientColorState';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useCommittedApplyStore } from '@stores/data/useCommittedApplyStore';
import type { ColorModeValue, ColorPair, GradientSpec } from '@src/types/color';

type GradientState = ReturnType<typeof useGradientColorState>;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const oldGradient: GradientSpec = {
  angle: 17,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: 'rgba(255,0,0,0)', pos: 1 },
  ],
};
const ELEMENT_A_ID = '11111111-1111-4111-8111-111111111111';

const threeStops: GradientSpec = {
  angle: 90,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#00ff00', pos: 0.5 },
    { color: '#0000ff', pos: 1 },
  ],
};

describe('useGradientColorState 편집 수명', () => {
  let root: Root;
  let host: HTMLDivElement;
  let stateCapture: { current: GradientState | null };
  let onCommit: ReturnType<typeof vi.fn<(value: ColorModeValue) => void>>;

  const Harness = ({
    pair,
    canvasOpen = false,
  }: {
    pair: ColorPair;
    canvasOpen?: boolean;
  }) => {
    const state = useGradientColorState({
      pair,
      fallbackColor: '#ffffff',
      contextKey: `key:4key:${ELEMENT_A_ID}:backgroundColor:idle`,
      canvasAnchor: canvasOpen ? { kind: 'key', id: ELEMENT_A_ID } : undefined,
      onCommit,
    });
    useEffect(() => {
      stateCapture.current = state;
    }, [state]);
    return null;
  };

  const latest = () => {
    if (!stateCapture.current) throw new Error('gradient state not captured');
    return stateCapture.current;
  };

  const changeFormat = (format: 'solid' | 'gradient') => {
    const footer = latest().footerSlot as ReactElement<{
      onFormatChange: (next: 'solid' | 'gradient') => void;
    }>;
    act(() => footer.props.onFormatChange(format));
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    stateCapture = { current: null };
    onCommit = vi.fn<(value: ColorModeValue) => void>();
    act(() => {
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: ELEMENT_A_ID, index: 0 }]);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      useGradientEditStore.getState().setSession(null);
      useGridSelectionStore.getState().clearSelection();
    });
    host.remove();
  });

  it('같은 선택에서는 형식 왕복 spec을 복원하되 선택 수명이 끝나면 폐기한다', () => {
    act(() =>
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: oldGradient }} />,
      ),
    );

    changeFormat('solid');
    act(() => root.render(<Harness pair={{ color: '#ff0000' }} />));
    changeFormat('gradient');
    expect(onCommit).toHaveBeenLastCalledWith(
      {
        mode: 'gradient',
        spec: oldGradient,
      },
      { gradientSource: 'remembered' },
    );

    act(() =>
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: oldGradient }} />,
      ),
    );
    changeFormat('solid');
    act(() => root.render(<Harness pair={{ color: '#ff0000' }} />));

    act(() => useGridSelectionStore.getState().clearSelection());
    act(() =>
      useGridSelectionStore
        .getState()
        .setSelectedElements([{ type: 'key', id: 'key-0', index: 0 }]),
    );
    act(() => root.render(<Harness pair={{ color: '#0000ff' }} />));
    changeFormat('gradient');

    expect(onCommit).toHaveBeenLastCalledWith(
      {
        mode: 'gradient',
        spec: {
          angle: 180,
          stops: [
            { color: '#0000ff', pos: 0 },
            { color: 'rgba(0,0,255,0)', pos: 1 },
          ],
        },
      },
      { gradientSource: 'seed' },
    );
  });

  it('undo/redo 뒤에는 미래 형식의 왕복 spec을 되살리지 않는다', () => {
    act(() =>
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: oldGradient }} />,
      ),
    );

    changeFormat('solid');
    act(() => root.render(<Harness pair={{ color: '#00ff00' }} />));
    act(() => useCommittedApplyStore.getState().bump('historyUndo'));
    changeFormat('gradient');

    expect(onCommit).toHaveBeenLastCalledWith(
      {
        mode: 'gradient',
        spec: {
          angle: 180,
          stops: [
            { color: '#00ff00', pos: 0 },
            { color: 'rgba(0,255,0,0)', pos: 1 },
          ],
        },
      },
      { gradientSource: 'seed' },
    );
  });

  it('외부 spec 축소 뒤 선택 스톱을 마지막 유효 스톱으로 강등한다', () => {
    act(() =>
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: threeStops }} />,
      ),
    );
    const header = latest().headerSlot as ReactElement<{
      onSelectStop: (index: number) => void;
    }>;
    act(() => header.props.onSelectStop(2));

    const twoStops: GradientSpec = {
      ...threeStops,
      stops: [threeStops.stops[0], threeStops.stops[1]],
    };
    act(() =>
      root.render(<Harness pair={{ color: '#ff0000', gradient: twoStops }} />),
    );
    act(() => latest().handlePickerColorChange('#abcdef', true));

    expect(onCommit).toHaveBeenLastCalledWith(
      {
        mode: 'gradient',
        spec: {
          ...twoStops,
          stops: [
            twoStops.stops[0],
            { ...twoStops.stops[1], color: '#abcdef' },
          ],
        },
      },
      { gradientSource: 'edit' },
    );
  });

  it('스톱 추가 직후 새 스톱을 선택한다', () => {
    act(() =>
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: oldGradient }} />,
      ),
    );
    const beforeAdd = latest().headerSlot as ReactElement<{
      selectedIndex: number;
      onSelectStop: (index: number) => void;
      onSpecChangeComplete: (spec: GradientSpec) => void;
    }>;

    act(() => {
      beforeAdd.props.onSelectStop(2);
      beforeAdd.props.onSpecChangeComplete(threeStops);
    });
    act(() =>
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: threeStops }} />,
      ),
    );

    const afterAdd = latest().headerSlot as ReactElement<{
      selectedIndex: number;
    }>;
    expect(afterAdd.props.selectedIndex).toBe(2);
  });

  it('캔버스 피커를 닫으면 미커밋 preview를 폐기한다', () => {
    const previewSpec: GradientSpec = { ...oldGradient, angle: 123 };
    act(() => {
      root.render(
        <Harness
          pair={{ color: '#ff0000', gradient: oldGradient }}
          canvasOpen
        />,
      );
    });

    act(() => {
      useGradientEditStore.getState().session?.apply(previewSpec, false);
    });
    expect(useGradientEditStore.getState().session?.spec).toEqual(previewSpec);

    act(() => {
      root.render(
        <Harness pair={{ color: '#ff0000', gradient: oldGradient }} />,
      );
    });
    expect(useGradientEditStore.getState().session).toBeNull();

    act(() => {
      root.render(
        <Harness
          pair={{ color: '#ff0000', gradient: oldGradient }}
          canvasOpen
        />,
      );
    });
    expect(useGradientEditStore.getState().session?.spec).toEqual(oldGradient);
  });
});
