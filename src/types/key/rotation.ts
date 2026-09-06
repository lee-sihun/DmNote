import { z } from 'zod';

// 요소 회전 각도 계약. 요소 회전·스프라이트 자세·키 이미지 레이어가 같은 범위를 쓴다.
// Rust ELEMENT_ROTATION_MIN/MAX와 동일 (도 단위, 양수 시계방향)
export const ELEMENT_ROTATION_RANGE = Object.freeze({ min: -180, max: 180 });

export const elementRotationSchema = z
  .number()
  .finite()
  .min(ELEMENT_ROTATION_RANGE.min)
  .max(ELEMENT_ROTATION_RANGE.max);

export const DEFAULT_ELEMENT_ROTATION = 0;

export const isElementRotationValue = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= ELEMENT_ROTATION_RANGE.min &&
  value <= ELEMENT_ROTATION_RANGE.max;
