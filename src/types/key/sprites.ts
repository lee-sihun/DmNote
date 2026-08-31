import { z } from 'zod';

// 반응형 스프라이트: 키 입력에 따라 자세가 바뀌는 이미지 레이어.
// 키 요소와 달리 키 매핑에 인덱스 결합하지 않고, 담당 키를 자세마다 직접 참조한다.
// 저장 구조는 Rust ReactiveSpritePosition과 동일.
// 스키마는 두 벌이다 - canonical(서빙)은 복구·grandfather를 거친 store가
// 상한 밖 컬렉션을 서빙해도 부트스트랩이 죽지 않게 개수 상한을 강제하지 않고,
// input(플러그인 patch)은 백엔드 커밋 검증과 같은 상한을 선차단한다

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

// 생성 기본 크기. Rust ReactiveSpritePosition/SpriteRect Default와 동일
export const DEFAULT_SPRITE_SIZE = 200;

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

// imageFit 부재 시 렌더·편집 UI가 쓰는 값
export const DEFAULT_SPRITE_IMAGE_FIT: SpriteImageFit = 'contain';

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

// 백엔드 normalize_sprite_triggers와 동일한 canonical 정규형(정렬+중복 제거).
// ASCII UUID만 통과하므로 JS 사전순과 Rust 바이트순이 갈리지 않는다
export const normalizeSpriteTriggers = (
  triggers: readonly string[],
): string[] => [...new Set(triggers)].sort();

// 트리거 집합 동일성 키. 중복 검출과 자세 해석이 같은 규칙을 공유한다
export const spriteTriggerSetKey = (triggers: readonly string[]): string =>
  normalizeSpriteTriggers(triggers).join('\n');

const spritePoseBaseShape = {
  // 사용자 지정 이름. 없으면 UI가 '상태 N'으로 표시하고, 백엔드는 None이면 키를 생략한다
  name: z.string().nullish(),
  transform: spriteTransformSchema,
  imageOverride: z.string().nullable(),
};

// canonical(서빙): 키 요소 id 목록. 물리 키가 아니라 레인에 결합해서 키 매핑을
// 바꿔도 자리를 유지한다. 빈 배열·빈 문자열·상한 초과는 인입 허용 - 복구·grandfather를
// 거친 store가 서빙해도 부트스트랩이 죽지 않아야 한다 (신규 커밋은 백엔드 검증이 차단)
export const spritePoseSchema = z.object({
  poseId: z.string().min(1),
  triggers: z.array(z.string()),
  ...spritePoseBaseShape,
});
export type SpritePose = z.infer<typeof spritePoseSchema>;

// input(플러그인 patch): poseId 누락은 백엔드가 새 id를 발급하는 공개 계약이라 허용,
// 컬렉션 상한은 백엔드 커밋 검증과 같은 값으로 선차단
export const spritePoseInputSchema = z.object({
  poseId: z.string().min(1).optional(),
  triggers: z
    .array(z.string().min(1).max(SPRITE_CONSTRAINTS.triggerIdMaxLength))
    .max(SPRITE_CONSTRAINTS.maxTriggersPerPose),
  ...spritePoseBaseShape,
});
export type SpritePoseInput = z.infer<typeof spritePoseInputSchema>;

const reactiveSpritePositionBaseShape = {
  // 백엔드 발급 요소 id. 발급 전에는 키 생략만 허용 - 명시 null은 Rust String
  // decode가 거부한다. 서빙 문서는 canonical 검증이 필수화한다
  id: z.string().min(1).optional(),
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

  // Rust u32 - 소수는 decode 거부라 정수로 고정
  transitionMs: z
    .number()
    .int()
    .min(SPRITE_CONSTRAINTS.transitionMs.min)
    .max(SPRITE_CONSTRAINTS.transitionMs.max),
  transitionEasing: z.string(),
};

export const reactiveSpritePositionSchema = z.object({
  ...reactiveSpritePositionBaseShape,
  poses: z.array(spritePoseSchema),
});
export type ReactiveSpritePosition = z.infer<
  typeof reactiveSpritePositionSchema
>;

export const reactiveSpritePositionInputSchema = z.object({
  ...reactiveSpritePositionBaseShape,
  poses: z.array(spritePoseInputSchema).max(SPRITE_CONSTRAINTS.maxPoses),
});
export type ReactiveSpritePositionInput = z.infer<
  typeof reactiveSpritePositionInputSchema
>;

export type SpritePositions = Record<string, ReactiveSpritePosition[]>;
export type SpritePositionsInput = Record<
  string,
  ReactiveSpritePositionInput[]
>;

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
    const key = spriteTriggerSetKey(pose.triggers);
    if (seen.has(key)) return pose;
    seen.add(key);
  }
  return null;
};

export const spriteTransformToCss = (transform: SpriteTransform): string =>
  `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;
