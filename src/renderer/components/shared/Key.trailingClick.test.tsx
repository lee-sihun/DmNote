/**
 * DraggableKey trailing click 흡수 계약 테스트
 * 드래그 표식(wasMoved·pressMovedRef)이 선 press의 클릭은 선택·액션으로
 * 새지 않고, 표식이 없으면 정상 클릭으로 통과한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DraggableKey from '@components/shared/Key';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';

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

vi.mock('@hooks/Grid/drag/useSelectionDrag', () => ({
  useSelectionDrag: () => ({
    handlePointerDown: () => {},
    movedDuringPressRef: { current: false },
    pressMovedRef: { current: hookState.pressMoved },
  }),
}));

const KEY_ID = '00000000-0000-4000-8000-000000000501';

const onClick = vi.fn();
const onCtrlClick = vi.fn();
const onEraserClick = vi.fn();
const parentClick = vi.fn();

let container: HTMLDivElement;
let root: Root;

const renderKey = (
  options: {
    isSelected?: boolean;
    activeTool?: string;
    isViewportTransforming?: boolean;
  } = {},
) => {
  act(() => {
    root.render(
      <div onClick={parentClick}>
        <DraggableKey
          index={0}
          elementId={KEY_ID}
          position={{
            ...createDefaultKeyPosition(),
            dx: 0,
            dy: 0,
            width: 60,
            height: 60,
          }}
          keyName="A"
          onPositionChange={() => {}}
          onClick={onClick}
          onCtrlClick={onCtrlClick}
          onEraserClick={onEraserClick}
          isSelected={options.isSelected ?? false}
          activeTool={options.activeTool ?? 'select'}
          isViewportTransforming={options.isViewportTransforming ?? false}
        />
      </div>,
    );
  });
  return container.querySelector('[data-key-element="true"]') as HTMLElement;
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
  useGridSelectionStore.setState({
    isDraggingOrResizing: false,
    isResizing: false,
  });
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

describe('DraggableKey trailing click 가드', () => {
  it('그리드 이동 중 키를 중첩 합성 레이어로 승격하지 않는다', () => {
    const node = renderKey({ isViewportTransforming: true });

    expect(node.style.willChange).toBe('auto');
    expect(node.style.backfaceVisibility).toBe('visible');
    expect(node.style.transformStyle).toBe('flat');
    expect(node.style.contain).toBe('layout style');
  });

  it('리사이즈 중 애니메이션만 끄고 합성 레이어로 승격하지 않는다', () => {
    act(() => {
      useGridSelectionStore.getState().setResizing(true);
    });
    const node = renderKey();

    expect(node.dataset.editing).toBe('true');
    expect(node.style.willChange).toBe('auto');
    expect(node.style.backfaceVisibility).toBe('visible');
    expect(node.style.transformStyle).toBe('flat');
    expect(node.style.contain).toBe('layout style');
  });

  it('드래그 중에도 키를 합성 레이어로 승격하지 않는다', () => {
    act(() => {
      useGridSelectionStore.getState().setDraggingOrResizing(true);
    });

    // WebKit은 스케일 레이어 안에 합성 자식이 생기면 컨테이너째 레이어로
    // 만들어 그리드 전체가 흐려진다 - 선택된 키도 승격 없이 재페인트로 이동
    for (const options of [{}, { isSelected: true }]) {
      const node = renderKey(options);
      expect(node.dataset.editing).toBe('true');
      expect(node.style.transform).toContain('translate(');
      expect(node.style.transform).not.toContain('translate3d(');
      expect(node.style.willChange).toBe('auto');
      expect(node.style.backfaceVisibility).toBe('visible');
      expect(node.style.transformStyle).toBe('flat');
      expect(node.style.contain).toBe('layout style');
    }
  });

  it('표식 없는 클릭은 onClick으로 통과한다', () => {
    const node = renderKey();

    fireClick(node);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('드래그 표식(wasMoved)이 선 클릭은 지우개·부모로 새지 않는다', () => {
    hookState.wasMoved = true;
    const node = renderKey({ activeTool: 'eraser' });

    fireClick(node);

    expect(onEraserClick).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('선택 모드: 표식 없는 수식키 클릭은 onCtrlClick으로 통과한다', () => {
    const node = renderKey({ isSelected: true });

    fireClick(node, { ctrlKey: true });

    expect(onCtrlClick).toHaveBeenCalledTimes(1);
  });

  it('선택 모드: 다중 드래그 표식(pressMovedRef)이 선 수식키 클릭은 흡수된다', () => {
    hookState.pressMoved = true;
    const node = renderKey({ isSelected: true });

    fireClick(node, { ctrlKey: true });

    expect(onCtrlClick).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
