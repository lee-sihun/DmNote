import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverlayScene from './OverlayScene';
import type { NoteSettings } from '@src/types/settings/noteSettings';

vi.mock('@api/modules/overlayApi', () => ({
  overlayApi: { transitionFade: vi.fn() },
}));

const baseProps = {
  currentKeys: [] as string[],
  currentKeyLabels: [] as string[],
  displayPositions: [],
  currentPositions: [],
  displayStatPositions: [],
  displayGraphPositions: [],
  displayKnobPositions: [],
  selectedKeyType: '4key',
  noteEffect: false,
  noteSettings: {} as NoteSettings,
  webglTracks: [],
  notesRef: React.createRef(),
  subscribe: () => () => {},
  noteBuffer: null,
  backgroundColor: '#101014',
  keyCounterEnabled: false,
};

describe('OverlayScene 콘텐츠 박스', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (props: Record<string, unknown>) => {
    act(() => {
      root.render(<OverlayScene {...baseProps} {...props} />);
    });
  };

  const rootDiv = () => container.firstElementChild as HTMLElement;
  const backgroundLayer = () =>
    rootDiv().firstElementChild as HTMLElement | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('루트는 뷰포트 클리핑을 유지하고 크기 인라인 스타일을 갖지 않는다', () => {
    render({ contentSize: { width: 705, height: 645 } });
    const el = rootDiv();
    expect(el.className).toContain('overflow-hidden');
    expect(el.className).toContain('h-screen');
    expect(el.style.width).toBe('');
    expect(el.style.height).toBe('');
    expect(el.style.opacity).toBe('');
  });

  it('배경 레이어가 첫 자식으로 콘텐츠 박스 크기를 칠한다', () => {
    render({ contentSize: { width: 705, height: 645 } });
    const layer = backgroundLayer();
    expect(layer?.className).toContain('dmn-overlay-background');
    expect(layer?.className).toContain('pointer-events-none');
    expect(layer?.style.width).toBe('705px');
    expect(layer?.style.height).toBe('645px');
    expect(layer?.style.zIndex).toBe('0');
    expect(layer?.style.backgroundColor).not.toBe('');
  });

  it('contentSize 미지정 시 배경 레이어는 전체를 덮는다', () => {
    render({});
    const layer = backgroundLayer();
    expect(layer?.style.width).toBe('100%');
    expect(layer?.style.height).toBe('100%');
  });

  it('투명 배경이면 배경 레이어도 색을 칠하지 않는다', () => {
    render({ backgroundColor: 'transparent' });
    const layer = backgroundLayer();
    expect(layer?.style.backgroundColor).toBe('transparent');
  });

  it('contentFade 전달 시 루트에 opacity 전환이 붙고 미전달 시 없다', () => {
    render({ contentFade: { opacity: 0, durationMs: 80 } });
    expect(rootDiv().style.opacity).toBe('0');
    expect(rootDiv().style.transition).toContain('opacity');

    render({ contentFade: null });
    expect(rootDiv().style.opacity).toBe('');
    expect(rootDiv().style.transition).toBe('');
  });
});
