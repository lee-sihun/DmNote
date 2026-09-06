/**
 * PluginElement React.memo의 전제 검증:
 * 스토어 update 경로가 미변경 요소의 객체 참조를 유지해야
 * 요소 하나의 갱신이 나머지 요소 리렌더로 번지지 않는다
 */
import { describe, it, expect } from 'vitest';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

const makeElement = (fullId: string): PluginDisplayElementInternal =>
  ({
    fullId,
    pluginId: 'test',
    width: 100,
  } as unknown as PluginDisplayElementInternal);

describe('plugin display element store identity', () => {
  it('updateElement는 미변경 요소의 참조를 유지한다', () => {
    const a = makeElement('plugin:a');
    const b = makeElement('plugin:b');
    const c = makeElement('plugin:c');
    usePluginDisplayElementStore.setState({ elements: [a, b, c] });

    usePluginDisplayElementStore
      .getState()
      .updateElement('plugin:a', { width: 120 });

    const elements = usePluginDisplayElementStore.getState().elements;
    expect(elements.find((el) => el.fullId === 'plugin:a')).not.toBe(a);
    expect(elements.find((el) => el.fullId === 'plugin:b')).toBe(b);
    expect(elements.find((el) => el.fullId === 'plugin:c')).toBe(c);
  });
});
