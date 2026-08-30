/**
 * SpriteItem 캔버스 렌더 계약 테스트
 * 활동 영역 테두리는 선택 시 선택 색으로 바뀌고, hidden이면 렌더하지 않는다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpriteItem from '@components/main/Grid/layers/SpriteItem';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@utils/core/platform', () => ({ isMac: () => false }));

vi.mock('@hooks/Grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@hooks/Grid')>();
  return {
    ...actual,
    useDraggable: () => ({
      ref: () => {},
      dx: 0,
      dy: 0,
      wasMoved: false,
      isDragging: false,
      recentPressMovedRef: { current: false },
    }),
  };
});

vi.mock('@hooks/Grid/useSelectionDrag', () => ({
  useSelectionDrag: () => ({
    handlePointerDown: () => {},
    movedDuringPressRef: { current: false },
    pressMovedRef: { current: false },
  }),
}));

const SPRITE_ID = '00000000-0000-4000-8000-000000000801';

const spritePosition = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  id: SPRITE_ID,
  dx: 10,
  dy: 20,
  width: 200,
  height: 200,
  hidden: false,
  zIndex: null,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  imageFit: 'contain',
  imageRect: { x: 0, y: 0, width: 200, height: 200 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [],
  activation: 'whileHeld',
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;

const renderSprite = (
  position: CanonicalReactiveSpritePosition,
  options: { isSelected?: boolean } = {},
) => {
  act(() => {
    root.render(
      <SpriteItem
        index={0}
        elementId={SPRITE_ID}
        position={position}
        onPositionChange={() => {}}
        isSelected={options.isSelected ?? false}
        activeTool="move"
      />,
    );
  });
  return container.querySelector<HTMLElement>('[data-sprite-element="true"]');
};

describe('SpriteItem 렌더', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('선택 여부에 따라 활동 영역 테두리가 가이드와 선택 색을 오간다', () => {
    const idle = renderSprite(spritePosition());
    expect(idle).not.toBeNull();
    expect(idle?.style.border).toContain('dashed');
    expect(idle?.dataset.selected).toBeUndefined();
    // 이미지가 없으면 자리표시자 렌더
    expect(
      idle?.querySelector('[data-sprite-placeholder="true"]'),
    ).not.toBeNull();

    const selected = renderSprite(spritePosition(), { isSelected: true });
    expect(selected?.style.border).toContain('var(--ui-selection-border)');
    expect(selected?.dataset.selected).toBe('true');
  });

  it('hidden 스프라이트는 렌더하지 않는다', () => {
    const node = renderSprite(spritePosition({ hidden: true }));
    expect(node).toBeNull();
  });
});
