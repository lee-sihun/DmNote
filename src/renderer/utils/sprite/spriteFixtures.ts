import type { CanonicalReactiveSpritePosition } from '@src/types/editor';
import type {
  ReactiveSpritePosition,
  SpritePose,
} from '@src/types/key/sprites';
import {
  DEFAULT_SPRITE_ACTIVATION,
  DEFAULT_SPRITE_PRESS_DURATION_MS,
  DEFAULT_SPRITE_SIZE,
  DEFAULT_SPRITE_TRANSITION_EASING,
  IDENTITY_SPRITE_TRANSFORM,
  CENTER_SPRITE_ANCHOR,
} from '@src/types/key/sprites';

// 테스트 전용 스프라이트 빌더. 스키마에 필수 필드가 늘 때 테스트 20여 곳을
// 각자 고치지 않도록 전체 형태를 한 곳에서 만든다.
// 프로덕션 코드는 이 모듈을 import하지 않는다

export const makeSpritePose = (
  overrides: Partial<SpritePose> = {},
): SpritePose => ({
  poseId: 'pose-1',
  triggers: [],
  transform: { ...IDENTITY_SPRITE_TRANSFORM },
  imageOverride: null,
  imageOverrideMetrics: null,
  ...overrides,
});

export const makeSpritePosition = (
  overrides: Partial<ReactiveSpritePosition> = {},
): ReactiveSpritePosition => ({
  id: 'sprite-1',
  dx: 0,
  dy: 0,
  width: DEFAULT_SPRITE_SIZE,
  height: DEFAULT_SPRITE_SIZE,
  rotation: 0,
  hidden: false,
  zIndex: null,
  // layerName·groupId는 백엔드가 None이면 키 자체를 생략한다 - 기본형도 그 형태를
  // 따르고, 명시 null이 필요한 테스트만 overrides로 넣는다
  className: null,
  useInlineStyles: null,
  baseImage: null,
  pivot: { ...CENTER_SPRITE_ANCHOR },
  idleTransform: { ...IDENTITY_SPRITE_TRANSFORM },
  activation: DEFAULT_SPRITE_ACTIVATION,
  pressDurationMs: DEFAULT_SPRITE_PRESS_DURATION_MS,
  poses: [],
  transitionMs: 90,
  transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
  referenceNaturalSize: null,
  ...overrides,
});

/** 서빙 문서에 들어가는 형태 - 요소 id가 확정돼 있다 */
export const makeCanonicalSpritePosition = (
  overrides: Partial<CanonicalReactiveSpritePosition> = {},
): CanonicalReactiveSpritePosition => ({
  ...makeSpritePosition(overrides),
  id: overrides.id ?? 'sprite-1',
});
