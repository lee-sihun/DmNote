// 컨텍스트 메뉴 predicate용 오버레이 런타임 상태 미러 (메인 윈도우 전용)
// element.state(previewState 기반)와 분리 저장 — history/undo, 저장,
// main→overlay 역동기화에 섞이지 않도록 스토어 밖 모듈 맵으로 관리.
// 메뉴는 열릴 때 평가되므로 리액티브 구독이 필요 없음

const menuRuntimeState = new Map<string, Record<string, unknown>>();

// 선언 키 정규화 — 비문자열·빈 문자열·중복 제거
export const normalizeStateKeys = (keys: string[] | undefined): string[] => {
  if (!Array.isArray(keys)) return [];
  return [
    ...new Set(
      keys.filter(
        (key): key is string => typeof key === 'string' && key.trim() !== '',
      ),
    ),
  ];
};

// 허용 키만 추출 — 송신·수신 양쪽에서 사용 (수신자는 payload를 신뢰하지 않음)
export const pickAllowedStateKeys = (
  state: Record<string, unknown>,
  allowedKeys: string[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(state, key)) {
      picked[key] = state[key];
    }
  }
  return picked;
};

export const setPluginMenuRuntimeState = (
  fullId: string,
  partial: Record<string, unknown>,
  allowedKeys: string[],
): void => {
  const picked = pickAllowedStateKeys(partial, allowedKeys);
  if (Object.keys(picked).length === 0) return;
  menuRuntimeState.set(fullId, {
    ...(menuRuntimeState.get(fullId) ?? {}),
    ...picked,
  });
};

export const getPluginMenuRuntimeState = (
  fullId: string,
  allowedKeys: string[],
): Record<string, unknown> => {
  const stored = menuRuntimeState.get(fullId);
  if (!stored) return {};
  // 정의가 바뀌어 허용 목록에서 빠진 과거 키는 제외
  return pickAllowedStateKeys(stored, allowedKeys);
};

export const clearPluginMenuRuntimeState = (fullId: string): void => {
  menuRuntimeState.delete(fullId);
};
