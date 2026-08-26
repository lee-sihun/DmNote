import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePluginDisplayElementsResponder } from './usePluginDisplayElementsResponder';
import { pushDisplayElementsToOverlay } from '@stores/plugin/usePluginDisplayElementStore';
import {
  beginPluginWork,
  noteEnabledPluginCount,
  notePluginFetchSettled,
  resetPluginRuntimeReadiness,
} from '@plugins/runtime/pluginRuntimeReadiness';

vi.mock(
  '@stores/plugin/usePluginDisplayElementStore',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('@stores/plugin/usePluginDisplayElementStore')
    >();
    return { ...actual, pushDisplayElementsToOverlay: vi.fn() };
  },
);

const pushMock = vi.mocked(pushDisplayElementsToOverlay);

const Host = () => {
  usePluginDisplayElementsResponder();
  return null;
};

describe('usePluginDisplayElementsResponder 준비 전환 push', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = () => {
    act(() => {
      root.render(<Host />);
    });
  };

  beforeEach(() => {
    resetPluginRuntimeReadiness();
    pushMock.mockClear();
    // bridge는 구독 해제만 흉내 - 준비 전환 경로만 검증
    window.api = {
      bridge: { on: vi.fn(() => () => {}) },
    } as unknown as typeof window.api;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    resetPluginRuntimeReadiness();
  });

  it('요소가 0개여도 준비 완료 전환 순간 1회 push', () => {
    mount();
    expect(pushMock).not.toHaveBeenCalled();

    notePluginFetchSettled();
    expect(pushMock).not.toHaveBeenCalled();

    notePluginFetchSettled();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('준비 유지 중 다른 알림에는 다시 push하지 않는다', () => {
    mount();
    notePluginFetchSettled();
    notePluginFetchSettled();
    pushMock.mockClear();

    noteEnabledPluginCount(3);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('재주입으로 준비가 풀렸다 돌아오면 다시 push', () => {
    mount();
    notePluginFetchSettled();
    notePluginFetchSettled();
    pushMock.mockClear();

    const endWork = beginPluginWork();
    expect(pushMock).not.toHaveBeenCalled();
    endWork();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('이미 준비된 상태로 마운트되면 즉시 push', () => {
    notePluginFetchSettled();
    notePluginFetchSettled();
    mount();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
