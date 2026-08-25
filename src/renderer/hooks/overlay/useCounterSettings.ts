import { getDefaults } from '@src/renderer/defaults';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/key/keys';
import type { KeyCounterSettings } from '@src/types/key/keys';

export {
  computeOutsideStyle,
  OUTSIDE_OFFSET,
} from '@utils/counter/counterPositioning';

// 정규화 결과 캐시 — 오버레이 핫패스에서 렌더마다 zod 파싱을 반복하지 않도록
// position.counter 객체 identity 기준으로 재사용한다.
// 정규화 fallback이 getDefaults()에 의존하므로 defaults 스냅샷이 바뀌면 전체 폐기
const UNINITIALIZED = Symbol('counter-settings-cache');
let cacheOwner: unknown = UNINITIALIZED;
let normalizedCache = new WeakMap<object, KeyCounterSettings>();
let defaultSettings: KeyCounterSettings | null = null;

const syncCacheOwner = (): void => {
  const owner = getDefaults();
  if (owner === cacheOwner) return;
  cacheOwner = owner;
  normalizedCache = new WeakMap();
  defaultSettings = null;
};

/**
 * Normalizes a raw counter config into a full `KeyCounterSettings` object.
 * Returns the default settings when the input is falsy.
 * 같은 입력 객체에는 같은 결과 객체를 돌려주므로 반환값을 변형하지 말 것.
 * 훅이 아님 — 콜백·조건문 안에서는 이 이름으로 호출
 */
export function resolveCounterSettings(
  counter: unknown | undefined,
): KeyCounterSettings {
  syncCacheOwner();

  if (counter && typeof counter === 'object') {
    let settings = normalizedCache.get(counter);
    if (!settings) {
      settings = normalizeCounterSettings(counter);
      normalizedCache.set(counter, settings);
    }
    return settings;
  }
  if (counter) {
    // 원시값 — zod가 거부해 기본값으로 정규화됨
    return normalizeCounterSettings(counter);
  }
  // 기존 Key 호출부와 동일하게 기본값도 정규화 형태(gradient null 포함)로 유지
  defaultSettings ??= normalizeCounterSettings(createDefaultCounterSettings());
  return defaultSettings;
}

// 컴포넌트 본문 최상위용 별칭 (기존 호출부 호환)
export function useCounterSettings(
  counter: unknown | undefined,
): KeyCounterSettings {
  return resolveCounterSettings(counter);
}
