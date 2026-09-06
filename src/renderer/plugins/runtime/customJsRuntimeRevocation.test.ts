// @vitest-environment jsdom
// @vitest-environment-options {"runScripts":"outside-only"}
/**
 * 주입 세대 회수·진단 계약
 * - 실패·제거된 세대의 API 핸들은 쓰기가 거절되고, 같은 id를 다시 주입해도 옛 핸들은 막힌다
 * - throw ''도 실패로 남고, 비동기 reject는 sourceURL로 귀속해 로그에 남긴다
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsPlugin } from '@src/types/plugin/js';
import type { DMNoteAPI } from '@src/types/plugin/api';
import type { CustomJsRuntime } from './customJsRuntime';
import { usePluginHealthStore } from '@stores/plugin/usePluginHealthStore';
import { usePluginMenuStore } from '@stores/plugin/usePluginMenuStore';

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

const gateway = vi.hoisted(() => ({
  pluginKeysUpdate: vi.fn(async () => ({})),
  pluginKeysUpdateWithPositions: vi.fn(async () => ({})),
  pluginEditorCommit: vi.fn(async () => ({})),
  pluginPositionsUpdate: vi.fn(async () => ({})),
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

vi.mock('./api/pluginWriteGateway', () => gateway);

type ScriptWithApi = HTMLScriptElement & { __dmn_plugin_api?: DMNoteAPI };

const useListener = (): ((payload: { enabled: boolean }) => void) =>
  onUseMock.mock.calls[0][0];

const makePlugin = (id: string, content = 'void 0;'): JsPlugin => ({
  id,
  name: `${id}.js`,
  path: null,
  content,
  enabled: true,
});

const realAppend = document.head.appendChild.bind(document.head);

describe('customJsRuntime 세대 회수', () => {
  let runtime: CustomJsRuntime | null = null;
  /** 평가 시점에 넘겨진 API - 세대별로 누적 */
  let capturedApis: DMNoteAPI[] = [];
  let lastScriptText = '';
  let failNext = false;

  const onAppend = () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation(((
      node: ScriptWithApi,
    ) => {
      const appended = realAppend(node);
      if (node.__dmn_plugin_api) capturedApis.push(node.__dmn_plugin_api);
      lastScriptText = node.textContent ?? '';
      if (failNext) {
        window.__dmn_plugin_run_error = 'boom';
        failNext = false;
      }
      window.__dmn_plugin_ran = true;
      return appended;
    }) as typeof document.head.appendChild);
  };

  const startRuntime = async (plugins: JsPlugin[]) => {
    jsGetMock.mockResolvedValue({ plugins });
    const { createCustomJsRuntime } = await import('./customJsRuntime');
    runtime = createCustomJsRuntime();
    runtime.initialize();
    await vi.advanceTimersByTimeAsync(200);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    capturedApis = [];
    lastScriptText = '';
    failNext = false;
    jsGetMock.mockReset();
    jsGetUseMock.mockReset().mockResolvedValue(true);
    onUseMock.mockClear();
    onStateMock.mockClear();
    gateway.pluginKeysUpdate.mockClear();
    authorityResetMock
      .mockReset()
      .mockResolvedValue({ authorityGeneration: 1, modelRevision: 1 });
    usePluginHealthStore.setState({
      health: {},
      outcome: 'skipped',
      revision: 0,
      knownIds: undefined,
    });
    usePluginMenuStore.setState({ keyMenuItems: [], gridMenuItems: [] });
    (window as { __dmn_window_type?: string }).__dmn_window_type = 'main';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    onAppend();
  });

  afterEach(async () => {
    runtime?.dispose();
    runtime = null;
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as { __dmn_window_type?: string }).__dmn_window_type;
    delete window.__dmn_plugin_run_error;
    delete window.__dmn_plugin_ran;
    document
      .querySelectorAll('script[id^="dmn-custom-js-"]')
      .forEach((element) => element.remove());
  });

  it('실패한 주입의 핸들은 쓰기가 거절된다', async () => {
    failNext = true;
    await startRuntime([makePlugin('boom')]);

    expect(usePluginHealthStore.getState().health.boom?.status).toBe('failed');
    expect(capturedApis).toHaveLength(1);
    await expect(capturedApis[0].keys.update({} as never)).rejects.toThrow(
      /no longer active/,
    );
    expect(gateway.pluginKeysUpdate).not.toHaveBeenCalled();
  });

  it('활성 핸들은 쓰기가 통과하고, 제거되면 같은 핸들이 거절된다', async () => {
    await startRuntime([makePlugin('alive')]);
    const api = capturedApis[0];

    await api.keys.update({} as never);
    expect(gateway.pluginKeysUpdate).toHaveBeenCalledTimes(1);

    useListener()({ enabled: false });
    await vi.advanceTimersByTimeAsync(50);

    await expect(api.keys.update({} as never)).rejects.toThrow(
      /no longer active/,
    );
    expect(gateway.pluginKeysUpdate).toHaveBeenCalledTimes(1);
  });

  it('같은 id를 다시 주입하면 새 세대만 통과하고 옛 세대는 계속 막힌다', async () => {
    await startRuntime([makePlugin('regen')]);
    const first = capturedApis[0];

    useListener()({ enabled: false });
    await vi.advanceTimersByTimeAsync(50);
    useListener()({ enabled: true });
    await vi.advanceTimersByTimeAsync(200);

    expect(capturedApis).toHaveLength(2);
    const second = capturedApis[1];
    await second.keys.update({} as never);
    expect(gateway.pluginKeysUpdate).toHaveBeenCalledTimes(1);
    await expect(first.keys.update({} as never)).rejects.toThrow(
      /no longer active/,
    );
  });

  it("throw ''도 실패로 남는다 - 래퍼가 빈 메시지를 대체한다", async () => {
    await startRuntime([makePlugin('empty', "throw '';")]);
    expect(lastScriptText).toContain('//# sourceURL=dmn-plugin-empty.js');

    // 실 브라우저의 동기 평가를 흉내낸다 - 래퍼가 catch에서 남기는 값만 본다
    const fakeWindow: Record<string, unknown> = {};
    const run = new Function('window', 'document', lastScriptText);
    run(fakeWindow, { currentScript: { __dmn_plugin_api: {} } });

    expect(fakeWindow.__dmn_plugin_run_error).toBe('Unknown error');
    expect(fakeWindow.__dmn_plugin_ran).toBe(true);
  });

  it('비동기 reject는 sourceURL로 플러그인에 귀속해 로그에 남긴다', async () => {
    await startRuntime([makePlugin('async')]);
    const error = console.error as unknown as ReturnType<typeof vi.fn>;
    error.mockClear();

    const attributed = Object.assign(new Event('unhandledrejection'), {
      reason: Object.assign(new Error('late'), {
        stack: 'Error: late\n    at seed (dmn-plugin-async.js:3:5)',
      }),
    });
    window.dispatchEvent(attributed);
    expect(error).toHaveBeenCalledWith(
      '[Plugin async] Unhandled promise rejection',
      expect.any(Error),
    );

    error.mockClear();
    window.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: new Error('elsewhere'),
      }),
    );
    expect(error).not.toHaveBeenCalled();
  });
});
