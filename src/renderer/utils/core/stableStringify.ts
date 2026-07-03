// 객체 키를 재귀 정렬한 뒤 직렬화 — 키 순서만 다른 동일 내용을 같게 비교
// (백엔드 HashMap 직렬화 순서와 프론트 증분 병합 순서가 달라도 오탐 없음)
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep(record[key]);
        return acc;
      }, {});
  }
  return value;
}
