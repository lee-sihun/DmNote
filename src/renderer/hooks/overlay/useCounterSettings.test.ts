import { describe, expect, it } from 'vitest';
import { useCounterSettings } from './useCounterSettings';
import { initDefaults } from '@src/renderer/defaults';
import {
  createDefaultCounterSettings,
  normalizeCounterSettings,
} from '@src/types/key/keys';
import type { DefaultsPayload } from '@src/renderer/defaults';

const rawCounter = () => ({
  enabled: true,
  placement: 'outside',
  align: 'top',
  fill: { idle: '#111111', active: '#222222' },
  gap: 8,
  fontSize: 20,
  animation: { enabled: true, durationMs: 450, scale: 1.3 },
});

describe('useCounterSettings 캐시', () => {
  it('같은 counter 객체에는 같은 정규화 결과를 재사용한다', () => {
    const counter = rawCounter();
    const first = useCounterSettings(counter);
    const second = useCounterSettings(counter);

    expect(second).toBe(first);
    expect(first).toEqual(normalizeCounterSettings(counter));
  });

  it('다른 identity의 동일 내용 객체는 별도로 정규화한다', () => {
    const first = useCounterSettings(rawCounter());
    const second = useCounterSettings(rawCounter());

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('falsy 입력은 캐시된 기본값을 돌려주며 정규화 결과와 동일하다', () => {
    const first = useCounterSettings(undefined);
    const second = useCounterSettings(null);

    expect(second).toBe(first);
    // 기존 Key 호출부(normalize(default))와 결과가 같아야 동작이 보존됨
    expect(first).toEqual(
      normalizeCounterSettings(createDefaultCounterSettings()),
    );
  });

  it('원시값은 캐시 없이 기본값으로 정규화된다', () => {
    const settings = useCounterSettings('bogus');

    expect(settings).toEqual(createDefaultCounterSettings());
    expect(settings).not.toBe(useCounterSettings(undefined));
  });

  it('defaults 스냅샷이 바뀌면 캐시를 폐기한다', () => {
    const counter = { enabled: true, placement: 'inside' };
    const before = useCounterSettings(counter);
    const beforeDefault = useCounterSettings(undefined);
    expect(before.fontSize).toBe(createDefaultCounterSettings().fontSize);

    const nextDefaults: DefaultsPayload = {
      settings: {} as DefaultsPayload['settings'],
      counterSettings: { ...createDefaultCounterSettings(), fontSize: 33 },
    };
    initDefaults(nextDefaults);

    const after = useCounterSettings(counter);
    const afterDefault = useCounterSettings(undefined);
    expect(after).not.toBe(before);
    expect(after.fontSize).toBe(33);
    expect(afterDefault).not.toBe(beforeDefault);
    expect(afterDefault.fontSize).toBe(33);
    // 같은 스냅샷이 유지되는 동안은 다시 재사용
    expect(useCounterSettings(counter)).toBe(after);
  });
});
