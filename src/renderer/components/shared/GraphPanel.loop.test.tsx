// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GraphPanel from './GraphPanel';

const guards = vi.hoisted(() => ({ setterCalls: 0 }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useMemo: ((factory: () => unknown) => factory()) as typeof actual.useMemo,
    useState: ((initialState: unknown) => {
      const [value, setValue] = actual.useState(initialState);
      const guardedSetValue = actual.useCallback(
        (nextValue: React.SetStateAction<unknown>) => {
          guards.setterCalls += 1;
          if (guards.setterCalls > 50) {
            throw new Error('Maximum update depth exceeded.');
          }
          setValue(nextValue);
        },
        [setValue],
      );
      return [value, guardedSetValue];
    }) as typeof actual.useState,
  };
});

describe('GraphPanel 동일 history 상태 갱신 방지', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    guards.setterCalls = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const renderGraph = async (graphType: 'line' | 'bar') => {
    await act(async () => {
      root.render(
        <GraphPanel
          graphType={graphType}
          history={[1, 2, 3]}
          avg={2}
          maxval={3}
          uid={`stable-${graphType}`}
        />,
      );
    });
  };

  it('line 애니메이션 경로는 값이 같으면 상태를 다시 쓰지 않는다', async () => {
    await renderGraph('line');
    expect(host.querySelector('[data-graph-element="true"]')).not.toBeNull();
  });

  it('bar 애니메이션 경로는 값이 같으면 상태를 다시 쓰지 않는다', async () => {
    await renderGraph('bar');
    expect(host.querySelector('[data-graph-element="true"]')).not.toBeNull();
  });
});
