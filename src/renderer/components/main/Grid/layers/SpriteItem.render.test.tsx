/**
 * SpriteItem 캔버스 렌더 계약 테스트
 * 활동 영역 테두리는 선택 시 선택 색으로 바뀌고, hidden이면 렌더하지 않는다
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SpriteItem from '@components/main/Grid/layers/SpriteItem';
import { useSpriteEditPreviewStore } from '@stores/grid/useSpriteEditPreviewStore';
import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type { SpritePose } from '@src/types/key/sprites';

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
    useSpriteEditPreviewStore.setState({ preview: null });
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

  it('useInlineStyles=false는 이미지 외관 채널을 변수로만 싣는다', () => {
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: false,
        idleTransform: { x: 4, y: -2, rotation: 30, scale: 1.5 },
      }),
    );

    const img = node?.querySelector('img');
    // 인라인 선언이 비어야 사용자 CSS가 !important 없이 이긴다
    expect(img?.style.transform).toBe('');
    expect(img?.style.objectFit).toBe('');
    expect(img?.style.getPropertyValue('--dmn-sprite-fit-default')).toBe(
      'contain',
    );
    expect(img?.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      'translate(4px, -2px) rotate(30deg) scale(1.5)',
    );
    // 정적 idle 렌더라 transition 채널 없음
    expect(img?.style.getPropertyValue('--dmn-sprite-transition-default')).toBe(
      '',
    );
    // 배치·기준점은 모드와 무관하게 인라인
    expect(img?.style.width).toBe('200px');
    expect(img?.style.transformOrigin).toBe('50% 50%');
  });

  it('useInlineStyles=true는 이미지 외관 채널을 인라인 선언으로 승격한다', () => {
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: true,
        idleTransform: { x: 4, y: -2, rotation: 30, scale: 1.5 },
      }),
    );

    const img = node?.querySelector('img');
    expect(img?.style.transform).toBe(
      'translate(4px, -2px) rotate(30deg) scale(1.5)',
    );
    expect(img?.style.objectFit).toBe('contain');
    expect(img?.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      '',
    );
  });
});

describe('SpriteItem 자세 편집 프리뷰', () => {
  const pose = (
    poseId: string,
    overrides: Partial<SpritePose> = {},
  ): SpritePose => ({
    poseId,
    triggers: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    transform: { x: 10, y: 5, rotation: 45, scale: 2 },
    imageOverride: null,
    ...overrides,
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useSpriteEditPreviewStore.setState({ preview: null });
  });

  it('발행된 자세는 composed poses의 최신 값이 스냅샷보다 우선한다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1', {
          transform: { x: 99, y: 99, rotation: 0, scale: 1 },
        }),
        preferFallback: false,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: true,
        poses: [
          pose('pose-1', {
            imageOverride: 'data:image/png;base64,override',
          }),
        ],
      }),
    );

    const img = node?.querySelector('img');
    expect(img?.style.transform).toBe(
      'translate(10px, 5px) rotate(45deg) scale(2)',
    );
    expect(img?.getAttribute('src')).toContain('override');
  });

  it('이미지 설정 발행은 기준점 마커를 그리고 회수하면 사라진다', () => {
    act(() =>
      useSpriteEditPreviewStore
        .getState()
        .publish({ kind: 'pivot', positionId: SPRITE_ID }),
    );
    const node = renderSprite(
      spritePosition({
        pivot: { x: 0.25, y: 1 },
        imageRect: { x: 10, y: 20, width: 100, height: 80 },
      }),
    );

    const marker = node?.querySelector<HTMLElement>(
      '[data-sprite-pivot-marker="true"]',
    );
    expect(marker).not.toBeNull();
    expect(marker?.style.left).toBe('35px');
    expect(marker?.style.top).toBe('100px');

    act(() => useSpriteEditPreviewStore.getState().clear());
    expect(node?.querySelector('[data-sprite-pivot-marker="true"]')).toBeNull();
  });

  it('무효 draft 편집은 canonical 값 대신 스냅샷을 우선한다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1', {
          triggers: [],
          transform: { x: 3, y: 4, rotation: 0, scale: 1 },
        }),
        preferFallback: true,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: true,
        poses: [pose('pose-1')],
      }),
    );

    const img = node?.querySelector('img');
    expect(img?.style.transform).toBe(
      'translate(3px, 4px) rotate(0deg) scale(1)',
    );
  });

  it('canonical에 없는 draft 자세는 발행 스냅샷으로 그리고 이미지는 base로 남는다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'draft-1',
        fallbackPose: pose('draft-1', {
          triggers: [],
          transform: { x: 7, y: 0, rotation: 0, scale: 1 },
        }),
        preferFallback: false,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: true,
        poses: [],
      }),
    );

    const img = node?.querySelector('img');
    expect(img?.style.transform).toBe(
      'translate(7px, 0px) rotate(0deg) scale(1)',
    );
    expect(img?.getAttribute('src')).toContain('base64,base');
  });

  it('다른 스프라이트의 발행은 무시하고 회수하면 대기 상태로 복귀한다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: '00000000-0000-4000-8000-000000000999',
        poseId: 'pose-1',
        fallbackPose: pose('pose-1'),
        preferFallback: false,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: true,
        idleTransform: { x: 1, y: 2, rotation: 0, scale: 1 },
      }),
    );
    const img = () => node?.querySelector('img');
    expect(img()?.style.transform).toBe(
      'translate(1px, 2px) rotate(0deg) scale(1)',
    );

    // 자기 발행으로 전환 후 회수하면 대기 상태로 복귀
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1'),
        preferFallback: false,
      }),
    );
    expect(img()?.style.transform).toBe(
      'translate(10px, 5px) rotate(45deg) scale(2)',
    );
    act(() => useSpriteEditPreviewStore.getState().clear());
    expect(img()?.style.transform).toBe(
      'translate(1px, 2px) rotate(0deg) scale(1)',
    );
  });
});
