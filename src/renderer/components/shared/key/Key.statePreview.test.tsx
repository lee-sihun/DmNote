/**
 * DraggableKey 상태 프리뷰 계약 테스트
 * 편집 상태 프리뷰 스토어 발행만으로(그라데이션 세션 없이) 키가 입력 상태
 * 시각으로 렌더되는지 고정한다 - 단색·그림자·이미지 편집의 캔버스 동기 근거
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DraggableKey from '@components/shared/key/Key';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { useEditStatePreviewStore } from '@stores/grid/useEditStatePreviewStore';
import { useGradientEditStore } from '@stores/grid/useGradientEditStore';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@utils/core/platform', () => ({ isMac: () => false }));

// 공용 상호작용 훅은 배럴이 아니라 소스 모듈을 직접 쓴다
vi.mock('@hooks/Grid/drag/useDraggable', () => ({
  useDraggable: () => ({
    ref: () => {},
    dx: 0,
    dy: 0,
    wasMoved: false,
    isDragging: false,
    recentPressMovedRef: { current: false },
  }),
}));

vi.mock('@hooks/Grid/drag/useSelectionDrag', () => ({
  useSelectionDrag: () => ({
    handlePointerDown: () => {},
    movedDuringPressRef: { current: false },
    pressMovedRef: { current: false },
  }),
}));

const KEY_ID = '00000000-0000-4000-8000-000000000701';
const OTHER_ID = '00000000-0000-4000-8000-000000000702';

let container: HTMLDivElement;
let root: Root;

const renderKey = (options: { isSelected?: boolean } = {}) => {
  act(() => {
    root.render(
      <DraggableKey
        index={0}
        elementId={KEY_ID}
        position={{
          ...createDefaultKeyPosition(),
          dx: 0,
          dy: 0,
          width: 60,
          height: 60,
          backgroundColor: '#101010',
          activeBackgroundColor: '#f0f0f0',
        }}
        keyName="A"
        onPositionChange={() => {}}
        isSelected={options.isSelected ?? false}
      />,
    );
  });
  return container.querySelector('[data-key-element="true"]') as HTMLElement;
};

const publish = (
  anchor:
    | { kind: 'key' | 'stat' | 'graph' | 'knob'; id: string }
    | { kind: 'batch' },
  state: 'idle' | 'active',
) => {
  act(() => {
    useEditStatePreviewStore.getState().publish(99, anchor, state);
  });
};

beforeEach(() => {
  useEditStatePreviewStore.setState({ entries: [] });
  useGradientEditStore.getState().setSession(null);
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
  useEditStatePreviewStore.setState({ entries: [] });
});

describe('DraggableKey 상태 프리뷰', () => {
  it('스토어 발행만으로 입력 상태 시각으로 전환하고 회수 시 복귀한다', () => {
    const node = renderKey();
    expect(node.getAttribute('data-state')).toBe('inactive');
    publish({ kind: 'key', id: KEY_ID }, 'active');
    expect(node.getAttribute('data-state')).toBe('active');
    // 변수 모드 배경도 입력 값으로 전환
    expect(node.style.getPropertyValue('--dmn-key-bg-default')).toBe('#f0f0f0');
    act(() => {
      useEditStatePreviewStore.getState().retract(99);
    });
    expect(node.getAttribute('data-state')).toBe('inactive');
    expect(node.style.getPropertyValue('--dmn-key-bg-default')).toBe('#101010');
  });

  it('다른 요소 앵커나 대기 상태 발행에는 반응하지 않는다', () => {
    const node = renderKey();
    publish({ kind: 'key', id: OTHER_ID }, 'active');
    expect(node.getAttribute('data-state')).toBe('inactive');
    publish({ kind: 'key', id: KEY_ID }, 'idle');
    expect(node.getAttribute('data-state')).toBe('inactive');
  });

  it('batch 발행은 선택에 포함된 키만 전환한다', () => {
    const selected = renderKey({ isSelected: true });
    publish({ kind: 'batch' }, 'active');
    expect(selected.getAttribute('data-state')).toBe('active');
    const unselected = renderKey({ isSelected: false });
    expect(unselected.getAttribute('data-state')).toBe('inactive');
  });
});
