import type {
  CounterAnimationBezier,
  KeyCounterAnimationSettings,
} from '@src/types/key/keys';

export type CounterAnimationSource = 'builtin' | 'user';

export interface CounterAnimationPreset {
  id: string;
  name: string;
  source: CounterAnimationSource;
  labelKey?: string;
  bezier: CounterAnimationBezier;
  scale: number;
  durationMs: number;
}

export interface CounterAnimationListResponse {
  builtinPresets: CounterAnimationPreset[];
  userPresets: CounterAnimationPreset[];
}

export interface CounterAnimationCreateRequest {
  name: string;
  bezier: CounterAnimationBezier;
  scale: number;
  durationMs: number;
}

export interface CounterAnimationUpdateRequest {
  id: string;
  name: string;
  bezier: CounterAnimationBezier;
  scale: number;
  durationMs: number;
}

export interface CounterAnimationUpsertResponse {
  preset: CounterAnimationPreset;
  affectedUsageCount: number;
}

export interface CounterAnimationDeleteResponse {
  success: boolean;
  id: string;
  affectedUsageCount: number;
  fallbackPresetId: string;
}

import { getDefaultCounterAnimationPresetId } from '@src/renderer/defaults';

/** @deprecated Use getDefaultCounterAnimationPresetId() from @src/renderer/defaults */
export const DEFAULT_COUNTER_ANIMATION_PRESET_ID =
  getDefaultCounterAnimationPresetId();

export function clampCounterAnimationBezier(
  bezier: CounterAnimationBezier | number[],
): CounterAnimationBezier {
  return [
    Math.min(Math.max(Number(bezier?.[0] ?? 0.25), 0), 1),
    Math.min(Math.max(Number(bezier?.[1] ?? 0.46), -2), 2),
    Math.min(Math.max(Number(bezier?.[2] ?? 0.45), 0), 1),
    Math.min(Math.max(Number(bezier?.[3] ?? 0.94), -2), 2),
  ];
}

export function clampCounterAnimationDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 300;
  return Math.min(Math.max(Math.round(durationMs), 1), 5000);
}

export function normalizeCounterAnimationPreset(
  preset: CounterAnimationPreset,
): CounterAnimationPreset {
  const source: CounterAnimationSource =
    preset.source === 'user' ? 'user' : 'builtin';
  return {
    id: String(preset.id || '').trim(),
    name: String(preset.name || '').trim(),
    source,
    labelKey: preset.labelKey ? String(preset.labelKey) : undefined,
    bezier: clampCounterAnimationBezier(preset.bezier),
    scale: Number.isFinite(preset.scale) ? preset.scale : 1.1,
    durationMs: clampCounterAnimationDuration(preset.durationMs),
  };
}

export function normalizeCounterAnimationLibrary(
  response: CounterAnimationListResponse,
): CounterAnimationListResponse {
  const builtinPresets = Array.isArray(response.builtinPresets)
    ? response.builtinPresets.map(normalizeCounterAnimationPreset)
    : [];
  const userPresets = Array.isArray(response.userPresets)
    ? response.userPresets
        .map(normalizeCounterAnimationPreset)
        .filter((preset) => preset.source === 'user')
    : [];

  return { builtinPresets, userPresets };
}

export function resolveAnimationPresetById(
  presetId: string | null | undefined,
  library: CounterAnimationListResponse,
): CounterAnimationPreset | null {
  if (!presetId) return null;
  const normalizedId = presetId.trim();
  if (!normalizedId) return null;

  const all = [...library.builtinPresets, ...library.userPresets];
  return all.find((preset) => preset.id === normalizedId) || null;
}

function isBezierEqual(
  a: CounterAnimationBezier,
  b: CounterAnimationBezier,
): boolean {
  const EPSILON = 0.001;
  return a.every(
    (value, index) =>
      Math.abs(Number(value) - Number(b[index as 0 | 1 | 2 | 3])) <= EPSILON,
  );
}

export function findMatchingPresetId(
  animation: KeyCounterAnimationSettings,
  library: CounterAnimationListResponse,
): string | null {
  const directId =
    typeof animation.presetId === 'string' ? animation.presetId.trim() : '';
  if (directId) {
    const direct = resolveAnimationPresetById(directId, library);
    if (direct) return direct.id;
  }

  const all = [...library.builtinPresets, ...library.userPresets];
  const normalizedBezier = clampCounterAnimationBezier(animation.bezier);
  const normalizedDuration = clampCounterAnimationDuration(
    animation.durationMs,
  );
  const normalizedScale = Number.isFinite(animation.scale)
    ? animation.scale
    : 1.1;

  const matched = all.find((preset) => {
    const scaleDiff = Math.abs(preset.scale - normalizedScale);
    return (
      isBezierEqual(preset.bezier, normalizedBezier) &&
      scaleDiff <= 0.001 &&
      preset.durationMs === normalizedDuration
    );
  });

  return matched?.id || null;
}

export function applyPresetToAnimation(
  animation: KeyCounterAnimationSettings,
  preset: CounterAnimationPreset,
): KeyCounterAnimationSettings {
  return {
    ...animation,
    presetId: preset.id,
    bezier: [...preset.bezier] as CounterAnimationBezier,
    scale: preset.scale,
    durationMs: preset.durationMs,
  };
}

// 배치 모션 적용용 intent mask: 피커가 소유한 preset 필드만 쓰고 각 요소의
// enabled는 보존한다. 배치 기준값은 첫 요소라 델타 비교는 혼합 상태를
// 오판한다 (같은 preset 재선택으로 혼합 통일하려는 동작이 무변경으로 보임)
export function applyAnimationIntentMask(
  current: KeyCounterAnimationSettings,
  next: KeyCounterAnimationSettings,
): KeyCounterAnimationSettings {
  return {
    enabled: current.enabled,
    presetId: next.presetId,
    bezier: next.bezier,
    scale: next.scale,
    durationMs: next.durationMs,
  };
}

// 비동기 완료 병합용. 시작 스냅샷(start) 대비 실제로 바뀐 필드만 base(fresh)
// 위에 적용해, 대기 중 다른 writer가 바꾼 필드(enabled 등)를 시작 값으로
// 되돌리지 않는다. 필드가 늘면 여기 병합도 함께 늘려야 컴파일된다.
// 변경 감지는 정확 비교다 - preset 매칭용 epsilon(isBezierEqual)을 쓰면
// 드래그의 미세 변경이 무변경으로 오판된다
export function mergeChangedAnimationFields(
  base: KeyCounterAnimationSettings,
  start: KeyCounterAnimationSettings,
  next: KeyCounterAnimationSettings,
): KeyCounterAnimationSettings {
  const bezierUnchanged = next.bezier.every(
    (value, index) => value === start.bezier[index as 0 | 1 | 2 | 3],
  );
  return {
    enabled: next.enabled === start.enabled ? base.enabled : next.enabled,
    presetId: next.presetId === start.presetId ? base.presetId : next.presetId,
    bezier: bezierUnchanged ? base.bezier : next.bezier,
    scale: next.scale === start.scale ? base.scale : next.scale,
    durationMs:
      next.durationMs === start.durationMs ? base.durationMs : next.durationMs,
  };
}
