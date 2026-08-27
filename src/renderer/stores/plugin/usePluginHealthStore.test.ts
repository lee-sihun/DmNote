/**
 * 주입 정산 대기의 상관 계약
 * - expectedIds가 있으면 그 대상이 실린 정산만 받고, 대상이 knownIds에서 사라졌으면 즉시 정산
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  currentPluginHealthRevision,
  usePluginHealthStore,
  waitForPluginInjection,
} from './usePluginHealthStore';

describe('waitForPluginInjection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePluginHealthStore.setState({
      health: {},
      outcome: 'skipped',
      revision: 0,
      knownIds: undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const publish = (
    health: Record<string, { status: 'ok' | 'failed' }>,
    knownIds?: string[],
  ) => usePluginHealthStore.getState().publish('settled', health, knownIds);

  it('무관한 정산은 건너뛰고 대상이 실린 정산에서 돌아온다', async () => {
    const revision = currentPluginHealthRevision();
    const pending = waitForPluginInjection(revision, ['want']);

    publish({ other: { status: 'ok' } }, ['other', 'want']);
    publish({ want: { status: 'failed' } }, ['other', 'want']);

    await expect(pending).resolves.toMatchObject({
      outcome: 'settled',
      health: { want: { status: 'failed' } },
    });
  });

  it('대상이 knownIds에서 사라졌으면 실패가 아니라 즉시 정산한다', async () => {
    const revision = currentPluginHealthRevision();
    const pending = waitForPluginInjection(revision, ['gone']);

    publish({ other: { status: 'ok' } }, ['other']);

    await expect(pending).resolves.toMatchObject({ outcome: 'settled' });
  });

  it('기준 회차 뒤의 낡은 정산이 이미 있어도 대상이 없으면 다음 정산을 기다린다', async () => {
    const revision = currentPluginHealthRevision();
    // 파일 다이얼로그가 열린 사이 들어온 무관한 정산
    publish({ other: { status: 'ok' } }, ['other', 'want']);

    const pending = waitForPluginInjection(revision, ['want']);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    publish({ want: { status: 'ok' } }, ['other', 'want']);
    await expect(pending).resolves.toMatchObject({
      health: { want: { status: 'ok' } },
    });
  });

  it('expectedIds가 없으면 기존처럼 첫 정산에 돌아온다', async () => {
    const revision = currentPluginHealthRevision();
    const pending = waitForPluginInjection(revision);

    publish({ other: { status: 'ok' } }, ['other']);

    await expect(pending).resolves.toMatchObject({ outcome: 'settled' });
  });

  it('knownIds를 모르는 정산(구 호출부)은 대상 부재를 판정하지 않고 기다린다', async () => {
    const revision = currentPluginHealthRevision();
    const pending = waitForPluginInjection(revision, ['want']);

    publish({ other: { status: 'ok' } });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toMatchObject({ outcome: 'timeout' });
  });
});
