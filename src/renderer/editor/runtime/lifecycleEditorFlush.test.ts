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
    commitPendingAsync.mockImplementation(async () => settled);

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
