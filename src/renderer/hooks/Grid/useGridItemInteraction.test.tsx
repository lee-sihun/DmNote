/**
 * 캔버스 아이템 공용 상호작용 훅의 계약 고정
 * 키·그래프·노브·스프라이트 잎이 전부 이 훅에 의존하므로 흡수 순서·가드·부착 순서를
 * 잎 컴포넌트가 아니라 여기서 직접 잡는다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridItemInteraction } from './useGridItemInteraction';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const hookState = vi.hoisted(() => ({
  wasMoved: false,
  recentPressMoved: false,
  movedDuringPress: false,
  attached: [] as (HTMLElement | null)[],
}));

vi.mock('@utils/core/platform', () => ({ isMac: () => false }));

vi.mock('@hooks/Grid/useDraggable', () => ({
  useDraggable: () => ({
    ref: (node: HTMLElement | null) => hookState.attached.push(node),
    dx: 0,
    dy: 0,
    wasMoved: hookState.wasMoved,
    isDragging: false,
    recentPressMovedRef: { current: hookState.recentPressMoved },
  }),
}));

vi.mock('@hooks/Grid/useSelectionDrag', () => ({
  useSelectionDrag: () => ({
    handlePointerDown: () => {},
    movedDuringPressRef: { current: hookState.movedDuringPress },
    pressMovedRef: { current: false },
  }),
}));

vi.mock('@hooks/Grid/useSmartGuidesElements', () => ({
  useSmartGuidesElements: () => ({ getOtherElements: () => [] }),
}));

const handlers = {
  onClick: vi.fn(),
  onDoubleClick: vi.fn(),
  onCtrlClick: vi.fn(),
  onShiftClick: vi.fn(),
  onEraserClick: vi.fn(),
  onContextMenu: vi.fn(),
  setReferenceRef: vi.fn(),
};

let container: HTMLDivElement;
let root: Root;

const Host = ({
  isSelected = false,
  activeTool,
  isViewportTransforming = false,
}: {
  isSelected?: boolean;
  activeTool?: string;
  isViewportTransforming?: boolean;
}) => {
  const { attachRef, handleClick, handleDoubleClick, handleContextMenu } =
    useGridItemInteraction({
      index: 0,
      elementId: 'el-1',
      dx: 0,
      dy: 0,
      elementWidth: 60,
      elementHeight: 60,
      isSelected,
      selectedElements: [],
      zoom: 1,
      panX: 0,
      panY: 0,
      activeTool,
      isViewportTransforming,
      onPositionChange: () => {},
      ...handlers,
    });
  return (
    <div
      data-testid="host"
      ref={attachRef}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    />
  );
};

const render = (props: Parameters<typeof Host>[0] = {}) => {
  act(() => root.render(<Host {...props} />));
  return container.querySelector<HTMLElement>('[data-testid="host"]')!;
};

const fire = (node: HTMLElement, type: string, init: MouseEventInit = {}) => {
  act(() => {
    node.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, ...init }),
    );
  });
};

describe('useGridItemInteraction', () => {
  beforeEach(() => {
    hookState.wasMoved = false;
    hookState.recentPressMoved = false;
    hookState.movedDuringPress = false;
    hookState.attached = [];
    Object.values(handlers).forEach((fn) => fn.mockReset());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('평범한 클릭은 그대로 통과한다', () => {
    fire(render(), 'click');
    expect(handlers.onClick).toHaveBeenCalledTimes(1);
  });

  it('드래그로 끝난 press의 trailing click은 흡수한다', () => {
    hookState.wasMoved = true;
    fire(render(), 'click');
    expect(handlers.onClick).not.toHaveBeenCalled();
    expect(handlers.onEraserClick).not.toHaveBeenCalled();
  });

  it('지우개 도구에서는 클릭이 지우개로 간다', () => {
    fire(render({ activeTool: 'eraser' }), 'click');
    expect(handlers.onEraserClick).toHaveBeenCalledTimes(1);
    expect(handlers.onClick).not.toHaveBeenCalled();
  });

  it('선택 모드의 수식키 클릭은 토글로, 맨클릭은 흡수된다', () => {
    const node = render({ isSelected: true });
    fire(node, 'click', { ctrlKey: true });
    expect(handlers.onCtrlClick).toHaveBeenCalledTimes(1);
    fire(node, 'click');
    expect(handlers.onClick).not.toHaveBeenCalled();
  });

  it('비선택 모드의 Shift 클릭은 범위 선택으로 간다', () => {
    fire(render(), 'click', { shiftKey: true });
    expect(handlers.onShiftClick).toHaveBeenCalledTimes(1);
    expect(handlers.onClick).not.toHaveBeenCalled();
  });

  it('더블클릭은 순수 더블클릭만 통과한다', () => {
    fire(render(), 'dblclick');
    expect(handlers.onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it('수식키·지우개·뷰포트 변환 중 더블클릭은 막는다', () => {
    fire(render(), 'dblclick', { shiftKey: true });
    fire(render({ activeTool: 'eraser' }), 'dblclick');
    fire(render({ isViewportTransforming: true }), 'dblclick');
    expect(handlers.onDoubleClick).not.toHaveBeenCalled();
  });

  it('직전 press가 드래그로 끝났으면 더블클릭을 막는다', () => {
    hookState.recentPressMoved = true;
    fire(render(), 'dblclick');
    expect(handlers.onDoubleClick).not.toHaveBeenCalled();

    hookState.recentPressMoved = false;
    hookState.movedDuringPress = true;
    fire(render(), 'dblclick');
    expect(handlers.onDoubleClick).not.toHaveBeenCalled();
  });

  it('컨텍스트 메뉴는 기본 동작과 전파를 막고 전달한다', () => {
    fire(render(), 'contextmenu');
    expect(handlers.onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('루트 부착은 draggable 다음에 참조 ref 순서로 간다', () => {
    render();
    expect(hookState.attached[0]).not.toBeNull();
    expect(handlers.setReferenceRef).toHaveBeenCalledWith(
      hookState.attached[0],
    );
  });

  it('선택 모드에서는 개별 draggable에 붙이지 않는다', () => {
    render({ isSelected: true });
    expect(hookState.attached).toHaveLength(0);
    expect(handlers.setReferenceRef).toHaveBeenCalled();
  });
});
