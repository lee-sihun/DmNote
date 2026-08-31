/**
 * KnobItem trailing click 흡수 계약 테스트
 * 드래그 표식(wasMoved·pressMovedRef)이 선 press의 클릭은 선택·액션으로
 * 새지 않고, 표식이 없으면 정상 클릭으로 통과한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import KnobItem from '@components/main/Grid/layers/KnobItem';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 실제 포인터 시퀀스 대신 훅 반환값으로 드래그 표식을 강제 주입
const hookState = vi.hoisted(() => ({ wasMoved: false, pressMoved: false }));

// 수식키 판별을 ctrlKey로 고정
vi.mock('@utils/core/platform', () => ({ isMac: () => false }));

vi.mock('@hooks/Grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hooks/Grid')>();
  return {
    ...actual,
    useDraggable: () => ({
      ref: () => {},
      dx: 0,
      dy: 0,
      wasMoved: hookState.wasMoved,
      isDragging: false,
      recentPressMovedRef: { current: false },
    }),
  };
});

// 공용 상호작용 훅은 배럴이 아니라 소스 모듈을 직접 쓴다
vi.mock('@hooks/Grid/useDraggable', () => ({
  useDraggable: () => ({
    ref: () => {},
    dx: 0,
    dy: 0,
    wasMoved: hookState.wasMoved,
    isDragging: false,
    recentPressMovedRef: { current: false },
  }),
}));

vi.mock('@hooks/Grid/useSelectionDrag', () => ({
  useSelectionDrag: () => ({
    handlePointerDown: () => {},
    movedDuringPressRef: { current: false },
    pressMovedRef: { current: hookState.pressMoved },
  }),
}));

const KNOB_ID = '00000000-0000-4000-8000-000000000701';

const onClick = vi.fn();
const onCtrlClick = vi.fn();
const onEraserClick = vi.fn();
const parentClick = vi.fn();

let container: HTMLDivElement;
let root: Root;

const renderKnob = (
  options: { isSelected?: boolean; activeTool?: string } = {},
) => {
  act(() => {
    root.render(
      <div onClick={parentClick}>
        <KnobItem
          index={0}
          elementId={KNOB_ID}
          position={{ dx: 0, dy: 0, width: 60, height: 60 }}
          onPositionChange={() => {}}
          onClick={onClick}
          onCtrlClick={onCtrlClick}
          onEraserClick={onEraserClick}
          isSelected={options.isSelected ?? false}
          activeTool={options.activeTool ?? 'select'}
        />
      </div>,
    );
  });
  return container.querySelector('[data-knob-element="true"]') as HTMLElement;
};

const fireClick = (node: HTMLElement, init: MouseEventInit = {}) => {
  act(() => {
    node.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      }),
    );
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  hookState.wasMoved = false;
  hookState.pressMoved = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('KnobItem trailing click 가드', () => {
  it('표식 없는 클릭은 onClick으로 통과한다', () => {
    const node = renderKnob();

    fireClick(node);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('드래그 표식(wasMoved)이 선 클릭은 지우개·부모로 새지 않는다', () => {
    hookState.wasMoved = true;
    const node = renderKnob({ activeTool: 'eraser' });

    fireClick(node);

    expect(onEraserClick).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('선택 모드: 표식 없는 수식키 클릭은 onCtrlClick으로 통과한다', () => {
    const node = renderKnob({ isSelected: true });

    fireClick(node, { ctrlKey: true });

    expect(onCtrlClick).toHaveBeenCalledTimes(1);
  });

  it('선택 모드: 다중 드래그 표식(pressMovedRef)이 선 수식키 클릭은 흡수된다', () => {
    hookState.pressMoved = true;
    const node = renderKnob({ isSelected: true });

    fireClick(node, { ctrlKey: true });

    expect(onCtrlClick).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
