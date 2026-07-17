/**
 * 플러그인 요소 격리 회귀 테스트
 * 부모(Grid)가 렌더마다 새 인라인 콜백·offset 객체를 만들어도
 * 요소 하나의 갱신이 형제 요소 리렌더로 번지면 안 된다
 */
import React, { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useSmartGuidesElements } from '@hooks/Grid';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

type SelectionContextMenuPayload = {
  elementId: string;
  clientX: number;
  clientY: number;
  referenceElement: HTMLDivElement | null;
};

type StubProps = {
  element: { fullId: string };
  onSelectionContextMenu?: (payload: SelectionContextMenuPayload) => boolean;
};

const probe = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  lastProps: null as null | StubProps,
}));

// 실제 PluginElement(1500줄, Shadow DOM)는 무겁고, 검증 대상은
// "renderer가 memo를 깨뜨리지 않는 props를 주는가"이므로 memo 스텁으로 대체
vi.mock('@components/shared/PluginElement', async () => {
  const ReactActual = (await import('react')).default;
  const Stub = (props: StubProps) => {
    probe.counts[props.element.fullId] =
      (probe.counts[props.element.fullId] ?? 0) + 1;
    probe.lastProps = props;
    return null;
  };
  return { PluginElement: ReactActual.memo(Stub) };
});

import { PluginElementsRenderer } from '@components/shared/PluginElementsRenderer';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const makeElement = (fullId: string): PluginDisplayElementInternal =>
  ({
    fullId,
    pluginId: 'test',
    width: 100,
  } as unknown as PluginDisplayElementInternal);

// Grid와 동일한 최악 조건: 렌더마다 새 콜백·새 offset 객체
const Harness = () => (
  <PluginElementsRenderer
    windowType="main"
    positionOffset={{ x: 0, y: 0 }}
    onSelectionContextMenu={() => false}
    onMultiDrag={() => {}}
    onMultiDragStart={() => {}}
    onMultiDragEnd={() => {}}
  />
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  probe.counts = {};
  // main 모드 이펙트가 구독하는 bridge 채널 최소 스텁
  (window as unknown as { api: unknown }).api = {
    bridge: { on: () => () => {} },
  };
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
});

describe('플러그인 요소 격리', () => {
  it('요소 하나의 갱신이 형제 리렌더로 번지지 않는다', () => {
    usePluginDisplayElementStore.setState({
      elements: [
        makeElement('plugin:a'),
        makeElement('plugin:b'),
        makeElement('plugin:c'),
      ],
    });

    act(() => {
      root.render(<Harness />);
    });
    expect(probe.counts).toEqual({
      'plugin:a': 1,
      'plugin:b': 1,
      'plugin:c': 1,
    });

    // 부모 재렌더 (새 인라인 콜백·offset) — 아무 요소도 다시 렌더되면 안 됨
    act(() => {
      root.render(<Harness />);
    });
    expect(probe.counts).toEqual({
      'plugin:a': 1,
      'plugin:b': 1,
      'plugin:c': 1,
    });

    // a만 갱신 → a만 리렌더
    act(() => {
      usePluginDisplayElementStore
        .getState()
        .updateElement('plugin:a', { width: 140 });
    });
    expect(probe.counts).toEqual({
      'plugin:a': 2,
      'plugin:b': 1,
      'plugin:c': 1,
    });
  });

  it('안정화 콜백은 commit 직후(layout, passive 이전)에도 최신 콜백을 호출한다', () => {
    usePluginDisplayElementStore.setState({
      elements: [makeElement('plugin:a')],
    });

    const calls: string[] = [];
    // 상위 layout effect는 renderer(자식)의 layout effect 이후, passive 이전에 실행됨
    // — commit~passive 사이에 이전 콜백이 호출되는 창을 그대로 검사
    const LayoutProbe = ({ version }: { version: string }) => {
      useLayoutEffect(() => {
        probe.lastProps?.onSelectionContextMenu?.({
          elementId: 'plugin:a',
          clientX: 0,
          clientY: 0,
          referenceElement: null,
        });
      }, [version]);
      return (
        <PluginElementsRenderer
          windowType="main"
          positionOffset={{ x: 0, y: 0 }}
          onSelectionContextMenu={() => {
            calls.push(version);
            return false;
          }}
          onMultiDrag={() => {}}
          onMultiDragStart={() => {}}
          onMultiDragEnd={() => {}}
        />
      );
    };

    act(() => {
      root.render(<LayoutProbe version="v1" />);
    });
    act(() => {
      root.render(<LayoutProbe version="v2" />);
    });

    expect(calls).toEqual(['v1', 'v2']);
  });

  it('동일한 선택을 다시 설정해도 selectedElements 참조가 유지된다', () => {
    const store = useGridSelectionStore.getState();
    store.setSelectedElements([
      { type: 'plugin', id: 'plugin:a' },
      { type: 'key', id: 'key-1', index: 1 },
    ]);
    const first = useGridSelectionStore.getState().selectedElements;

    store.setSelectedElements([
      { type: 'plugin', id: 'plugin:a' },
      { type: 'key', id: 'key-1', index: 1 },
    ]);
    expect(useGridSelectionStore.getState().selectedElements).toBe(first);

    // 실제로 다른 선택이면 교체
    store.setSelectedElements([{ type: 'plugin', id: 'plugin:b' }]);
    expect(useGridSelectionStore.getState().selectedElements).not.toBe(first);
  });
});

describe('useSmartGuidesElements 비구독', () => {
  it('스토어가 바뀌어도 소비자는 리렌더되지 않고, 호출 시점 스냅샷을 읽는다', () => {
    const captured: {
      renders: number;
      getOther: ((exclude: string) => unknown[]) | null;
    } = { renders: 0, getOther: null };
    // Profiler 콜백·effect는 컴포넌트 렌더 밖이라 외부 상태 기록 가능
    const handleRender = (): void => {
      captured.renders += 1;
    };
    const Consumer = () => {
      const { getOtherElements } = useSmartGuidesElements();
      useLayoutEffect(() => {
        captured.getOther = getOtherElements;
      });
      return null;
    };

    usePluginDisplayElementStore.setState({ elements: [] });
    act(() => {
      root.render(
        <React.Profiler id="consumer" onRender={handleRender}>
          <Consumer />
        </React.Profiler>,
      );
    });
    const rendersAfterMount = captured.renders;

    // 플러그인 요소 추가 — 구독이 없으므로 리렌더 0
    act(() => {
      usePluginDisplayElementStore.setState({
        elements: [
          {
            ...makeElement('plugin:new'),
            position: { x: 10, y: 20 },
            measuredSize: { width: 50, height: 40 },
          } as unknown as PluginDisplayElementInternal,
        ],
      });
    });
    expect(captured.renders).toBe(rendersAfterMount);

    // 하지만 호출하면 최신 스냅샷이 보임
    const bounds = captured.getOther!('none') as { id: string }[];
    expect(bounds.some((b) => b.id === 'plugin:new')).toBe(true);
  });
});
