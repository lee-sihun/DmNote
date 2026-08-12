import { describe, expect, it } from 'vitest';

import {
  enqueueEditorCompatibilityOperation,
  enqueueEditorCompatibilityWrite,
} from './editorCompatibilityQueue';

describe('enqueueEditorCompatibilityOperation', () => {
  it('선행 write 뒤에 실행되고 반환값을 보존한다', async () => {
    const order: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = enqueueEditorCompatibilityWrite(
      async () => {
        await blocker;
        order.push('write');
      },
      () => undefined,
    );
    const second = enqueueEditorCompatibilityOperation(async () => {
      order.push('operation');
      return 42;
    });

    await Promise.resolve();
    expect(order).toEqual([]);

    release();
    await first;
    expect(await second).toBe(42);
    expect(order).toEqual(['write', 'operation']);
  });

  it('실패는 원 오류로 전파되고 큐는 계속 진행된다', async () => {
    const failing = enqueueEditorCompatibilityOperation(async () => {
      throw new Error('operation failed');
    });
    const following = enqueueEditorCompatibilityOperation(async () => 'next');

    await expect(failing).rejects.toThrow('operation failed');
    expect(await following).toBe('next');
  });
});
