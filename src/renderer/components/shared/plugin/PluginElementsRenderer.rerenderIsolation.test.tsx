/**
 * 리스트 렌더러 격리 회귀 테스트 (#111 구조 경화)
 * 요소 하나의 state/html 갱신이 리스트 렌더러 본문 재실행(전체 재조정)으로
 * 승격되지 않아야 한다. 스텁을 memo 없이 모킹해 렌더러가 리렌더되면
 * 모든 스텁 카운트가 오르도록 하여 렌더러 비리렌더를 형제 카운트로 검증한다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

type StubProps = {
  element: { fullId: string; state?: Record<string, unknown> };
  arrayIndex?: number;
};

const probe = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  lastArrayIndex: {} as Record<string, number | undefined>,
}));

// memo 없는 스텁 - 렌더러/Host 리렌더가 그대로 카운트에 드러남
vi.mock('@components/shared/plugin/PluginElement', () => {
  const Stub = (props: StubProps) => {
    probe.counts[props.element.fullId] =
      (probe.counts[props.element.fullId] ?? 0) + 1;
    probe.lastArrayIndex[props.element.fullId] = props.arrayIndex;
    return null;
  };
  return { PluginElement: Stub };
});

import { PluginElementsRenderer } from '@components/shared/plugin/PluginElementsRenderer';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const makeElement = (
  fullId: string,
  extra?: Partial<PluginDisplayElementInternal>,
): PluginDisplayElementInternal =>
  ({
    fullId,
    pluginId: 'test',
    state: { count: 0 },
    ...extra,
  } as unknown as PluginDisplayElementInternal);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  probe.counts = {};
  probe.lastArrayIndex = {};
  (window as unknown as { api: unknown }).api = {
    bridge: { on: () => () => {} },
  };
  useKeyStore.setState({ selectedKeyType: '4key' });
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  usePluginDisplayElementStore.setState({ elements: [] });
});

const mountRenderer = () => {
  act(() => {
    root.render(<PluginElementsRenderer windowType="main" />);
  });
};

describe('리스트 렌더러 격리 (#111 구조 경화)', () => {
  it('state만 갱신하면 해당 요소만 리렌더되고 렌더러는 재실행되지 않는다', () => {
    usePluginDisplayElementStore.setState({
      elements: [
        makeElement('plugin:a'),
        makeElement('plugin:b'),
        makeElement('plugin:c'),
      ],
    });
    mountRenderer();
    expect(probe.counts).toEqual({
      'plugin:a': 1,
      'plugin:b': 1,
      'plugin:c': 1,
    });

    // 플러그인 setState 경로와 동일한 state-only 갱신
    act(() => {
      usePluginDisplayElementStore
        .getState()
        .updateElement('plugin:a', { state: { count: 1 } });
    });
    // 렌더러가 재실행됐다면 memo 없는 b·c 스텁도 카운트가 올랐을 것
    expect(probe.counts).toEqual({
      'plugin:a': 2,
      'plugin:b': 1,
      'plugin:c': 1,
    });
  });

  it('updateElementBatched(rAF) 경로도 해당 요소만 리렌더한다 - #111 실제 setState 경로', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });

    usePluginDisplayElementStore.setState({
      elements: [makeElement('plugin:a'), makeElement('plugin:b')],
    });
    mountRenderer();

    act(() => {
      usePluginDisplayElementStore
        .getState()
        .updateElementBatched('plugin:a', { state: { count: 1 } });
      // rAF 코얼레스 flush - 스토어 커밋은 이 시점에 발생
      rafCallbacks.splice(0).forEach((cb) => cb(0));
    });
    expect(probe.counts).toEqual({ 'plugin:a': 2, 'plugin:b': 1 });

    rafSpy.mockRestore();
  });

  it('positive control - hidden 변경은 렌더 목록을 바꿔 렌더러가 재실행된다', () => {
    usePluginDisplayElementStore.setState({
      elements: [makeElement('plugin:a'), makeElement('plugin:b')],
    });
    mountRenderer();

    act(() => {
      usePluginDisplayElementStore
        .getState()
        .updateElement('plugin:a', { hidden: true });
    });
    // a는 언마운트, b는 렌더러 재실행으로 리렌더
    expect(probe.counts['plugin:b']).toBe(2);
    expect(probe.counts['plugin:a']).toBe(1);
  });

  it('positive control - 배열 순서 변경은 arrayIndex를 갱신한다 (z-order 폴백)', () => {
    const a = makeElement('plugin:a');
    const b = makeElement('plugin:b');
    usePluginDisplayElementStore.setState({ elements: [a, b] });
    mountRenderer();
    expect(probe.lastArrayIndex).toEqual({ 'plugin:a': 0, 'plugin:b': 1 });

    // 오버레이 sync 수신 등 setElements 경유 순서 변경
    act(() => {
      usePluginDisplayElementStore
        .getState()
        .setElements([b, a], { skipSync: true });
    });
    expect(probe.lastArrayIndex).toEqual({ 'plugin:a': 1, 'plugin:b': 0 });
  });

  it('명시적 zIndex 변경(bringToFront)은 해당 요소만 리렌더한다', () => {
    usePluginDisplayElementStore.setState({
      elements: [makeElement('plugin:a'), makeElement('plugin:b')],
    });
    mountRenderer();

    act(() => {
      usePluginDisplayElementStore.getState().bringToFront('plugin:a');
    });
    // zIndex는 요소 객체에 실리므로 Host 구독으로 전파 - 렌더 목록은 불변
    expect(probe.counts).toEqual({ 'plugin:a': 2, 'plugin:b': 1 });
  });

  it('현재 탭이 아닌 요소는 렌더되지 않고, 탭 전환 시 목록이 갱신된다', () => {
    usePluginDisplayElementStore.setState({
      elements: [
        makeElement('plugin:a', { tabId: '4key' }),
        makeElement('plugin:b', { tabId: '8key' }),
        makeElement('plugin:legacy'), // tabId 없음 - 모든 탭 표시
      ],
    });
    mountRenderer();
    expect(Object.keys(probe.counts).sort()).toEqual([
      'plugin:a',
      'plugin:legacy',
    ]);

    act(() => {
      useKeyStore.setState({ selectedKeyType: '8key' });
    });
    expect(probe.counts['plugin:b']).toBe(1);
  });

  it('요소 제거 직후에도 렌더러가 크래시 없이 목록을 갱신한다', () => {
    usePluginDisplayElementStore.setState({
      elements: [makeElement('plugin:a'), makeElement('plugin:b')],
    });
    mountRenderer();

    act(() => {
      usePluginDisplayElementStore.getState().removeElement('plugin:a');
    });
    expect(probe.counts['plugin:b']).toBe(2);
  });
});
