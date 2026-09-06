import { describe, expect, it } from 'vitest';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  pluginLayoutElementsEqual,
  selectPluginLayoutElements,
} from './pluginLayoutElements';

const makeElement = (
  overrides: Partial<PluginDisplayElementInternal> = {},
): PluginDisplayElementInternal => ({
  id: 'el',
  fullId: 'plugin:el',
  pluginId: 'plugin',
  html: '<div>tick: 0</div>',
  position: { x: 10, y: 20 },
  tabId: '4key',
  state: { count: 0 },
  settings: { color: 'red' },
  zIndex: 1,
  ...overrides,
});

const project = (elements: PluginDisplayElementInternal[]) =>
  selectPluginLayoutElements({ elements });

const equalAfter = (
  before: PluginDisplayElementInternal[],
  after: PluginDisplayElementInternal[],
) => pluginLayoutElementsEqual(project(before), project(after));

describe('pluginLayoutElementsEqual', () => {
  it('레이아웃 무관 필드(state/html/settings/zIndex)만 바뀌면 equal', () => {
    const before = [makeElement()];
    expect(
      equalAfter(before, [
        makeElement({
          state: { count: 99 },
          html: '<div>tick: 99</div>',
          settings: { color: 'blue' },
          zIndex: 5,
        }),
      ]),
    ).toBe(true);
  });

  it('배열 길이 변화는 not equal', () => {
    const before = [makeElement()];
    expect(equalAfter(before, [])).toBe(false);
    expect(
      equalAfter(before, [makeElement(), makeElement({ fullId: 'p:2' })]),
    ).toBe(false);
  });

  it.each([
    ['hidden', { hidden: true }],
    ['tabId', { tabId: '5key' }],
    ['position.x', { position: { x: 11, y: 20 } }],
    ['position.y', { position: { x: 10, y: 21 } }],
    ['measuredSize', { measuredSize: { width: 100, height: 50 } }],
    ['estimatedSize', { estimatedSize: { width: 200, height: 150 } }],
  ] as const)('%s 변경은 not equal', (_label, overrides) => {
    expect(equalAfter([makeElement()], [makeElement(overrides)])).toBe(false);
  });

  it('measuredSize 값 변경은 not equal', () => {
    const before = [makeElement({ measuredSize: { width: 100, height: 50 } })];
    expect(
      equalAfter(before, [
        makeElement({ measuredSize: { width: 100, height: 60 } }),
      ]),
    ).toBe(false);
  });

  // 앵커 비교를 놓치면 computeLayout의 앵커 좌표 계산이 갱신되지 않아 bounds 고착
  describe('anchor 비교', () => {
    const anchored = (anchor: PluginDisplayElementInternal['anchor']) => [
      makeElement({ anchor }),
    ];

    it('anchor 생성·제거(undefined ↔ 객체)는 not equal', () => {
      expect(
        equalAfter(anchored(undefined), anchored({ keyCode: 'KeyK' })),
      ).toBe(false);
      expect(
        equalAfter(anchored({ keyCode: 'KeyK' }), anchored(undefined)),
      ).toBe(false);
    });

    it('anchor.keyCode 변경은 not equal', () => {
      expect(
        equalAfter(
          anchored({ keyCode: 'KeyK' }),
          anchored({ keyCode: 'KeyJ' }),
        ),
      ).toBe(false);
    });

    it('anchor.offset.x/y 변경은 not equal', () => {
      expect(
        equalAfter(
          anchored({ keyCode: 'KeyK', offset: { x: 1, y: 2 } }),
          anchored({ keyCode: 'KeyK', offset: { x: 3, y: 2 } }),
        ),
      ).toBe(false);
      expect(
        equalAfter(
          anchored({ keyCode: 'KeyK', offset: { x: 1, y: 2 } }),
          anchored({ keyCode: 'KeyK', offset: { x: 1, y: 4 } }),
        ),
      ).toBe(false);
    });

    it('anchor.offset 생성·제거(undefined ↔ 객체)는 not equal', () => {
      expect(
        equalAfter(
          anchored({ keyCode: 'KeyK' }),
          anchored({ keyCode: 'KeyK', offset: { x: 0, y: 0 } }),
        ),
      ).toBe(false);
      expect(
        equalAfter(
          anchored({ keyCode: 'KeyK', offset: { x: 0, y: 0 } }),
          anchored({ keyCode: 'KeyK' }),
        ),
      ).toBe(false);
    });

    it('동일 anchor 값이면 equal', () => {
      expect(
        equalAfter(
          anchored({ keyCode: 'KeyK', offset: { x: 1, y: 2 } }),
          anchored({ keyCode: 'KeyK', offset: { x: 1, y: 2 } }),
        ),
      ).toBe(true);
    });
  });

  it('투영은 배열 길이·순서를 보존한다 (filter 금지 - hasContent 판정)', () => {
    const hiddenFirst = [
      makeElement({ hidden: true }),
      makeElement({ fullId: 'p:2', hidden: false }),
    ];
    const projected = project(hiddenFirst);
    expect(projected).toHaveLength(2);
    expect(projected[0].hidden).toBe(true);
    expect(projected[1].hidden).toBe(false);
  });

  it('position 없는 요소(anchor 배치 등)도 크래시 없이 비교한다', () => {
    const noPosition = () => [
      makeElement({
        position: undefined as unknown as { x: number; y: number },
        hidden: true,
      }),
    ];
    // 정규화된 (0,0) 기준으로 equal 판정
    expect(equalAfter(noPosition(), noPosition())).toBe(true);
    // position 생성은 not equal (0,0 → 실제 좌표)
    expect(
      equalAfter(noPosition(), [
        makeElement({ position: { x: 10, y: 20 }, hidden: true }),
      ]),
    ).toBe(false);
  });
});
