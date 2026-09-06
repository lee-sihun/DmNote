import { z } from 'zod';
import { ELEMENT_ROTATION_RANGE } from './rotation';

// 키 이미지 레이어 - 모드와 상태별 변환. 저장 구조는 Rust ImageMode/ImageTransform과 동일
export const IMAGE_TRANSFORM_CONSTRAINTS = {
  offset: { min: -500, max: 500 },
  rotation: ELEMENT_ROTATION_RANGE,
  scale: { min: 0.1, max: 10 },
} as const;

export const imageModeSchema = z.union([
  z.literal('replace'),
  z.literal('overlay'),
]);
export type ImageMode = z.infer<typeof imageModeSchema>;

export const DEFAULT_IMAGE_MODE: ImageMode = 'replace';

export const imageTransformSchema = z.object({
  offsetX: z
    .number()
    .finite()
    .min(IMAGE_TRANSFORM_CONSTRAINTS.offset.min)
    .max(IMAGE_TRANSFORM_CONSTRAINTS.offset.max),
  offsetY: z
    .number()
    .finite()
    .min(IMAGE_TRANSFORM_CONSTRAINTS.offset.min)
    .max(IMAGE_TRANSFORM_CONSTRAINTS.offset.max),
  rotation: z
    .number()
    .finite()
    .min(IMAGE_TRANSFORM_CONSTRAINTS.rotation.min)
    .max(IMAGE_TRANSFORM_CONSTRAINTS.rotation.max),
  scale: z
    .number()
    .finite()
    .min(IMAGE_TRANSFORM_CONSTRAINTS.scale.min)
    .max(IMAGE_TRANSFORM_CONSTRAINTS.scale.max),
});
export type ImageTransform = z.infer<typeof imageTransformSchema>;

export const IDENTITY_IMAGE_TRANSFORM: ImageTransform = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  scale: 1,
});

export type ImageTransformLeaf = keyof ImageTransform;

export type ImageTransformLeafPatch = {
  [L in ImageTransformLeaf]: { leaf: L; value: number };
}[ImageTransformLeaf];

const LEAF_RANGE: Record<ImageTransformLeaf, { min: number; max: number }> = {
  offsetX: IMAGE_TRANSFORM_CONSTRAINTS.offset,
  offsetY: IMAGE_TRANSFORM_CONSTRAINTS.offset,
  rotation: IMAGE_TRANSFORM_CONSTRAINTS.rotation,
  scale: IMAGE_TRANSFORM_CONSTRAINTS.scale,
};

export const isImageTransformLeafPatch = (
  value: unknown,
): value is ImageTransformLeafPatch => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2) return false;
  const leaf = record.leaf;
  if (typeof leaf !== 'string' || !(leaf in LEAF_RANGE)) return false;
  const range = LEAF_RANGE[leaf as ImageTransformLeaf];
  const num = record.value;
  return (
    typeof num === 'number' &&
    Number.isFinite(num) &&
    num >= range.min &&
    num <= range.max
  );
};

export const applyImageTransformLeaf = (
  transform: ImageTransform | undefined,
  patch: ImageTransformLeafPatch,
): ImageTransform => ({
  ...(transform ?? IDENTITY_IMAGE_TRANSFORM),
  [patch.leaf]: patch.value,
});

export const isIdentityImageTransform = (
  transform: ImageTransform | undefined,
): boolean =>
  !transform ||
  (transform.offsetX === 0 &&
    transform.offsetY === 0 &&
    transform.rotation === 0 &&
    transform.scale === 1);

export const imageTransformToCss = (transform: ImageTransform): string =>
  `translate(${transform.offsetX}px, ${transform.offsetY}px) rotate(${transform.rotation}deg) scale(${transform.scale})`;
