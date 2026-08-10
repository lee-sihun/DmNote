import { afterEach, describe, expect, it, vi } from 'vitest';

const { beginEditorWriteBarrier, commitPendingAsync } = vi.hoisted(() => ({
  beginEditorWriteBarrier: vi.fn(),
  commitPendingAsync: vi.fn(),
}));

vi.mock('./editorWriteBarrier', () => ({ beginEditorWriteBarrier }));
vi.mock('./editGestureController', () => ({
  editGestureController: { commitPendingAsync },
}));

import { flushFocusedEditorForLifecycle } from './lifecycleEditorFlush';

describe('flushFocusedEditorForLifecycle', () => {
  afterEach(() => {
    document.body.replaceChildren();
    beginEditorWriteBarrier.mockReset();
    commitPendingAsync.mockReset();
  });

  it('focused input을 blur한 뒤 생성된 write와 gesture를 함께 정산한다', async () => {
    const order: string[] = [];
    const input = document.createElement('input');
    input.addEventListener('blur', () => order.push('blur'));
    document.body.append(input);
    input.focus();
    beginEditorWriteBarrier.mockImplementation(() => {
      order.push('barrier');
      return vi.fn(async () => {
        order.push('blur-write');
        return true;
      });
    });
    commitPendingAsync.mockImplementation(async () => {
      order.push('gesture');
      return true;
    });

    await expect(flushFocusedEditorForLifecycle()).resolves.toBe(true);

    expect(order).toEqual(['barrier', 'blur', 'gesture', 'blur-write']);
  });

  it('active input이 없어도 선행 blur의 React 정산 turn을 기다린다', async () => {
    let settled = false;
    setTimeout(() => {
      settled = true;
    }, 0);
    beginEditorWriteBarrier.mockReturnValue(vi.fn(async () => true));
    commitPendingAsync.mockResolvedValue(true);

    await flushFocusedEditorForLifecycle();

    expect(settled).toBe(true);
  });

  it('blur가 promise로 이어붙인 쓰기를 커밋 전에 정산한다', async () => {
    const order: string[] = [];
    const input = document.createElement('input');
    input.addEventListener('blur', () => {
      order.push('blur');
      queueMicrotask(() => order.push('blur-settled'));
    });
    document.body.append(input);
    input.focus();
    beginEditorWriteBarrier.mockReturnValue(vi.fn(async () => true));
    commitPendingAsync.mockImplementation(async () => {
      order.push('commit');
      return true;
    });

    await flushFocusedEditorForLifecycle();

    expect(order).toEqual(['blur', 'blur-settled', 'commit']);
  });

  it('gesture 커밋을 양보 전에 시작한다', async () => {
    // 양보하는 동안 도착한 원격 선택이 선택 구독자를 깨워 아직 시작도 안 한
    // gesture를 취소할 수 있다. history handshake 경로가 실제로 그 순서다
    let yielded = false;
    setTimeout(() => {
      yielded = true;
    }, 0);
    beginEditorWriteBarrier.mockReturnValue(vi.fn(async () => true));
    commitPendingAsync.mockImplementation(async () => !yielded);

    await expect(flushFocusedEditorForLifecycle()).resolves.toBe(true);
  });

  it.each([
    ['gesture', false, true],
    ['blur write', true, false],
  ])(
    '%s 정산 실패를 lifecycle 실패로 반환한다',
    async (_label, gestureResult, blurWriteResult) => {
      beginEditorWriteBarrier.mockReturnValue(
        vi.fn(async () => blurWriteResult),
      );
      commitPendingAsync.mockResolvedValue(gestureResult);

      await expect(flushFocusedEditorForLifecycle()).resolves.toBe(false);
    },
  );
});
