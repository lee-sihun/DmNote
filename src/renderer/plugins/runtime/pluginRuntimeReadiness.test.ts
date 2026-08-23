import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginPluginWork,
  hasEnabledPlugins,
  isLocalPluginRuntimeReady,
  isMainPluginsReady,
  noteEnabledPluginCount,
  noteMainPluginsReady,
  notePluginFetchSettled,
  resetPluginRuntimeReadiness,
  subscribePluginReadiness,
  trackPluginWork,
} from './pluginRuntimeReadiness';

const settleInitialFetches = () => {
  notePluginFetchSettled();
  notePluginFetchSettled();
};

describe('pluginRuntimeReadiness', () => {
  beforeEach(() => {
    resetPluginRuntimeReadiness();
  });

  afterEach(() => {
    resetPluginRuntimeReadiness();
  });

  it('초기 조회가 끝나기 전에는 준비되지 않는다', () => {
    expect(isLocalPluginRuntimeReady()).toBe(false);

    notePluginFetchSettled();
    expect(isLocalPluginRuntimeReady()).toBe(false);

    notePluginFetchSettled();
    expect(isLocalPluginRuntimeReady()).toBe(true);
  });

  it('진행 중 작업이 남아 있으면 준비되지 않는다', () => {
    const endWork = beginPluginWork();
    settleInitialFetches();
    expect(isLocalPluginRuntimeReady()).toBe(false);

    endWork();
    expect(isLocalPluginRuntimeReady()).toBe(true);
  });

  it('작업 종료 콜백은 중복 호출해도 카운터를 훼손하지 않는다', () => {
    const endFirst = beginPluginWork();
    const endSecond = beginPluginWork();
    settleInitialFetches();

    endFirst();
    endFirst();
    expect(isLocalPluginRuntimeReady()).toBe(false);

    endSecond();
    expect(isLocalPluginRuntimeReady()).toBe(true);
  });

  it('추적한 작업이 실패해도 준비 상태로 전환된다', async () => {
    settleInitialFetches();
    trackPluginWork(Promise.reject(new Error('restore failed')));
    expect(isLocalPluginRuntimeReady()).toBe(false);

    await Promise.resolve();
    await Promise.resolve();
    expect(isLocalPluginRuntimeReady()).toBe(true);
  });

  it('상태가 바뀔 때 구독자에게 알린다', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePluginReadiness(listener);

    settleInitialFetches();
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    listener.mockClear();
    noteMainPluginsReady();
    expect(listener).not.toHaveBeenCalled();
  });

  it('메인 준비 신호는 되돌아가지 않는다', () => {
    expect(isMainPluginsReady()).toBe(false);

    noteMainPluginsReady();
    expect(isMainPluginsReady()).toBe(true);

    noteEnabledPluginCount(0);
    expect(isMainPluginsReady()).toBe(true);
  });

  it('활성 플러그인 수를 반영한다', () => {
    expect(hasEnabledPlugins()).toBe(false);

    noteEnabledPluginCount(2);
    expect(hasEnabledPlugins()).toBe(true);

    noteEnabledPluginCount(0);
    expect(hasEnabledPlugins()).toBe(false);
  });

  it('리셋하면 초기 상태로 돌아간다', () => {
    settleInitialFetches();
    noteMainPluginsReady();
    noteEnabledPluginCount(3);

    resetPluginRuntimeReadiness();

    expect(isLocalPluginRuntimeReady()).toBe(false);
    expect(isMainPluginsReady()).toBe(false);
    expect(hasEnabledPlugins()).toBe(false);
  });
});
