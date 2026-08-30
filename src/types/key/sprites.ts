import { z } from 'zod';

// 반응형 스프라이트: 키 입력에 따라 자세가 바뀌는 이미지 레이어.
// 키 요소와 달리 키 매핑에 인덱스 결합하지 않고, 담당 키를 자세마다 직접 참조한다.
// 저장 구조는 Rust ReactiveSpritePosition과 동일

export const SPRITE_CONSTRAINTS = {
  offset: { min: -2000, max: 2000 },
  rotation: { min: -180, max: 180 },
  scale: { min: 0.1, max: 10 },
  anchor: { min: 0, max: 1 },
  transitionMs: { min: 0, max: 1000 },
  maxPoses: 64,
} as const;

export const spriteTransformSchema = z.object({
  x: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.offset.min)
    .max(SPRITE_CONSTRAINTS.offset.max),
  y: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.offset.min)
    .max(SPRITE_CONSTRAINTS.offset.max),
  rotation: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.rotation.min)
    .max(SPRITE_CONSTRAINTS.rotation.max),
  scale: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.scale.min)
    .max(SPRITE_CONSTRAINTS.scale.max),
});
export type SpriteTransform = z.infer<typeof spriteTransformSchema>;

export const IDENTITY_SPRITE_TRANSFORM: SpriteTransform = Object.freeze({
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
});

// 백엔드 계약과 동일 3종. 키 이미지의 none은 스프라이트에 없다
export const spriteImageFitSchema = z.union([
  z.literal('cover'),
  z.literal('contain'),
  z.literal('fill'),
]);
export type SpriteImageFit = z.infer<typeof spriteImageFitSchema>;

export const spriteRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
});
export type SpriteRect = z.infer<typeof spriteRectSchema>;

// 원본 이미지 기준 정규화 좌표. CSS transform-origin으로 쓴다
export const spriteAnchorSchema = z.object({
  x: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.anchor.min)
    .max(SPRITE_CONSTRAINTS.anchor.max),
  y: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.anchor.min)
    .max(SPRITE_CONSTRAINTS.anchor.max),
});
export type SpriteAnchor = z.infer<typeof spriteAnchorSchema>;

export const CENTER_SPRITE_ANCHOR: SpriteAnchor = Object.freeze({
  x: 0.5,
  y: 0.5,
});

// 1차는 정확 일치만. 값을 저장해 두면 부분집합 오버라이드 확장이 마이그레이션 없이 열린다
export const spriteMatchModeSchema = z.literal('exact');
export type SpriteMatchMode = z.infer<typeof spriteMatchModeSchema>;

// 1차는 누르고 있는 동안만. 단발 이펙트(onPress)는 나중
export const spriteActivationSchema = z.literal('whileHeld');
export type SpriteActivation = z.infer<typeof spriteActivationSchema>;

export const spritePoseSchema = z.object({
  poseId: z.string().min(1),
  // 키 요소 id 목록. 물리 키가 아니라 레인에 결합해서 키 매핑을 바꿔도 자리를 유지한다
  triggers: z.array(z.string().min(1)).min(1),
  matchMode: spriteMatchModeSchema,
  transform: spriteTransformSchema,
  imageOverride: z.string().nullable(),
});
export type SpritePose = z.infer<typeof spritePoseSchema>;

export const reactiveSpritePositionSchema = z.object({
  // 백엔드 발급 요소 id. 발급 전에는 없을 수 있고 canonical 검증이 필수화한다
  id: z.string().min(1).nullish(),
  // 활동 영역. 손이 움직이는 전체 범위이고 창 크기 계산에 그대로 들어간다
  dx: z.number().finite(),
  dy: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  hidden: z.boolean(),
  zIndex: z.number().finite().nullable(),
  layerName: z.string().nullable(),
  groupId: z.string().nullable(),
  className: z.string().nullable(),
  useInlineStyles: z.boolean().nullable(),

  baseImage: z.string().nullable(),
  imageFit: spriteImageFitSchema.nullable(),
  imageRect: spriteRectSchema,
  pivot: spriteAnchorSchema,

  idleTransform: spriteTransformSchema,
  poses: z.array(spritePoseSchema).max(SPRITE_CONSTRAINTS.maxPoses),
  activation: spriteActivationSchema,

  transitionMs: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.transitionMs.min)
    .max(SPRITE_CONSTRAINTS.transitionMs.max),
  transitionEasing: z.string(),
});
export type ReactiveSpritePosition = z.infer<
  typeof reactiveSpritePositionSchema
>;

export type SpritePositions = Record<string, ReactiveSpritePosition[]>;

export const DEFAULT_SPRITE_TRANSITION_MS = 90;
export const DEFAULT_SPRITE_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

// 같은 담당 키 집합을 가진 자세가 둘이면 해석이 모호해진다. 저장 전에 걸러낸다
export const findDuplicateTriggerPose = (
  poses: readonly SpritePose[],
): SpritePose | null => {
  const seen = new Set<string>();
  for (const pose of poses) {
    // 집합 비교라 pose 안의 중복 트리거도 무시한다
    const key = [...new Set(pose.triggers)].sort().join(' ');
    if (seen.has(key)) return pose;
    seen.add(key);
  }
  return null;
};

export const spriteTransformToCss = (transform: SpriteTransform): string =>
  `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;
