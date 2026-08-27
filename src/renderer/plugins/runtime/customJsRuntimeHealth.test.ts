// @vitest-environment jsdom
// @vitest-environment-options {"runScripts":"outside-only"}
// jsdom은 동적 script를 지연 실행해 실 브라우저의 동기 평가를 재현하지 못한다
// (실 Chromium은 appendChild 중 동기 실행) - 평가 신호를 주입해 포착 경로만 검증한다

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JsPlugin } from '@src/types/plugin/js';
import type { CustomJsRuntime } from './customJsRuntime';
import { usePluginHealthStore } from '@stores/plugin/usePluginHealthStore';
import {
  currentPluginHealthRevision,
  waitForPluginInjection,
} from '@stores/plugin/usePluginHealthStore';
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
  sendBridgeMessageBestEffort: vi.fn(),
}));

const useListener = (): ((payload: { enabled: boolean }) => void) =>
  onUseMock.mock.calls[0][0];

const scripts = () =>
  Array.from(document.querySelectorAll('script[id^="dmn-custom-js-"]'));

const makePlugin = (id: string): JsPlugin => ({
  id,
  name: `${id}.js`,
  path: null,
  content: 'void 0;',
  enabled: true,
});

const healthOf = (id: string) => usePluginHealthStore.getState().health[id];

const realAppend = document.head.appendChild.bind(document.head);

/** 평가 신호를 appendChild 시점에 주입해 실 브라우저 동기 실행을 대신한다 */
const onAppend = (effect: (element: HTMLScriptElement) => void = () => {}) => {
  vi.spyOn(document.head, 'appendChild').mockImplementation(((
    node: HTMLScriptElement,
  ) => {
    const appended = realAppend(node);
    effect(node);
    // 래퍼 마지막 줄이 세우는 완주 표시 - effect가 중간 실패를 흉내낼 수 있게 뒤에 둔다
    window.__dmn_plugin_ran ??= true;
    return appended;
  }) as typeof document.head.appendChild);
};

