import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import SpriteDuplicateGhost from './SpriteDuplicateGhost';
import { ACTIVITY_AREA_GUIDE_COLOR } from '@utils/grid/activityAreaGuide';
import type { ReactiveSpritePosition } from '@src/types/key/sprites';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const position = (
  overrides: Partial<ReactiveSpritePosition> = {},
): ReactiveSpritePosition =>
  ({
    id: 'ghost-sprite',
    dx: 0,
    dy: 0,
    width: 200,
    height: 120,
    hidden: false,
    zIndex: null,
    className: null,
    useInlineStyles: null,
    baseImage: 'hand.png',
    pivot: { x: 0.5, y: 0.5 },
    idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
    poses: [],
    activation: 'whileHeld',
    pressDurationMs: 300,
    transitionMs: 90,
    transitionEasing: 'linear',
    referenceNaturalSize: null,
    ...overrides,
  } as ReactiveSpritePosition);

let container: HTMLDivElement;
let root: Root;

const renderGhost = (zoom = 1) => {
  act(() => {
    root.render(
      <SpriteDuplicateGhost
        position={position()}
        cursor={{ x: 300, y: 200 }}
        zoom={zoom}
      />,
    );
  });
  return container.querySelector<HTMLElement>('[data-sprite-ghost="true"]');
};

describe('SpriteDuplicateGhost', () => {
  it('배치 회전은 커서 중심의 고스트 상자에만 적용한다', () => {
    act(() =>
      root.render(
        <SpriteDuplicateGhost
          position={position({
            rotation: 90,
            idleTransform: { x: 4, y: -2, rotation: -179, scale: 1.2 },
          })}
          cursor={{ x: 300, y: 200 }}
          zoom={1}
        />,
      ),
    );
    const ghost = container.querySelector<HTMLElement>(
      '[data-sprite-ghost="true"]',
    )!;
    expect(ghost.style.transform).toBe(
      'translate3d(200px, 140px, 0) rotate(90deg)',
    );
    expect(ghost.style.transformOrigin).toBe('50% 50%');
    expect(
      ghost
        .querySelector('img')!
        .style.getPropertyValue('--dmn-sprite-transform-default'),
    ).toBe('translate(4px, -2px) rotate(-179deg) scale(1.2)');
    expect(ghost.querySelector('[data-sprite-element] > img')).not.toBeNull();
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('이미지 호스트에 보더를 두지 않아 놓는 순간 이미지가 튀지 않는다', () => {
    // 보더가 있으면 absolute 이미지가 padding box 기준으로 밀려
    // 확정된 SpriteItem 위치와 어긋난다
    const ghost = renderGhost();
    expect(ghost).not.toBeNull();
    expect(ghost?.style.borderWidth).toBe('');
    expect(ghost?.style.borderTopStyle).toBe('');
  });

  it('활동 영역 점선은 별도 층에 그리고 굵기를 줌으로 보정한다', () => {
    renderGhost(4);
    const guide = container.querySelector<HTMLElement>(
      '[data-sprite-activity-guide="true"]',
    );
    expect(guide?.style.borderTopStyle).toBe('dashed');
    expect(guide?.style.borderWidth).toBe('0.25px');
    expect(guide?.style.borderRadius).toBe('1px');
    // 아이템 가이드와 같은 토큰을 쓴다
    expect(guide?.style.borderColor).toBe(ACTIVITY_AREA_GUIDE_COLOR);
  });

  it('이미지는 활동 영역 상자를 그대로 채운다 (아이템과 같은 규칙)', () => {
    const image = renderGhost()?.querySelector<HTMLImageElement>('img');
    expect(image?.style.left).toBe('0px');
    expect(image?.style.top).toBe('0px');
    expect(image?.style.width).toBe('200px');
    expect(image?.style.height).toBe('120px');
  });

  it('이미지 로드 실패는 깨진 img 대신 아이템과 같은 자리표시자를 그린다', () => {
    const ghost = renderGhost();
    const image = ghost?.querySelector<HTMLImageElement>('img');
    expect(image).not.toBeNull();

    act(() => {
      image!.dispatchEvent(new Event('error'));
    });
    expect(ghost?.querySelector('img')).toBeNull();
    expect(
      ghost?.querySelector('[data-sprite-placeholder="true"]'),
    ).not.toBeNull();
  });

  it('기본 이미지가 없으면 자리표시자를 그린다', () => {
    act(() => {
      root.render(
        <SpriteDuplicateGhost
          position={position({ baseImage: null })}
          cursor={{ x: 300, y: 200 }}
          zoom={1}
        />,
      );
    });
    expect(container.querySelector('img')).toBeNull();
    expect(
      container.querySelector('[data-sprite-placeholder="true"]'),
    ).not.toBeNull();
  });

  it('사용자 클래스와 [data-sprite-element] 층을 아이템과 같게 둬 커스텀 CSS가 닿는다', () => {
    act(() => {
      root.render(
        <SpriteDuplicateGhost
          position={position({ className: 'left-hand' })}
          cursor={{ x: 300, y: 200 }}
          zoom={1}
        />,
      );
    });
    const ghost = container.querySelector<HTMLElement>(
      '[data-sprite-ghost="true"]',
    );
    expect(ghost?.classList.contains('left-hand')).toBe(true);
    // 문서의 `.클래스 [data-sprite-element] > img` 선택자가 고스트에서도 성립한다
    const image = container.querySelector<HTMLImageElement>(
      '.left-hand [data-sprite-element] > img',
    );
    expect(image).not.toBeNull();
    const layer = ghost?.querySelector<HTMLElement>('[data-sprite-element]');
    expect(layer?.style.position).toBe('relative');
    expect(layer?.style.width).toBe('100%');
    expect(layer?.style.height).toBe('100%');
  });

  it('기본 모드는 transform을 변수로만 실어 사용자 --sprite-transform이 이긴다', () => {
    act(() => {
      root.render(
        <SpriteDuplicateGhost
          position={position({
            idleTransform: { x: 4, y: 0, rotation: 15, scale: 1.2 },
          })}
          cursor={{ x: 300, y: 200 }}
          zoom={1}
        />,
      );
    });
    const image = container.querySelector<HTMLImageElement>('img')!;
    expect(image.style.transform).toBe('');
    expect(image.style.getPropertyValue('--dmn-sprite-transform-default')).toBe(
      'translate(4px, 0px) rotate(15deg) scale(1.2)',
    );
  });

  it('useInlineStyles=true는 아이템처럼 인라인 transform으로 승격한다', () => {
    act(() => {
      root.render(
        <SpriteDuplicateGhost
          position={position({
            useInlineStyles: true,
            idleTransform: { x: 4, y: 0, rotation: 15, scale: 1.2 },
          })}
          cursor={{ x: 300, y: 200 }}
          zoom={1}
        />,
      );
    });
    const image = container.querySelector<HTMLImageElement>('img')!;
    expect(image.style.transform).toBe(
      'translate(4px, 0px) rotate(15deg) scale(1.2)',
    );
  });

  it('클래스가 없으면 호스트 클래스에 빈 조각을 남기지 않는다', () => {
    const ghost = renderGhost();
    expect(ghost?.className.includes('undefined')).toBe(false);
    expect(ghost?.className.includes('null')).toBe(false);
  });
});
