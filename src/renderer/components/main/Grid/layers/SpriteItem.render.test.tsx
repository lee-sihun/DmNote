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
import { makeCanonicalSpritePosition } from '@utils/sprite/spriteFixtures';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@utils/core/platform', () => ({ isMac: () => false }));

// 공용 상호작용 훅은 배럴이 아니라 소스 모듈을 직접 쓴다
vi.mock('@hooks/Grid/useDraggable', () => ({
  useDraggable: () => ({
    ref: () => {},
    dx: 0,
    dy: 0,
    wasMoved: false,
    isDragging: false,
    recentPressMovedRef: { current: false },
  }),
}));

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
): CanonicalReactiveSpritePosition =>
  makeCanonicalSpritePosition({
    id: SPRITE_ID,
    dx: 10,
    dy: 20,
    layerName: null,
    groupId: null,
    ...overrides,
  });

let container: HTMLDivElement;
let root: Root;

const renderSprite = (
  position: CanonicalReactiveSpritePosition,
  options: { isSelected?: boolean; zoom?: number } = {},
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
        zoom={options.zoom ?? 1}
      />,
    );
  });
  return container.querySelector<HTMLElement>('[data-sprite-element="true"]');
};

const idleGhost = () =>
  container.querySelector<HTMLImageElement>('[data-sprite-idle-ghost="true"]');

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

  it('이미지가 없으면 자리표시자만 그리고 선택 표식은 공통 아웃라인이 맡는다', () => {
    const idle = renderSprite(spritePosition());
    expect(idle).not.toBeNull();
    expect(idle?.dataset.selected).toBeUndefined();
    expect(
      idle?.querySelector('[data-sprite-placeholder="true"]'),
    ).not.toBeNull();
    // 상자가 곧 이미지라 별도 가이드·표식이 없다 - 핸들은 오버레이 층 몫
    expect(
      idle?.querySelector('[data-sprite-activity-guide="true"]'),
    ).toBeNull();
    expect(idle?.querySelector('[data-sprite-pivot-marker="true"]')).toBeNull();

    const selected = renderSprite(spritePosition(), { isSelected: true });
    expect(selected?.dataset.selected).toBe('true');
  });

  it('이미지 호스트는 보더가 없어 오버레이와 같은 원점을 쓴다', () => {
    // 보더가 있으면 absolute 이미지가 padding box 기준으로 1px 밀린다
    const host = renderSprite(spritePosition({ baseImage: 'hand.png' }));
    expect(host?.style.borderWidth).toBe('');
    expect(host?.className).not.toContain('border');
  });

  it('기본 이미지는 요소 상자를 그대로 채운다', () => {
    const host = renderSprite(
      spritePosition({
        baseImage: 'hand.png',
        width: 120,
        height: 80,
        pivot: { x: 0.25, y: 1 },
        referenceNaturalSize: { source: 'hand.png', width: 60, height: 40 },
      }),
    );
    const img = host?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
    expect(img?.style.left).toBe('0px');
    expect(img?.style.top).toBe('0px');
    expect(img?.style.width).toBe('120px');
    expect(img?.style.height).toBe('80px');
    expect(img?.style.transformOrigin).toBe('25% 100%');
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

    const img = node?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
    // 인라인 선언이 비어야 사용자 CSS가 !important 없이 이긴다
    expect(img?.style.transform).toBe('');
    expect(img?.style.objectFit).toBe('');
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

    const img = node?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
    expect(img?.style.transform).toBe(
      'translate(4px, -2px) rotate(30deg) scale(1.5)',
    );
    // 상자가 비트맵 비율이라 늘리기가 곧 맞춤 - 인라인 모드는 fill로 승격
    expect(img?.style.objectFit).toBe('fill');
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
    imageOverrideMetrics: null,
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

  it('무효 상태의 기준 이미지 크기는 캔버스 배율에 반영되고 최신 기준 크기를 덮지 않는다', () => {
    const previewPose = pose('pose-1', {
      imageOverride: 'pose.png',
      imageOverrideMetrics: { source: 'pose.png', width: 32, height: 32 },
    });
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: previewPose.poseId,
        fallbackPose: previewPose,
        preferFallback: true,
        referenceNaturalSize: { source: null, width: 64, height: 32 },
      }),
    );
    const position = spritePosition({ width: 200, height: 150 });
    let host = renderSprite(position);
    let img = host?.querySelector<HTMLImageElement>('img');
    expect(img?.style.width).toBe('100px');
    expect(img?.style.height).toBe('150px');

    host = renderSprite({
      ...position,
      referenceNaturalSize: { source: null, width: 32, height: 32 },
    });
    img = host?.querySelector<HTMLImageElement>('img');
    expect(img?.style.width).toBe('200px');
    expect(img?.style.height).toBe('150px');
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

    const img = node?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
    expect(img?.style.transform).toBe(
      'translate(10px, 5px) rotate(45deg) scale(2)',
    );
    expect(img?.getAttribute('src')).toContain('override');
  });

  it('자세 편집 중에는 기본 자세를 반투명 고스트로 뒤에 남긴다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1'),
        preferFallback: false,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        useInlineStyles: true,
        poses: [pose('pose-1')],
      }),
    );

    const ghost = idleGhost();
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('src')).toContain('base');
    expect(ghost?.style.opacity).toBe('0.3');
    // 고스트는 기본 자세 그대로, 실제 이미지는 자세 변환
    expect(ghost?.style.transform).toBe(
      'translate(0px, 0px) rotate(0deg) scale(1)',
    );
    expect(node?.querySelectorAll('img').length).toBe(2);

    // 발행을 거두면 고스트도 사라진다
    act(() => useSpriteEditPreviewStore.getState().clear());
    expect(idleGhost()).toBeNull();
  });

  it('기본 자세와 같은 그림이면 고스트를 겹쳐 그리지 않는다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1', {
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
        }),
        preferFallback: true,
      }),
    );
    renderSprite(spritePosition({ baseImage: 'data:image/png;base64,base' }));
    expect(idleGhost()).toBeNull();
  });

  it('크기가 다른 자세 이미지는 같은 기준점을 축에 맞춰 원본 비율로 그린다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1', {
          transform: { x: 0, y: 0, rotation: 0, scale: 1 },
          imageOverride: 'data:image/png;base64,override',
          imageOverrideMetrics: {
            source: 'data:image/png;base64,override',
            width: 50,
            height: 200,
          },
        }),
        preferFallback: true,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: 'data:image/png;base64,base',
        width: 200,
        height: 200,
        pivot: { x: 0.5, y: 1 },
        referenceNaturalSize: {
          source: 'data:image/png;base64,base',
          width: 100,
          height: 100,
        },
      }),
    );
    const img = node?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
    // 배율 2 → 100x400, 기준점(0.5, 1)이 P(100, 200)에 놓인다 → left 50, top -200
    expect(img?.getAttribute('src')).toContain('override');
    expect((img as HTMLElement | null)?.style.width).toBe('100px');
    expect((img as HTMLElement | null)?.style.height).toBe('400px');
    expect((img as HTMLElement | null)?.style.left).toBe('50px');
    expect((img as HTMLElement | null)?.style.top).toBe('-200px');
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

    const img = node?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
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

    const img = node?.querySelector<HTMLImageElement>(
      'img:not([data-sprite-idle-ghost])',
    );
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
    const img = () =>
      node?.querySelector<HTMLImageElement>(
        'img:not([data-sprite-idle-ghost])',
      );
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

  // 캔버스가 깨진 아이콘을 그리면 송출 화면과 미리보기가 갈린다.
  // 오버레이는 같은 상황에서 base 폴백 후 이미지 없음으로 내려간다
  it('실패한 이미지는 기본 이미지로 폴백하고 둘 다 실패하면 자리표시자로 간다', () => {
    const node = renderSprite(
      spritePosition({
        baseImage: '/base.png',
        poses: [pose('pose-1', { imageOverride: '/override.png' })],
      }),
    );
    const img = () =>
      node?.querySelector<HTMLImageElement>(
        'img:not([data-sprite-idle-ghost])',
      );

    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1', { imageOverride: '/override.png' }),
        preferFallback: true,
      }),
    );
    expect(img()?.getAttribute('src')).toBe('/override.png');

    act(() => {
      img()?.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(img()?.getAttribute('src')).toBe('/base.png');

    act(() => {
      img()?.dispatchEvent(new Event('error', { bubbles: false }));
    });
    expect(img()).toBeNull();
    // 이미지가 없는 상태이므로 자리표시자와 상시 가이드로 함께 내려간다
    expect(
      node?.querySelector('[data-sprite-placeholder="true"]'),
    ).not.toBeNull();
  });

  // 스키마가 빈 문자열을 막지 않아 플러그인·임포트로 들어온다.
  // 해석기는 공백 override를 이미지 없음으로 보고 base를 쓰므로, 프리뷰가
  // 여기서 자리표시자로 내려가면 캔버스와 송출 화면이 갈린다
  it('공백뿐인 override 자세를 프리뷰해도 기본 이미지를 그린다', () => {
    act(() =>
      useSpriteEditPreviewStore.getState().publish({
        kind: 'pose',
        positionId: SPRITE_ID,
        poseId: 'pose-1',
        fallbackPose: pose('pose-1', { imageOverride: '   ' }),
        preferFallback: true,
      }),
    );
    const node = renderSprite(
      spritePosition({
        baseImage: '/base.png',
        poses: [pose('pose-1', { imageOverride: '   ' })],
      }),
    );

    expect(
      node
        ?.querySelector<HTMLImageElement>('img:not([data-sprite-idle-ghost])')
        ?.getAttribute('src'),
    ).toBe('/base.png');
    expect(node?.querySelector('[data-sprite-placeholder="true"]')).toBeNull();
  });
});
