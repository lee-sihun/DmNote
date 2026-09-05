// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DuplicateState } from '@hooks/Grid/useGridCanvasActions';
import DuplicateElementGhost from './DuplicateElementGhost';

// 스프라이트 고스트는 전용 컴포넌트 계약(SpriteDuplicateGhost.test)이 따로 잡는다
vi.mock('../layers/SpriteDuplicateGhost', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: Record<string, unknown>) =>
      createElement('div', {
        'data-sprite-ghost': String(props.zoom),
        'data-cursor': JSON.stringify(props.cursor),
      }),
  };
});

const duplicate = (
  value: Partial<DuplicateState> & Pick<DuplicateState, 'elementType'>,
): DuplicateState =>
  ({
    sourceIndex: 0,
    keyName: '',
    position: { id: 'source', dx: 0, dy: 0 },
    ...value,
  } as DuplicateState);

describe('DuplicateElementGhost', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const renderGhost = (
    duplicateState: DuplicateState | null,
    cursor: { x: number; y: number } | null,
  ) => {
    act(() => {
      root.render(
        <DuplicateElementGhost
          duplicate={duplicateState}
          cursor={cursor}
          zoom={2}
        />,
      );
    });
  };

  it('스프라이트 복제는 전용 고스트에 커서와 배율을 넘긴다', () => {
    renderGhost(duplicate({ elementType: 'sprite' }), { x: 12, y: 34 });

    const ghost = host.querySelector('[data-sprite-ghost]') as HTMLElement;
    expect(ghost.getAttribute('data-sprite-ghost')).toBe('2');
    expect(ghost.getAttribute('data-cursor')).toBe('{"x":12,"y":34}');
  });

  it('복제 상태나 커서가 없으면 고스트를 그리지 않는다', () => {
    renderGhost(null, { x: 10, y: 20 });
    expect(host.childElementCount).toBe(0);

    renderGhost(duplicate({ elementType: 'key' }), null);
    expect(host.childElementCount).toBe(0);
  });

  it('그래프 고스트는 원본 크기의 중심을 커서에 맞춘다', () => {
    renderGhost(
      duplicate({
        elementType: 'graph',
        position: {
          id: 'graph',
          dx: 0,
          dy: 0,
          width: 120,
          height: 60,
        } as DuplicateState['position'],
      }),
      { x: 100, y: 80 },
    );

    const ghost = host.firstElementChild as HTMLElement;
    expect(ghost.style.width).toBe('120px');
    expect(ghost.style.height).toBe('60px');
    expect(ghost.style.transform).toBe('translate3d(40px, 50px, 0)');
    expect(ghost.style.overflow).toBe('hidden');
  });

  it('이미지가 없는 고스트는 동결된 표시 이름과 기본 크기를 유지한다', () => {
    renderGhost(duplicate({ elementType: 'key', keyName: 'Enter' }), {
      x: 30,
      y: 30,
    });

    expect(host.textContent).toContain('Enter');
    const ghost = host.firstElementChild as HTMLElement;
    expect(ghost.style.width).toBe('60px');
    expect(ghost.style.height).toBe('60px');
    expect(ghost.style.transform).toBe('translate3d(0px, 0px, 0)');
  });

  it('replace 이미지는 기본 표면을 억제하고 원본 fit을 사용한다', () => {
    const image = 'data:image/png;base64,AA==';
    renderGhost(
      duplicate({
        elementType: 'key',
        position: {
          id: 'key',
          dx: 0,
          dy: 0,
          inactiveImage: image,
          imageMode: 'replace',
          idleImageFit: 'contain',
        } as DuplicateState['position'],
      }),
      { x: 30, y: 30 },
    );

    const ghost = host.firstElementChild as HTMLElement;
    expect(ghost.style.backgroundColor).toBe('transparent');
    expect(ghost.style.overflow).toBe('hidden');
    const preview = host.querySelector('img') as HTMLImageElement;
    expect(preview.src).toBe(image);
    expect(preview.style.objectFit).toBe('contain');
  });
});
