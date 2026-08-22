// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreLenisScroll, useLenis } from './useLenis';

const { instances } = vi.hoisted(() => ({
  instances: [] as Array<{
    raf: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    scrollTo: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('lenis', () => ({
  default: class {
    raf = vi.fn();
    resize = vi.fn();
    scrollTo = vi.fn();
    destroy = vi.fn();
    constructor() {
      instances.push(this);
    }
  },
}));

const ScrollArea = () => {
  const { scrollContainerRef } = useLenis();
  return <div ref={scrollContainerRef} />;
};

const ScrollAreaWithHandle = ({
  onReady,
}: {
  onReady: (node: HTMLDivElement) => void;
}) => {
  const { scrollContainerRef } = useLenis();
  return (
    <div
      ref={(node) => {
        scrollContainerRef(node);
        if (node) onReady(node);
      }}
    />
  );
};

const Harness = ({ count }: { count: number }) => (
  <>
    {Array.from({ length: count }, (_, index) => (
      <ScrollArea key={index} />
    ))}
  </>
);

describe('useLenis 공유 RAF', () => {
  let host: HTMLDivElement;
  let root: Root;
  let callbacks: Map<number, FrameRequestCallback>;

  beforeEach(() => {
    instances.length = 0;
    callbacks = new Map();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('여러 인스턴스를 RAF 하나에서 함께 갱신한다', () => {
    act(() => root.render(<Harness count={6} />));

    expect(instances).toHaveLength(6);
    expect(callbacks).toHaveLength(1);
    act(() => {
      const callback = [...callbacks.values()][0];
      callbacks.clear();
      callback(16);
    });
    instances.forEach((instance) =>
      expect(instance.raf).toHaveBeenCalledWith(16),
    );
    expect(callbacks).toHaveLength(1);
  });

  it('마지막 인스턴스가 해제되면 공유 RAF를 취소한다', () => {
    act(() => root.render(<Harness count={2} />));
    expect(callbacks).toHaveLength(1);
    act(() => root.render(null));
    expect(callbacks).toHaveLength(0);
    instances.forEach((instance) =>
      expect(instance.destroy).toHaveBeenCalledOnce(),
    );
  });

  it('문서 이동 뒤 DOM 위치와 Lenis 목표점을 함께 복원한다', () => {
    let wrapper: HTMLDivElement | null = null;
    act(() =>
      root.render(
        <ScrollAreaWithHandle
          onReady={(node) => {
            wrapper = node;
          }}
        />,
      ),
    );

    restoreLenisScroll(wrapper!, 240);
    expect(instances[0].resize).toHaveBeenCalledOnce();
    expect(instances[0].scrollTo).toHaveBeenCalledWith(240, {
      immediate: true,
      force: true,
    });
  });
});
