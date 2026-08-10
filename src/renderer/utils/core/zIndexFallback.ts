// zIndex 폴백만 채운 사본. 같은 원본과 같은 index면 같은 객체를 돌려준다
const cache = new WeakMap<object, { index: number; result: unknown }>();

// zIndex가 이미 있으면 원본을 그대로 돌려준다. 무조건 펼치면 새 객체가 되어
// 아래 키 컴포넌트의 memo가 항상 깨지고 키 하나 변경에 전부 다시 그려진다.
// 백엔드가 미설정 zIndex를 null로 직렬화하므로 결측 판정은 undefined만이 아니라 null까지 본다
export const resolveZIndexFallback = <T extends { zIndex?: number }>(
  base: T,
  index: number,
): T => {
  if (base.zIndex != null) return base;
  const cached = cache.get(base);
  if (cached && cached.index === index) return cached.result as T;
  const filled = { ...base, zIndex: index };
  cache.set(base, { index, result: filled });
  return filled;
};
