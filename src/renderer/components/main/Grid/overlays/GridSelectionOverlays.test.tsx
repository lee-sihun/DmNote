// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalKeyPosition } from '@src/types/editor';
import GridSelectionOverlays from './GridSelectionOverlays';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../handles/ResizeHandles', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: Record<string, unknown>) =>
      createElement('div', {
        'data-resize-handles': props.elementId,
        'data-preview-bounds': JSON.stringify(props.previewBounds),
      }),
  };
});

vi.mock('../handles/GroupResizeHandles', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: Record<string, unknown>) =>
      createElement('div', {
        'data-group-resize-handles': String(
          (props.selectedElements as unknown[]).length,
        ),
      }),
  };
});

vi.mock('../handles/GradientAxisHandle', async () => {
  const { createElement } = await import('react');
  return {
    default: () => createElement('div', { 'data-gradient-axis': '' }),
  };
});

vi.mock('../handles/SpriteCanvasHandles', async () => {
  const { createElement } = await import('react');
  return {
    default: () => createElement('div', { 'data-sprite-handles': '' }),
  };
});

const keyPosition = (
  id: string,
  dx: number,
  dy: number,
): CanonicalKeyPosition =>
  ({ id, dx, dy, width: 30, height: 40 } as CanonicalKeyPosition);

const FIRST_ID = '00000000-0000-4000-8000-000000000201';
const SECOND_ID = '00000000-0000-4000-8000-000000000202';

describe('GridSelectionOverlays', () => {
  let host: HTMLDivElement;
  let root: Root;

  const renderOverlays = ({
    selectedElements = [{ type: 'key' as const, id: FIRST_ID, index: 0 }],
    hasGradientEditSession = false,
    hasSpritePoseSession = false,
    previewElementBounds = null as readonly unknown[] | null,
  } = {}) => {
    act(() => {
      root.render(
        <GridSelectionOverlays
          selectedElements={selectedElements}
          positions={{
            '4key': [
              keyPosition(FIRST_ID, 10, 20),
              keyPosition(SECOND_ID, 50, 60),
            ],
          }}
          statPositions={{}}
          graphPositions={{}}
          knobPositions={{}}
          spritePositions={{}}
          mode="4key"
          pluginElements={[]}
          zoom={2}
          panX={3}
          panY={4}
          hasGradientEditSession={hasGradientEditSession}
          hasSpritePoseSession={hasSpritePoseSession}
          previewBounds={{ x: 15, y: 25, width: 35, height: 45 }}
          previewGroupBounds={null}
          previewElementBounds={previewElementBounds}
          onResizeStart={vi.fn()}
          onResize={vi.fn()}
          onResizeEnd={vi.fn()}
          onGroupResize={vi.fn()}
          onGroupResizeEnd={vi.fn()}
          getOtherElements={() => []}
        />,
      );
    });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('단일 선택 윤곽과 리사이즈 핸들에 프리뷰 bounds를 적용한다', () => {
    renderOverlays();

    const outline = host.querySelector(
      '[data-grid-selection-outline]',
    ) as HTMLElement;
    expect(outline.style.left).toBe('31px');
    expect(outline.style.top).toBe('52px');
    expect(outline.style.width).toBe('74px');
    expect(outline.style.height).toBe('94px');
    expect(host.querySelector('[data-resize-handles]')).not.toBeNull();
    expect(host.querySelector('[data-group-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-gradient-axis]')).not.toBeNull();
    expect(host.querySelector('[data-sprite-handles]')).not.toBeNull();
  });

  it('스프라이트 자세 편집 중에는 리사이즈 핸들만 숨긴다', () => {
    renderOverlays({ hasSpritePoseSession: true });

    expect(host.querySelector('[data-grid-selection-outline]')).not.toBeNull();
    expect(host.querySelector('[data-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-sprite-handles]')).not.toBeNull();
  });

  it('그라데이션 편집 중에는 윤곽과 리사이즈 핸들만 숨긴다', () => {
    renderOverlays({ hasGradientEditSession: true });

    expect(host.querySelector('[data-grid-selection-outline]')).toBeNull();
    expect(host.querySelector('[data-resize-handles]')).toBeNull();
    expect(host.querySelector('[data-gradient-axis]')).not.toBeNull();
  });

  it('그룹 프리뷰 값은 단일 선택 윤곽에 영향을 주지 않는다', () => {
    renderOverlays({ previewElementBounds: [] });

    expect(host.querySelector('[data-grid-selection-outline]')).not.toBeNull();
  });

  it('다중 선택은 그룹 핸들을 사용하고 그룹 프리뷰 중 개별 윤곽을 숨긴다', () => {
    renderOverlays({
      selectedElements: [
        { type: 'key', id: FIRST_ID, index: 0 },
        { type: 'key', id: SECOND_ID, index: 1 },
      ],
      previewElementBounds: [{ id: FIRST_ID }],
    });

    expect(host.querySelectorAll('[data-grid-selection-outline]')).toHaveLength(
      0,
    );
    expect(
      host
        .querySelector('[data-group-resize-handles]')
        ?.getAttribute('data-group-resize-handles'),
    ).toBe('2');
    expect(host.querySelector('[data-resize-handles]')).toBeNull();
  });
});
