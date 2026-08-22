import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CanvasTool from './CanvasTool';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@contexts/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@assets/svgs/move.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/eraser.svg', () => ({ default: () => null }));
vi.mock('@assets/svgs/broom.svg', () => ({ default: () => null }));
vi.mock('./icons/LayerStackIcon', () => ({ default: () => null }));
vi.mock('./icons/PaletteIcon', () => ({ default: () => null }));
vi.mock('./icons/IconMotion', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/FloatingTooltip', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/TooltipGroup', () => ({
  TooltipGroup: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../Modal/ListPopup', () => ({
  default: ({
    open,
    items,
  }: {
    open: boolean;
    items: Array<{ id: string }>;
  }) => <div data-testid={`popup-${items[0].id}`} data-open={String(open)} />,
}));
vi.mock('@hooks/useIconMotion', () => ({
  useIconMotion: () => ({ motionProps: {} }),
}));

describe('CanvasTool', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useGridSelectionStore.setState({
      selectedElements: [],
      selectedGroupIds: [],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (interactionDisabled = false) => {
    act(() => {
      root.render(
        <CanvasTool
          onAddItem={vi.fn()}
          onTogglePalette={vi.fn()}
          isPaletteOpen={false}
          onResetCurrentMode={vi.fn()}
          activeTool="move"
          setActiveTool={vi.fn()}
          interactionDisabled={interactionDisabled}
        />,
      );
    });
  };

  it('지우개 전환 시 남은 선택을 해제해 첫 클릭 삭제를 막지 않는다', () => {
    const setActiveTool = vi.fn();
    useGridSelectionStore.setState({
      selectedElements: [{ type: 'key', id: 'key-1', index: 0 }],
      selectedGroupIds: ['group-1'],
    });

    act(() => {
      root.render(
        <CanvasTool
          onAddItem={vi.fn()}
          onTogglePalette={vi.fn()}
          isPaletteOpen={false}
          onResetCurrentMode={vi.fn()}
          activeTool="move"
          setActiveTool={setActiveTool}
        />,
      );
    });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Eraser"]')
        ?.click();
    });

    expect(useGridSelectionStore.getState().selectedElements).toEqual([]);
    expect(useGridSelectionStore.getState().selectedGroupIds).toEqual([]);
    expect(setActiveTool).toHaveBeenCalledWith('eraser');
  });

  it.each([
    ['Add Key', 'popup-addKey'],
    ['Reset Current Tab', 'popup-resetTab'],
  ])('모달 진입 시 열린 %s 포털 메뉴를 닫는다', (buttonLabel, popupId) => {
    render();
    act(() => {
      container
        .querySelector<HTMLButtonElement>(`[aria-label="${buttonLabel}"]`)
        ?.click();
    });
    expect(
      container.querySelector<HTMLElement>(`[data-testid="${popupId}"]`)
        ?.dataset.open,
    ).toBe('true');

    render(true);
    expect(
      container.querySelector<HTMLElement>(`[data-testid="${popupId}"]`)
        ?.dataset.open,
    ).toBe('false');
  });
});
