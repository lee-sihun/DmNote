import { describe, expect, it } from 'vitest';
import { SerialTaskQueue } from './serialTaskQueue';

describe('SerialTaskQueue', () => {
  it('비동기 작업을 등록 순서대로 한 번씩 실행한다', async () => {
    const queue = new SerialTaskQueue();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.enqueue(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
      return 1;
    });
    const second = queue.enqueue(async () => {
      order.push('second');
      return 2;
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('앞 작업 실패를 호출자에게 전달하면서 다음 작업은 계속 실행한다', async () => {
    const queue = new SerialTaskQueue();
    const failed = queue.enqueue(async () => {
      throw new Error('failed');
    });
    const next = queue.enqueue(async () => 'next');

    await expect(failed).rejects.toThrow('failed');
    await expect(next).resolves.toBe('next');
    await expect(queue.wait()).resolves.toBeUndefined();
  });
});
