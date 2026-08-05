import { describe, expect, it, vi } from 'vitest';

import { runLegacyEditorMutationWith } from './legacyEditorMutation';

describe('legacy editor mutation coordinator gate', () => {
  it('coordinator 구독 확립 뒤 명령을 실행하고 canonical을 재적용한다', async () => {
    const order: string[] = [];
    const coordinator = {
      start: vi.fn(async () => {
        order.push('start');
      }),
      sync: vi.fn(async () => {
        order.push('sync');
      }),
    };

    const result = await runLegacyEditorMutationWith(coordinator, async () => {
      order.push('mutation');
      return 'saved';
    });

    expect(result).toBe('saved');
    expect(order).toEqual(['start', 'mutation', 'sync']);
    expect(coordinator.sync).toHaveBeenCalledWith();
  });

  it('coordinator 시작 실패 시 백엔드 mutation을 실행하지 않는다', async () => {
    const failure = new Error('subscribe failed');
    const mutation = vi.fn(async () => 'unexpected');
    const coordinator = {
      start: vi.fn(async () => {
        throw failure;
      }),
      sync: vi.fn(async () => undefined),
    };

    await expect(
      runLegacyEditorMutationWith(coordinator, mutation),
    ).rejects.toBe(failure);
    expect(mutation).not.toHaveBeenCalled();
    expect(coordinator.sync).not.toHaveBeenCalled();
  });

  it('명령 성공 뒤 sync 실패는 성공 결과를 뒤집지 않는다', async () => {
    const syncError = new Error('temporary read failure');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const coordinator = {
      start: vi.fn(async () => undefined),
      sync: vi.fn(async () => {
        throw syncError;
      }),
    };

    await expect(
      runLegacyEditorMutationWith(coordinator, async () => 42),
    ).resolves.toBe(42);
    expect(errorSpy).toHaveBeenCalledWith(
      '레거시 편집 상태 재동기화 실패',
      syncError,
    );
    errorSpy.mockRestore();
  });

  it('구독만 필요한 명령은 mutation 뒤 canonical sync를 생략한다', async () => {
    const coordinator = {
      start: vi.fn(async () => undefined),
      sync: vi.fn(async () => undefined),
    };

    await expect(
      runLegacyEditorMutationWith(coordinator, async () => 'selected', {
        syncAfter: false,
      }),
    ).resolves.toBe('selected');
    expect(coordinator.start).toHaveBeenCalledOnce();
    expect(coordinator.sync).not.toHaveBeenCalled();
  });
});
