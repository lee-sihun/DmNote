// 빌트인 키 모드 (탭) 식별자 — 여러 곳에 인라인돼 있던 것을 단일 상수로
export const BUILTIN_KEY_MODES = ['4key', '5key', '6key', '8key'] as const;

export type BuiltinKeyMode = (typeof BUILTIN_KEY_MODES)[number];

// 빌트인 + 커스텀 탭 id로 유효 탭 집합 구성
export function buildValidTabIdSet(customTabIds: string[]): Set<string> {
  return new Set<string>([...BUILTIN_KEY_MODES, ...customTabIds]);
}
