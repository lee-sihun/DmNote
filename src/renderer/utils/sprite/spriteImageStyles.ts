import type { CSSProperties } from 'react';
import {
  DEFAULT_SPRITE_IMAGE_FIT,
  type ReactiveSpritePosition,
  type SpriteTransform,
} from '@src/types/key/sprites';

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
// 인라인 우선 모드(useInlineStyles=true)만 실제 선언으로 승격
export const computeSpriteImageStyle = (
  position: SpriteImageStyleSource,
  transform: SpriteTransform,
  transition?: string,
): CSSProperties => {
  const useInline = position.useInlineStyles === true;
  const fit = position.imageFit ?? DEFAULT_SPRITE_IMAGE_FIT;
  const transformCss = spriteTransformToCss(transform);
  return {
    position: 'absolute',
    left: `${position.imageRect.x}px`,
    top: `${position.imageRect.y}px`,
    width: `${position.imageRect.width}px`,
    height: `${position.imageRect.height}px`,
    transformOrigin: `${position.pivot.x * 100}% ${position.pivot.y * 100}%`,
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
