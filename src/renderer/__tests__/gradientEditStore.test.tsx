// @vitest-environment jsdom
/**
 * 그라데이션 편집 세션 스토어 테스트
 * 소유권 세대 규칙(같은 key 재발행 유지, 교체·왕복 증가)과
 * 일시 페인트 구독(useGradientPreviewSpec)의 대상 격리 검증
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  useGradientEditStore,
  useGradientPreviewSpec,
  type GradientEditSession,
  type GradientPreviewSurface,
} from '@stores/grid/useGradientEditStore';
import type { GradientSpec } from '@src/types/color';

const SPEC: GradientSpec = {
  angle: 90,
  stops: [
    { color: '#ff0000', pos: 0 },
    { color: '#0000ff', pos: 1 },
  ],
};

const makeSession = (
  sessionKey: string,
  overrides: Partial<GradientEditSession> = {},
): GradientEditSession => ({
  anchor: { kind: 'key', index: 0 },
  sessionKey,
  surface: 'background',
  spec: SPEC,
  selectedIndex: 0,
  selectStop: vi.fn(),
  apply: vi.fn(),
  ...overrides,
});

describe('소유권 세대 규칙', () => {
  beforeEach(() => {
    useGradientEditStore.getState().setSession(null);
  });

  it('같은 key의 스펙 재발행(프리뷰)에는 세대가 유지된다', () => {
    const store = useGradientEditStore;
    store.getState().setSession(makeSession('A'));
    const generation = store.getState().generation;
    // 프리뷰 재발행 경로 — null 경유 후 같은 key
    store.getState().setSession(null);
    store.getState().setSession(makeSession('A'));
    expect(store.getState().generation).toBe(generation);
  });

  it('key 교체와 A→B→A 왕복은 세대를 증가시킨다', () => {
    const store = useGradientEditStore;
    store.getState().setSession(makeSession('A'));
    const g0 = store.getState().generation;
    store.getState().setSession(makeSession('B'));
    expect(store.getState().generation).toBe(g0 + 1);
    store.getState().setSession(makeSession('A'));
    expect(store.getState().generation).toBe(g0 + 2);
  });
});

describe('useGradientPreviewSpec 대상 격리', () => {
  let root: Root;
  let host: HTMLDivElement;

  const Probe = ({
    kind,
    index,
    surface,
    inBatch = false,
  }: {
    kind: 'key' | 'stat' | 'graph' | 'knob';
    index: number;
    surface: GradientPreviewSurface;
    inBatch?: boolean;
  }) => {
    const spec = useGradientPreviewSpec(kind, index, surface, inBatch);
    return <div data-testid="probe" data-angle={spec ? spec.angle : 'none'} />;
  };

  const probeAngle = () =>
    (host.querySelector('[data-testid="probe"]') as HTMLElement).dataset.angle;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
      useGradientEditStore.getState().setSession(null);
    });
    host.remove();
  });

  it('요소·표면이 모두 일치할 때만 spec을 반환한다', () => {
    act(() => {
      useGradientEditStore
        .getState()
        .setSession(makeSession('A', { anchor: { kind: 'key', index: 2 } }));
      root.render(<Probe kind="key" index={2} surface="background" />);
    });
    expect(probeAngle()).toBe('90');

    // 표면 불일치
    act(() => {
      root.render(<Probe kind="key" index={2} surface="border" />);
    });
    expect(probeAngle()).toBe('none');

    // 인덱스 불일치
    act(() => {
      root.render(<Probe kind="key" index={3} surface="background" />);
    });
    expect(probeAngle()).toBe('none');

    // 종류 불일치
    act(() => {
      root.render(<Probe kind="stat" index={2} surface="background" />);
    });
    expect(probeAngle()).toBe('none');
  });

  it('batch 세션은 선택된 요소에만 반영된다', () => {
    act(() => {
      useGradientEditStore
        .getState()
        .setSession(makeSession('batch', { anchor: { kind: 'batch' } }));
      root.render(<Probe kind="key" index={0} surface="background" inBatch />);
    });
    expect(probeAngle()).toBe('90');

    act(() => {
      root.render(
        <Probe kind="key" index={0} surface="background" inBatch={false} />,
      );
    });
    expect(probeAngle()).toBe('none');
  });
});
