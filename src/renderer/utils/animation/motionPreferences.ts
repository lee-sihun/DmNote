const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

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

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(REDUCED_MOTION_QUERY).matches;

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
