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
    imageFit: 'contain',
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

const activityGuide = () =>
  container.querySelector<HTMLElement>('[data-sprite-activity-guide="true"]');

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

  it('활동 영역 가이드는 이미지 유무에 따라 상시·호버로 갈린다', () => {
    // 이미지 없는 스프라이트는 가이드가 유일한 실체 - 점선 상시 표시
    const idle = renderSprite(spritePosition());
    expect(idle).not.toBeNull();
    expect(activityGuide()?.className).toContain('border-dashed');
    expect(activityGuide()?.className).not.toContain('border-transparent');
    expect(idle?.dataset.selected).toBeUndefined();
    // 이미지가 없으면 자리표시자 렌더
    expect(
      idle?.querySelector('[data-sprite-placeholder="true"]'),
    ).not.toBeNull();

    // 이미지가 있으면 점선은 소음이라 기본 투명, 호버에만 드러난다.
    // 호버는 캡처를 받는 루트(group) 기준이라 눌린 동안에도 유지된다
    renderSprite(spritePosition({ baseImage: 'hand.png' }));
    expect(activityGuide()?.className).toContain('border-transparent');
    // 호버 색도 고스트와 같은 토큰
    expect(activityGuide()?.className).toContain(
      'group-hover/sprite:border-[color:var(--ui-guide-activity)]',
    );
  });

  it('선택 상태는 공통 아웃라인이 전담해 내부 가이드를 그리지 않는다', () => {
    const selected = renderSprite(spritePosition(), { isSelected: true });
    expect(selected?.dataset.selected).toBe('true');
    // 그리드 아웃라인과 겹쳐 이중선이 되던 자리 - 아예 그리지 않는다
    expect(activityGuide()).toBeNull();
  });

  it('이미지 호스트는 보더가 없어 오버레이와 같은 원점을 쓴다', () => {
    // 보더가 있으면 absolute 이미지가 padding box 기준으로 1px 밀린다
    const host = renderSprite(spritePosition({ baseImage: 'hand.png' }));
    expect(host?.style.borderWidth).toBe('');
    expect(host?.className).not.toContain('border');
  });

  it('가이드 굵기와 radius는 줌에 반비례해 화면 px로 고정된다', () => {
    renderSprite(spritePosition(), { zoom: 4 });
    expect(activityGuide()?.style.borderWidth).toBe('0.25px');
    expect(activityGuide()?.style.borderRadius).toBe('1px');
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
    contactPoint: { x: 0.5, y: 1 },
    imagePivot: null,
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
    expect(marker?.style.transform).toBe('translate(-50%, -50%) scale(1)');

    act(() => useSpriteEditPreviewStore.getState().clear());
    expect(node?.querySelector('[data-sprite-pivot-marker="true"]')).toBeNull();
  });

  it('기준점 마커도 줌 보정으로 화면 크기를 유지한다', () => {
    act(() =>
      useSpriteEditPreviewStore
        .getState()
        .publish({ kind: 'pivot', positionId: SPRITE_ID }),
    );
    const node = renderSprite(spritePosition(), { zoom: 4 });

    const marker = node?.querySelector<HTMLElement>(
      '[data-sprite-pivot-marker="true"]',
    );
    // 중심은 축 위치에 남고 크기만 줄어든다
    expect(marker?.style.transform).toBe('translate(-50%, -50%) scale(0.25)');
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

  // 캔버스가 깨진 아이콘을 그리면 송출 화면과 미리보기가 갈린다.
  // 오버레이는 같은 상황에서 base 폴백 후 이미지 없음으로 내려간다
  it('실패한 이미지는 기본 이미지로 폴백하고 둘 다 실패하면 자리표시자로 간다', () => {
    const node = renderSprite(
      spritePosition({
        baseImage: '/base.png',
        poses: [pose('pose-1', { imageOverride: '/override.png' })],
      }),
    );
    const img = () => node?.querySelector('img');

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
    expect(activityGuide()?.className).not.toContain('border-transparent');
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

    expect(node?.querySelector('img')?.getAttribute('src')).toBe('/base.png');
    expect(node?.querySelector('[data-sprite-placeholder="true"]')).toBeNull();
  });
});
