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
  // 백엔드 MAX_ABS_COORDINATE/MAX_DIMENSION과 동일
  imageRect: { coordMin: -32768, coordMax: 32768, dimensionMax: 32768 },
  maxPoses: 64,
  // 백엔드 MAX_SPRITE_POSE_TRIGGERS와 동일
  maxTriggersPerPose: 512,
  // 요소 id는 UUID 계열(urn 표기 45자까지) - 형식 검증은 백엔드 전담, 길이만 상한
  triggerIdMaxLength: 64,
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
  x: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.imageRect.coordMin)
    .max(SPRITE_CONSTRAINTS.imageRect.coordMax),
  y: z
    .number()
    .finite()
    .min(SPRITE_CONSTRAINTS.imageRect.coordMin)
    .max(SPRITE_CONSTRAINTS.imageRect.coordMax),
  width: z
    .number()
    .finite()
    .positive()
    .max(SPRITE_CONSTRAINTS.imageRect.dimensionMax),
  height: z
    .number()
    .finite()
    .positive()
    .max(SPRITE_CONSTRAINTS.imageRect.dimensionMax),
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
  // 사용자 지정 이름. 없으면 UI가 '상태 N'으로 표시하고, 백엔드는 None이면 키를 생략한다
  name: z.string().nullish(),
  // 키 요소 id 목록. 물리 키가 아니라 레인에 결합해서 키 매핑을 바꿔도 자리를 유지한다.
  // 빈 배열은 인입 허용 - 복구를 거친 store가 빈 트리거를 서빙해도 부트스트랩이
  // 죽지 않아야 한다 (커밋은 백엔드 EMPTY_SPRITE_POSE_TRIGGERS가 차단)
  triggers: z
    .array(z.string().min(1).max(SPRITE_CONSTRAINTS.triggerIdMaxLength))
    .max(SPRITE_CONSTRAINTS.maxTriggersPerPose),
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
  // Rust i32 - 소수·범위 초과는 decode에서 INVALID_REQUEST_PAYLOAD로 죽으므로 여기서 거른다
  zIndex: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
  // 백엔드는 다른 요소 위치와 같이 None이면 두 필드를 직렬화에서 생략한다
  layerName: z.string().nullish(),
  groupId: z.string().nullish(),
  className: z.string().nullable(),
  useInlineStyles: z.boolean().nullable(),

  baseImage: z.string().nullable(),
  imageFit: spriteImageFitSchema.nullable(),
  imageRect: spriteRectSchema,
  pivot: spriteAnchorSchema,

  idleTransform: spriteTransformSchema,
  poses: z.array(spritePoseSchema).max(SPRITE_CONSTRAINTS.maxPoses),
  activation: spriteActivationSchema,

  // Rust u32 - 소수는 decode 거부라 정수로 고정
  transitionMs: z
    .number()
    .int()
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

// 같은 담당 키 집합을 가진 자세가 둘이면 해석이 모호해진다. 저장 전에 걸러낸다.
// 빈 트리거는 중복이 아니라 미완성 draft다 - 백엔드 검증(EMPTY vs DUPLICATE)과 같은 구분
export const findDuplicateTriggerPose = (
  poses: readonly SpritePose[],
): SpritePose | null => {
  const seen = new Set<string>();
  for (const pose of poses) {
    if (pose.triggers.length === 0) continue;
    // 집합 비교라 pose 안의 중복 트리거도 무시한다
    const key = [...new Set(pose.triggers)].sort().join(' ');
    if (seen.has(key)) return pose;
    seen.add(key);
  }
  return null;
};

export const spriteTransformToCss = (transform: SpriteTransform): string =>
  `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;
