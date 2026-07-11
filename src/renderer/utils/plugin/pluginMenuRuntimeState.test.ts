import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPluginMenuRuntimeState,
  getPluginMenuRuntimeState,
  normalizeStateKeys,
  pickAllowedStateKeys,
  setPluginMenuRuntimeState,
} from './pluginMenuRuntimeState';

const FULL_ID = 'test-plugin__1';

afterEach(() => {
  clearPluginMenuRuntimeState(FULL_ID);
});

describe('normalizeStateKeys', () => {
  it('비문자열·빈 문자열·중복을 제거한다', () => {
    expect(
      normalizeStateKeys([
        'active',
        '',
        '  ',
        'active',
        42 as unknown as string,
        'mode',
      ]),
    ).toEqual(['active', 'mode']);
  });

  it('undefined면 빈 배열을 반환한다', () => {
    expect(normalizeStateKeys(undefined)).toEqual([]);
  });
});

describe('pickAllowedStateKeys', () => {
  it('허용 키만 추출하고 나머지 payload 키는 거부한다', () => {
    expect(
      pickAllowedStateKeys(
        { active: true, bars: [1, 2, 3], __proto__evil: 1 },
        ['active'],
      ),
    ).toEqual({ active: true });
  });
});

describe('runtime state map', () => {
  it('허용 키만 누적 병합하고 허용 목록으로 조회한다', () => {
    setPluginMenuRuntimeState(FULL_ID, { active: true, bars: [1] }, ['active']);
    setPluginMenuRuntimeState(FULL_ID, { mode: 'mic' }, ['active', 'mode']);

    expect(getPluginMenuRuntimeState(FULL_ID, ['active', 'mode'])).toEqual({
      active: true,
      mode: 'mic',
    });
  });

  it('정의에서 빠진 과거 키는 조회 시 제외한다', () => {
    setPluginMenuRuntimeState(FULL_ID, { active: true, legacy: 1 }, [
      'active',
      'legacy',
    ]);

    expect(getPluginMenuRuntimeState(FULL_ID, ['active'])).toEqual({
      active: true,
    });
  });

  it('clear 후에는 빈 상태를 반환한다', () => {
    setPluginMenuRuntimeState(FULL_ID, { active: true }, ['active']);
    clearPluginMenuRuntimeState(FULL_ID);

    expect(getPluginMenuRuntimeState(FULL_ID, ['active'])).toEqual({});
  });

  it('허용 키가 없는 업데이트는 저장하지 않는다', () => {
    setPluginMenuRuntimeState(FULL_ID, { bars: [1, 2] }, ['active']);

    expect(getPluginMenuRuntimeState(FULL_ID, ['active'])).toEqual({});
  });
});
