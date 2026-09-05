// @vitest-environment jsdom
// @vitest-environment-options {"runScripts":"outside-only"}
//
// 플러그인 주입 계약.
//
// 예전에는 진짜 window 대신 Proxy를 window 파라미터로 넘기고 그 안에서
// `api`와 `dmn`을 합성했다. 그래서 `window.addEventListener` 같은 네이티브 메서드가
// this로 프록시를 받아 brand check에서 거부당했고, 함수 참조 동일성도 깨졌다.
//
// 지금은 진짜 window를 넘기고 플러그인별 API를 두 번째 인자로 준다.
// 그 결과 `window.api`는 호스트 API 그대로이고 `window.dmn`은 존재하지 않는다.
// 이 파일은 그 계약을 고정한다.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomJsRuntime } from './customJsRuntime';
import type { JsPlugin } from '@src/types/plugin/js';

const { jsGetMock, jsGetUseMock, onUseMock, onStateMock, authorityResetMock } =
  vi.hoisted(() => ({
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

vi.mock('@api/modules/plugin/pluginAuthorityApi', () => ({
  pluginAuthorityApi: { reset: authorityResetMock },
}));

vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: vi.fn(),
}));

const realAppend = document.head.appendChild.bind(document.head);

type ScriptWithApi = HTMLScriptElement & { __dmn_plugin_api?: unknown };

const plugin: JsPlugin = {
  id: 'contract',
  name: 'contract.js',
  path: null,
  content: 'void 0;',
  enabled: true,
};

const script = () =>
  document.querySelector<ScriptWithApi>('script[id^="dmn-custom-js-"]');

describe('플러그인 주입 계약', () => {
  let runtime: CustomJsRuntime | null = null;
  /** 평가 시점에 element가 들고 있던 API */
  let apiAtEvaluation: unknown;
  let scriptTextAtEvaluation = '';

  beforeEach(async () => {
    vi.useFakeTimers();
    jsGetMock.mockReset().mockResolvedValue({ plugins: [{ ...plugin }] });
    jsGetUseMock.mockReset().mockResolvedValue(true);
    onUseMock.mockClear();
    onStateMock.mockClear();
    authorityResetMock
      .mockReset()
      .mockResolvedValue({ authorityGeneration: 1, modelRevision: 1 });
    (window as { __dmn_window_type?: string }).__dmn_window_type = 'main';
    vi.spyOn(console, 'error').mockImplementation(() => {});

    apiAtEvaluation = undefined;
    scriptTextAtEvaluation = '';
    vi.spyOn(document.head, 'appendChild').mockImplementation(((
      node: ScriptWithApi,
    ) => {
      const appended = realAppend(node);
      // 실 브라우저는 여기서 스크립트를 동기 평가한다
      apiAtEvaluation = node.__dmn_plugin_api;
      scriptTextAtEvaluation = node.textContent ?? '';
      window.__dmn_plugin_ran = true;
      return appended;
    }) as typeof document.head.appendChild);

    const { createCustomJsRuntime } = await import('./customJsRuntime');
    runtime = createCustomJsRuntime();
    runtime.initialize();
    await vi.advanceTimersByTimeAsync(200);
  });

  afterEach(async () => {
    runtime?.dispose();
    runtime = null;
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as { __dmn_window_type?: string }).__dmn_window_type;
    delete window.__dmn_plugin_ran;
    document
      .querySelectorAll('script[id^="dmn-custom-js-"]')
      .forEach((element) => element.remove());
  });

  it('진짜 window와 플러그인 API를 인자로 넘긴다', () => {
    expect(scriptTextAtEvaluation).toContain(';(function(window, dmn){');
    expect(scriptTextAtEvaluation).toContain(
      '})(window, document.currentScript.__dmn_plugin_api);',
    );
  });

  it('API는 공유 전역이 아니라 script element로만 전달한다', () => {
    expect(apiAtEvaluation).toBeTruthy();
    expect(apiAtEvaluation).toHaveProperty('plugin.storage');
    // 평가가 끝나면 참조를 떼어 element에 남기지 않는다
    expect(script()?.__dmn_plugin_api).toBeUndefined();
  });

  it('주입이 호스트 window.api를 건드리지 않는다', () => {
    const host = { surface: 'host' };
    const original = Object.getOwnPropertyDescriptor(window, 'api');
    Object.defineProperty(window, 'api', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: host,
    });

    try {
      expect(Reflect.get(window, 'api')).toBe(host);
    } finally {
      if (original) Object.defineProperty(window, 'api', original);
      else Reflect.deleteProperty(window, 'api');
    }
  });

  it('window.dmn 전역을 만들지 않는다', () => {
    expect('dmn' in window).toBe(false);
  });

  it('주입용 임시 전역을 남기지 않는다', () => {
    expect(
      (window as unknown as Record<string, unknown>).__dmn_plugin_window_proxy,
    ).toBeUndefined();
  });
});
