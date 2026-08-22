// @vitest-environment jsdom
// 플러그인은 진짜 window가 아니라 프록시를 window로 받는다.
// 네이티브 메서드가 this로 프록시를 받으면 brand check에서 거부당한다.
//
// 주의: jsdom은 이 brand check를 하지 않고, window 메서드를 다른 수신자로 호출하는
// 재타게팅도 재현하지 못한다(원본 함수로 해도 등록되지 않는다).
// 그래서 결함 재현, 수정 확인, 명시적 수신자 보존은 실제 브라우저 하네스가 담당한다.
// 이 파일은 환경과 무관한 계약만 고정한다 - 참조 동일성, api/dmn 주입,
// 플러그인이 심은 함수(일반, bound, Proxy) 미변경

import { describe, expect, it, vi } from 'vitest';

import { createPluginWindowProxy } from './pluginApiProxy';
import type { DMNoteAPI } from '@src/types/plugin/api';

const api = {} as unknown as DMNoteAPI;

describe('플러그인 window 프록시의 네이티브 메서드', () => {
  it('window.addEventListener와 dispatchEvent가 동작한다', () => {
    const proxy = createPluginWindowProxy(api);
    const listener = vi.fn();

    proxy.addEventListener('dmn-proxy-probe', listener);
    proxy.dispatchEvent(new Event('dmn-proxy-probe'));
    proxy.removeEventListener('dmn-proxy-probe', listener);
    proxy.dispatchEvent(new Event('dmn-proxy-probe'));

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('프록시로 등록한 리스너를 실제 window가 받는다', () => {
    const proxy = createPluginWindowProxy(api);
    const listener = vi.fn();

    proxy.addEventListener('dmn-proxy-bridge', listener);
    window.dispatchEvent(new Event('dmn-proxy-bridge'));
    window.removeEventListener('dmn-proxy-bridge', listener);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('같은 메서드는 같은 참조를 돌려준다', () => {
    const proxy = createPluginWindowProxy(api);

    expect(proxy.addEventListener).toBe(proxy.addEventListener);
  });

  it('타이머 계열도 실제 window를 this로 받는다', () => {
    vi.useFakeTimers();
    const proxy = createPluginWindowProxy(api);
    const tick = vi.fn();

    const id = proxy.setTimeout(tick, 10);
    vi.advanceTimersByTime(20);
    proxy.clearTimeout(id);

    expect(tick).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('플러그인이 직접 심은 전역 함수는 묶지 않는다', () => {
    const proxy = createPluginWindowProxy(api);
    const own = async () => {};
    (window as unknown as Record<string, unknown>).dmnPluginOwnFn = own;

    // 래퍼의 AsyncFunction 판별이 원본 함수에 의존한다
    expect((proxy as unknown as Record<string, unknown>).dmnPluginOwnFn).toBe(
      own,
    );

    delete (window as unknown as Record<string, unknown>).dmnPluginOwnFn;
  });

  it('플러그인이 만든 bound 함수는 참조가 유지된다', () => {
    const proxy = createPluginWindowProxy(api);
    const base = function base() {};
    const userBound = base.bind(null);
    (window as unknown as Record<string, unknown>).dmnBoundProbe = userBound;

    // bound 함수도 toString이 [native code]를 준다 - 이름으로 걸러야 한다
    expect((proxy as unknown as Record<string, unknown>).dmnBoundProbe).toBe(
      userBound,
    );

    delete (window as unknown as Record<string, unknown>).dmnBoundProbe;
  });

  it('네이티브 메서드를 다른 전역에 옮겨 담아도 참조가 같다', () => {
    const proxy = createPluginWindowProxy(api);
    const saved = proxy.setTimeout;
    (window as unknown as Record<string, unknown>).dmnSavedTimeout = saved;

    expect((proxy as unknown as Record<string, unknown>).dmnSavedTimeout).toBe(
      proxy.setTimeout,
    );

    delete (window as unknown as Record<string, unknown>).dmnSavedTimeout;
  });

  // callable Proxy로 감싼 사용자 함수도 toString이 [native code]를 준다.
  // 문자열 추측 대신 신원으로 판별해야 걸러진다
  it('Proxy로 감싼 사용자 함수는 참조가 유지된다', () => {
    const proxy = createPluginWindowProxy(api);
    const userProxy = new Proxy(function userFn() {}, {});
    (window as unknown as Record<string, unknown>).dmnProxyProbe = userProxy;

    expect((proxy as unknown as Record<string, unknown>).dmnProxyProbe).toBe(
      userProxy,
    );

    delete (window as unknown as Record<string, unknown>).dmnProxyProbe;
  });

  it('api와 dmn은 여전히 주입된 값을 준다', () => {
    const proxy = createPluginWindowProxy(api);

    expect((proxy as unknown as Record<string, unknown>).api).toBe(api);
    expect((proxy as unknown as Record<string, unknown>).dmn).toBe(api);
  });
});
