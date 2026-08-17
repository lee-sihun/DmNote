// @vitest-environment jsdom
// @vitest-environment-options {"runScripts":"outside-only"}
// jsdom은 동적 script를 지연 실행해 주입 직후 정리되는 전역 프록시를 놓친다
// (실 Chromium은 동기 실행) - 이 파일은 요소 존재만 관찰하므로 실행을 끈다

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsPlugin, JsStatePayload } from '@src/types/plugin/js';
import type { CustomJsRuntime } from './customJsRuntime';

const {
  jsGetMock,
  jsGetUseMock,
  onUseMock,
  onStateMock,
  authorityResetMock,
  sendBridgeMock,
} = vi.hoisted(() => ({
  jsGetMock: vi.fn(),
  jsGetUseMock: vi.fn(),
  onUseMock: vi.fn(
    (_listener: (payload: { enabled: boolean }) => void) => () => {},
  ),
  onStateMock: vi.fn(
    (
        _listener: (
          payload: import('@src/types/plugin/js').JsStatePayload,
        ) => void,
      ) =>
      () => {},
  ),
  authorityResetMock: vi.fn(),
  sendBridgeMock: vi.fn(),
}));

vi.mock('@api/internalApi', () => ({
  internalApi: {
    js: {
      get: jsGetMock,
      getUse: jsGetUseMock,
      onUse: onUseMock,
      onState: onStateMock,
    },
    plugin: { storage: {} },
  },
}));

vi.mock('@api/modules/pluginRpcApi', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('@api/modules/pluginRpcApi')
  >();
  return {
    ...original,
    pluginRpcApi: {
      ...original.pluginRpcApi,
      authorityReset: authorityResetMock,
    },
  };
});

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: sendBridgeMock,
}));

const pluginA: JsPlugin = {
  id: 'p1',
  name: 'a.js',
  path: null,
  content: 'void 0;',
  enabled: true,
};

const scripts = () =>
  Array.from(document.querySelectorAll('script[id^="dmn-custom-js-"]'));

const stateListener = (): ((payload: JsStatePayload) => void) =>
  onStateMock.mock.calls[0][0];

const useListener = (): ((payload: { enabled: boolean }) => void) =>
  onUseMock.mock.calls[0][0];

const flush = async (ms = 200) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('customJsRuntime 재주입 가드', () => {
  let runtime: CustomJsRuntime | null = null;

  const startRuntime = async () => {
    const { createCustomJsRuntime } = await import('./customJsRuntime');
    runtime = createCustomJsRuntime();
    runtime.initialize();
    await flush();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    jsGetMock.mockReset().mockResolvedValue({ plugins: [{ ...pluginA }] });
    jsGetUseMock.mockReset().mockResolvedValue(true);
    onUseMock.mockClear();
    onStateMock.mockClear();
    sendBridgeMock.mockClear();
    authorityResetMock
      .mockReset()
      .mockResolvedValue({ authorityGeneration: 1, modelRevision: 1 });
    delete (window as { __dmn_window_type?: string }).__dmn_window_type;
  });

  afterEach(async () => {
    runtime?.dispose();
    runtime = null;
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    scripts().forEach((element) => element.remove());
  });

  it('최초 수신 시 플러그인을 주입한다', async () => {
    await startRuntime();

    expect(scripts()).toHaveLength(1);
  });

  it('동일 내용 재발행 시 재주입하지 않는다', async () => {
    await startRuntime();
    const injected = scripts()[0];

    stateListener()({ plugins: [{ ...pluginA }] });
    await flush();

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).toBe(injected);
  });

  it('내용 변경 시 정리 후 재주입한다', async () => {
    await startRuntime();
    const injected = scripts()[0];

    stateListener()({ plugins: [{ ...pluginA, content: 'void 1;' }] });
    await flush();

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(injected);
  });

  it('forced 재발행은 내용이 같아도 재주입한다', async () => {
    await startRuntime();
    const injected = scripts()[0];

    stateListener()({ plugins: [{ ...pluginA }], forced: true });
    await flush();

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(injected);
  });

  it('js:use 재활성화는 내용이 같아도 재주입한다', async () => {
    await startRuntime();
    const injected = scripts()[0];

    useListener()({ enabled: false });
    await flush();
    expect(scripts()).toHaveLength(0);

    useListener()({ enabled: true });
    await flush();

    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]).not.toBe(injected);
  });

  it('authority reset 실패 후 동일 내용 재발행이면 재시도한다', async () => {
    (window as { __dmn_window_type?: string }).__dmn_window_type = 'main';
    authorityResetMock.mockReset().mockRejectedValue(new Error('offline'));

    await startRuntime();
    await flush(600);
    expect(scripts()).toHaveLength(0);

    authorityResetMock
      .mockReset()
      .mockResolvedValue({ authorityGeneration: 2, modelRevision: 1 });
    stateListener()({ plugins: [{ ...pluginA }] });
    await flush(600);

    expect(scripts()).toHaveLength(1);
  });
});