describe('customJsRuntime 실행 상태 판정', () => {
  let runtime: CustomJsRuntime | null = null;

  const startRuntime = async (plugins: JsPlugin[]) => {
    jsGetMock.mockResolvedValue({ plugins });
    const { createCustomJsRuntime } = await import('./customJsRuntime');
    runtime = createCustomJsRuntime();
    runtime.initialize();
    await vi.advanceTimersByTimeAsync(200);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    jsGetMock.mockReset();
    jsGetUseMock.mockReset().mockResolvedValue(true);
    onUseMock.mockClear();
    onStateMock.mockClear();
    authorityResetMock
      .mockReset()
      .mockResolvedValue({ authorityGeneration: 1, modelRevision: 1 });
    usePluginHealthStore.setState({
      health: {},
      outcome: 'skipped',
      revision: 0,
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

  it('평가에 문제가 없으면 ok로 게시한다', async () => {
    await startRuntime([makePlugin('ok1')]);

    expect(healthOf('ok1')).toEqual({ status: 'ok' });
  });

  it('래퍼가 잡은 실행 오류를 failed로 게시한다', async () => {
    onAppend(() => {
      window.__dmn_plugin_run_error = 'plugin exploded';
    });
    await startRuntime([makePlugin('boom')]);

    expect(healthOf('boom')).toEqual({
      status: 'failed',
      message: 'plugin exploded',
    });
  });

  it('파싱 실패로 뜬 window error를 failed로 게시한다', async () => {
    onAppend(() => {
      // 문법 오류는 평가 자체가 없으므로 완주 표시가 서지 않는다
      window.__dmn_plugin_ran = false;
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'Unexpected end of input' }),
      );
    });
    await startRuntime([makePlugin('syntax')]);

    expect(healthOf('syntax')).toEqual({
      status: 'failed',
      message: 'Unexpected end of input',
    });
  });

  // 정상 종료한 플러그인이 진단용 error 이벤트를 쏴도 실패로 뒤집으면 안 된다
  it('완주한 플러그인의 합성 error 이벤트는 실패로 보지 않는다', async () => {
    onAppend(() => {
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'recoverable diagnostic' }),
      );
    });
    await startRuntime([makePlugin('noisy')]);

    expect(healthOf('noisy')).toEqual({ status: 'ok' });
    expect(scripts()).toHaveLength(1);
  });

  it('완주한 플러그인이 error 이벤트를 쏴도 등록한 UI를 회수하지 않는다', async () => {
    onAppend(() => {
      usePluginMenuStore
        .getState()
        .addKeyMenuItem({ id: 'kept', label: 'Kept' } as never);
      window.dispatchEvent(new ErrorEvent('error', { message: 'diagnostic' }));
    });
    await startRuntime([makePlugin('noisy')]);

    expect(healthOf('noisy')).toEqual({ status: 'ok' });
    expect(usePluginMenuStore.getState().keyMenuItems).toHaveLength(1);
  });

  it('실행 오류 신호는 다음 플러그인으로 새지 않는다', async () => {
    let appended = 0;
    onAppend(() => {
      appended += 1;
      if (appended === 1) window.__dmn_plugin_run_error = 'only first';
    });
    await startRuntime([makePlugin('bad'), makePlugin('good')]);

    expect(healthOf('bad')?.status).toBe('failed');
    expect(healthOf('good')).toEqual({ status: 'ok' });
  });

  it('꺼진 플러그인은 판정 대상에서 제외한다', async () => {
    await startRuntime([{ ...makePlugin('off'), enabled: false }]);

    expect(healthOf('off')).toBeUndefined();
  });

  it('실패한 플러그인이 throw 전에 등록한 UI를 되돌린다', async () => {
    onAppend(() => {
      // 사용자 코드가 메뉴를 등록한 직후 예외를 던진 상황
      usePluginMenuStore.getState().addKeyMenuItem({
        id: 'partial-marker',
        label: 'P1 Partial Marker',
      } as never);
      window.__dmn_plugin_run_error = 'exploded after side effect';
    });
    await startRuntime([makePlugin('partial')]);

    expect(healthOf('partial')?.status).toBe('failed');
    expect(usePluginMenuStore.getState().keyMenuItems).toHaveLength(0);
    expect(scripts()).toHaveLength(0);
  });

  it('성공한 플러그인의 UI 등록은 유지한다', async () => {
    onAppend(() => {
      usePluginMenuStore.getState().addKeyMenuItem({
        id: 'kept',
        label: 'Kept',
      } as never);
    });
    await startRuntime([makePlugin('fine')]);

    expect(healthOf('fine')).toEqual({ status: 'ok' });
    expect(usePluginMenuStore.getState().keyMenuItems).toHaveLength(1);
  });

  it('전역 JS를 끄면 이전 오류 상태를 비운다', async () => {
    onAppend(() => {
      window.__dmn_plugin_run_error = 'boom';
    });
    await startRuntime([makePlugin('boom')]);
    expect(healthOf('boom')?.status).toBe('failed');

    useListener()({ enabled: false });
    await vi.advanceTimersByTimeAsync(200);

    expect(usePluginHealthStore.getState().health).toEqual({});
  });

  // 오류 이벤트가 없다고 성공으로 추정하면 CSP 차단 같은 미평가를 놓친다
  it('평가 자체가 일어나지 않으면 failed로 게시한다', async () => {
    vi.spyOn(document.head, 'appendChild').mockImplementation(((
      node: HTMLScriptElement,
    ) => realAppend(node)) as typeof document.head.appendChild);

    await startRuntime([makePlugin('blocked')]);

    expect(healthOf('blocked')?.status).toBe('failed');
    expect(scripts()).toHaveLength(0);
  });

  it('기준 회차 이후의 정산을 기다린다', async () => {
    const revision = currentPluginHealthRevision();
    const pending = waitForPluginInjection(revision);
    usePluginHealthStore
      .getState()
      .publish('settled', { later: { status: 'failed' } });

    await expect(pending).resolves.toEqual({
      outcome: 'settled',
      health: { later: { status: 'failed' } },
    });
  });

  // 대기를 걸기 전에 정산이 끝나면 예전 구현은 5초 타임아웃까지 묶였다
  it('대기 전에 이미 정산됐으면 즉시 반환한다', async () => {
    const revision = currentPluginHealthRevision();
    usePluginHealthStore
      .getState()
      .publish('settled', { early: { status: 'failed' } });

    await expect(waitForPluginInjection(revision)).resolves.toEqual({
      outcome: 'settled',
      health: { early: { status: 'failed' } },
    });
  });

  // 대기 중 대상 플러그인을 꺼도 정산을 놓치면 안 된다.
  // settled는 그 시점 주입 전체의 스냅샷이라 빠진 id는 실패가 아니다
  // 파일명이 래퍼 문자열 리터럴에 그대로 들어가면 따옴표 하나로 전체가 깨진다
  it('따옴표가 든 파일명도 유효한 스크립트를 만든다', async () => {
    const plugin = { ...makePlugin('quoted'), name: `it's "weird".js` };
    await startRuntime([plugin]);

    const text = scripts()[0]?.textContent ?? '';
    expect(text).not.toBe('');
    expect(() => new Function(text)).not.toThrow();
    expect(healthOf('quoted')).toEqual({ status: 'ok' });
  });

  it('요청한 id가 빠진 정산도 결과로 받는다', async () => {
    const revision = currentPluginHealthRevision();
    const pending = waitForPluginInjection(revision);

    usePluginHealthStore
      .getState()
      .publish('settled', { other: { status: 'ok' } });

    await expect(pending).resolves.toEqual({
      outcome: 'settled',
      health: { other: { status: 'ok' } },
    });
  });

  it('주입이 중단되면 aborted로 정산한다', async () => {
    authorityResetMock.mockRejectedValue(new Error('reset failed'));
    await startRuntime([makePlugin('never')]);
    // reset은 250ms 간격으로 2회 재시도한다
    await vi.advanceTimersByTimeAsync(1000);

    expect(usePluginHealthStore.getState().outcome).toBe('aborted');
    expect(healthOf('never')).toBeUndefined();
  });
});
