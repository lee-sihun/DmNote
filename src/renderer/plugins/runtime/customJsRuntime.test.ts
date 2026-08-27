// @vitest-environment jsdom
// @vitest-environment-options {"runScripts":"outside-only"}
// jsdom은 동적 script를 지연 실행해 주입 직후 정리되는 전역 프록시를 놓친다
// (실 Chromium은 동기 실행) - 이 파일은 요소 존재만 관찰하므로 실행을 끈다

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsPlugin, JsStatePayload } from '@src/types/plugin/js';
import type { CustomJsRuntime } from './customJsRuntime';
import {
  hasEnabledPlugins,
  isLocalPluginRuntimeReady,
  resetPluginRuntimeReadiness,
} from './pluginRuntimeReadiness';

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

vi.mock('@api/modules/pluginAuthorityApi', () => ({
  pluginAuthorityApi: { reset: authorityResetMock },
}));

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

// jsdom은 동적 script를 지연 실행한다. 런타임은 실행 흔적을 요구하므로
// 실 Chromium의 동기 평가를 appendChild 시점에 흉내낸다
const stubSynchronousEvaluation = () => {
  const original = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, 'appendChild').mockImplementation(((
    node: HTMLScriptElement,
  ) => {
    const appended = original(node);
    window.__dmn_plugin_ran = true;
    return appended;
  }) as typeof document.head.appendChild);
};

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
    stubSynchronousEvaluation();
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
    vi.restoreAllMocks();
    delete window.__dmn_plugin_ran;
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

describe('customJsRuntime 준비 신호', () => {
  let runtime: CustomJsRuntime | null = null;

  const startRuntime = async () => {
    const { createCustomJsRuntime } = await import('./customJsRuntime');
    runtime = createCustomJsRuntime();
    runtime.initialize();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stubSynchronousEvaluation();
    resetPluginRuntimeReadiness();
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
    vi.restoreAllMocks();
    delete window.__dmn_plugin_ran;
    resetPluginRuntimeReadiness();
    scripts().forEach((element) => element.remove());
  });

  it('주입이 끝난 뒤에만 준비 완료로 전환한다', async () => {
    await startRuntime();
    expect(isLocalPluginRuntimeReady()).toBe(false);

    await flush();

    expect(scripts()).toHaveLength(1);
    expect(isLocalPluginRuntimeReady()).toBe(true);
    expect(hasEnabledPlugins()).toBe(true);
  });

  it('플러그인 목록이 토글 상태보다 먼저 도착해도 성급히 준비로 보지 않는다', async () => {
    let resolveUse: ((value: boolean) => void) | null = null;
    jsGetUseMock.mockReset().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUse = resolve;
        }),
    );

    await startRuntime();
    await flush();

    // 목록만 도착한 시점 - 아직 주입 여부를 알 수 없다
    expect(scripts()).toHaveLength(0);
    expect(isLocalPluginRuntimeReady()).toBe(false);

    resolveUse?.(true);
    await flush();

    expect(scripts()).toHaveLength(1);
    expect(isLocalPluginRuntimeReady()).toBe(true);
  });

  it('JS 토글이 꺼져 있으면 주입 없이 준비 완료로 전환한다', async () => {
    jsGetUseMock.mockReset().mockResolvedValue(false);

    await startRuntime();
    await flush();

    expect(scripts()).toHaveLength(0);
    expect(isLocalPluginRuntimeReady()).toBe(true);
    expect(hasEnabledPlugins()).toBe(false);
  });

  it('초기 조회가 실패해도 준비 완료로 전환한다', async () => {
    jsGetMock.mockReset().mockRejectedValue(new Error('offline'));
    jsGetUseMock.mockReset().mockRejectedValue(new Error('offline'));

    await startRuntime();
    await flush();

    expect(isLocalPluginRuntimeReady()).toBe(true);
    expect(hasEnabledPlugins()).toBe(false);
  });

  it('authority reset 실패로 주입이 중단돼도 준비 완료로 전환한다', async () => {
    (window as { __dmn_window_type?: string }).__dmn_window_type = 'main';
    authorityResetMock.mockReset().mockRejectedValue(new Error('offline'));

    await startRuntime();
    await flush(600);

    expect(scripts()).toHaveLength(0);
    expect(isLocalPluginRuntimeReady()).toBe(true);
  });
});

describe('customJsRuntime 재주입 중 sync 페이로드', () => {
  let runtime: CustomJsRuntime | null = null;

  beforeEach(async () => {
    vi.useFakeTimers();
    resetPluginRuntimeReadiness();
    jsGetMock.mockReset().mockResolvedValue({ plugins: [{ ...pluginA }] });
    jsGetUseMock.mockReset().mockResolvedValue(true);
    onUseMock.mockClear();
    onStateMock.mockClear();
    sendBridgeMock.mockClear();
    authorityResetMock
      .mockReset()
      .mockResolvedValue({ authorityGeneration: 1, modelRevision: 1 });
    (window as { __dmn_window_type?: string }).__dmn_window_type = 'main';

    const { createCustomJsRuntime } = await import('./customJsRuntime');
    runtime = createCustomJsRuntime();
    runtime.initialize();
    await flush();
  });

  afterEach(async () => {
    runtime?.dispose();
    runtime = null;
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    resetPluginRuntimeReadiness();
    delete (window as { __dmn_window_type?: string }).__dmn_window_type;
    scripts().forEach((element) => element.remove());
  });

  it('teardown 단계의 빈 요소 sync를 준비 완료로 표시하지 않는다', async () => {
    sendBridgeMock.mockClear();

    // 재주입 - removeAll이 요소를 비우고 오버레이로 push한다
    stateListener()({ plugins: [{ ...pluginA, content: 'void 1;' }] });

    const readyFlags = sendBridgeMock.mock.calls
      .filter((call) => call[1] === 'plugin:displayElements:sync')
      .map((call) => (call[2] as { ready?: boolean }).ready);

    expect(readyFlags.length).toBeGreaterThan(0);
    expect(readyFlags).not.toContain(true);
  });
});
