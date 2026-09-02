import type { CSSProperties } from 'react';
import {
  DEFAULT_SPRITE_IMAGE_FIT,
  type ReactiveSpritePosition,
  type SpriteTransform,
} from '@src/types/key/sprites';

import type { SpritePlacement } from './spritePlacement';

// 자세 변환의 CSS 표현. transform-origin은 pivot이 맡으므로 여기서는
// translate → rotate → scale 순서만 고정한다
export const spriteTransformToCss = (transform: SpriteTransform): string =>
  `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;

// 외관 채널 계산에 필요한 최소 필드
type SpriteImageStyleSource = Pick<
  ReactiveSpritePosition,
  'imageRect' | 'pivot' | 'imageFit' | 'useInlineStyles'
>;

// 스프라이트 이미지 스타일 계산 - 오버레이·에디터 공용.
// 배치·기준점은 항상 인라인, 외관 채널(object-fit·transform·transition)은
// 기본 모드에서 CSS 변수로 실어 전역 :where 규칙이 소비한다. 사용자 CSS가
// !important 없이 이기고 자세 transition도 유지 (키 이미지 레이어와 동일 구조).
// 인라인 우선 모드(useInlineStyles=true)만 실제 선언으로 승격.
// placement를 주면 그 rect·축을 쓴다(pivot 배치) - 없으면 imageRect·기준점(box)
export const computeSpriteImageStyle = (
  position: SpriteImageStyleSource,
  transform: SpriteTransform,
  transition?: string,
  placement?: SpritePlacement,
): CSSProperties => {
  const useInline = position.useInlineStyles === true;
  const fit = position.imageFit ?? DEFAULT_SPRITE_IMAGE_FIT;
  const transformCss = spriteTransformToCss(transform);
  const rect = placement?.rect ?? position.imageRect;
  const pivot = placement?.pivot ?? position.pivot;
  return {
    position: 'absolute',
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    transformOrigin: `${pivot.x * 100}% ${pivot.y * 100}%`,
    ...(useInline
      ? {
          objectFit: fit as CSSProperties['objectFit'],
          transform: transformCss,
          ...(transition ? { transition } : {}),
        }
      : ({
          '--dmn-sprite-fit-default': fit,
          '--dmn-sprite-transform-default': transformCss,
          ...(transition
            ? { '--dmn-sprite-transition-default': transition }
            : {}),
        } as CSSProperties)),
  };
};

// 사용자가 공개 변수로 자세 transform을 대체했는지. 애니메이션 원점은 사용자 CSS를
// 이기므로 onPress 재생이 이 값을 존중하려면 재생 전에 직접 확인해야 한다
export const SPRITE_TRANSFORM_OVERRIDE_VAR = '--sprite-transform';

export const hasSpriteTransformOverride = (el: Element): boolean => {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  return (
    view
      .getComputedStyle(el)
      .getPropertyValue(SPRITE_TRANSFORM_OVERRIDE_VAR)
      .trim() !== ''
  );
};

// 재생이 DOM에 직접 쓰는 배치 - onPress는 React 렌더 없이 src와 transform을 바꾸므로
// 이미지가 바뀔 때 rect·축도 같이 바꾸고, 복원 때 idle 배치로 되돌린다
export const applySpritePlacementStyle = (
  el: HTMLElement,
  placement: SpritePlacement,
): void => {
  el.style.left = `${placement.rect.x}px`;
  el.style.top = `${placement.rect.y}px`;
  el.style.width = `${placement.rect.width}px`;
  el.style.height = `${placement.rect.height}px`;
  el.style.transformOrigin = `${placement.pivot.x * 100}% ${
    placement.pivot.y * 100
  }%`;
};
