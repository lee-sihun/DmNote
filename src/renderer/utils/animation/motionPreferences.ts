const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const REDUCED_MOTION_ATTRIBUTE = 'data-dmn-reduced-motion';

type MotionReductionMode = 'disabled' | 'system' | 'always';

// 전역 트리거. system은 OS 설정 존중, always는 향후 저사양 모드 강제 적용
const MOTION_PREFERENCES: { reductionMode: MotionReductionMode } = {
  reductionMode: 'disabled',
};

// '150ms' / '0.15s' 둘 다 허용
const parseDuration = (raw: string): number | null => {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return null;
  if (value.endsWith('ms')) return parsed;
  if (value.endsWith('s')) return parsed * 1000;
  return null;
};

const systemPrefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches;

export const prefersReducedMotion = (): boolean => {
  if (MOTION_PREFERENCES.reductionMode === 'always') return true;
  return (
    MOTION_PREFERENCES.reductionMode === 'system' &&
    systemPrefersReducedMotion()
  );
};

const syncReducedMotionAttribute = () => {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute(
    REDUCED_MOTION_ATTRIBUTE,
    prefersReducedMotion(),
  );
};

export const initializeMotionPreferences = () => {
  syncReducedMotionAttribute();
  if (
    MOTION_PREFERENCES.reductionMode !== 'system' ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return;
  }

  window
    .matchMedia(REDUCED_MOTION_QUERY)
    .addEventListener('change', syncReducedMotionAttribute);
};

// 지속 시간의 단일 소스는 CSS 토큰이다. 유저 커스텀 CSS가 다이얼을 늘리면
// 언마운트 타이머도 같이 늘어나야 퇴장 모션이 중간에 잘리지 않는다
export const readMotionDuration = (
  variable: string,
  fallbackMs: number,
): number => {
  if (prefersReducedMotion()) return 0;
  if (typeof window === 'undefined') return fallbackMs;
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(variable);
  return parseDuration(raw) ?? fallbackMs;
};
