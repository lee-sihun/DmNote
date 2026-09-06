import { describe, expect, it, vi } from 'vitest';
import type { PluginMenuItem } from '@src/types/plugin/api';
import { evaluatePluginMenuItems } from './pluginElementContextMenu';

type Ctx = { flag: boolean };

const item = (
  label: string,
  overrides: Partial<PluginMenuItem<Ctx>> = {},
): PluginMenuItem<Ctx> => ({
  id: label,
  label,
  onClick: () => {},
  ...overrides,
});

const identity = (label: string) => label;

describe('evaluatePluginMenuItems', () => {
  it('position=top은 top, 미지정과 bottom은 bottom으로 분류하고 상대 순서를 보존한다', () => {
    const { top, bottom } = evaluatePluginMenuItems(
      [
        item('a', { position: 'top' }),
        item('b'),
        item('c', { position: 'bottom' }),
        item('d', { position: 'top' }),
      ],
      { flag: true },
      identity,
    );

    expect(top.map(({ label }) => label)).toEqual(['a', 'd']);
    expect(bottom.map(({ label }) => label)).toEqual(['b', 'c']);
  });

  it('visible 필터 후에도 원본 index 기반 id를 유지한다', () => {
    const { bottom } = evaluatePluginMenuItems(
      [item('hidden', { visible: false }), item('shown')],
      { flag: true },
      identity,
    );

    expect(bottom).toEqual([
      { id: 'custom-1', label: 'shown', disabled: false },
    ]);
  });

  it('boolean·함수 visible과 disabled를 컨텍스트로 평가한다', () => {
    const { bottom } = evaluatePluginMenuItems(
      [
        item('byFlag', { visible: (ctx) => ctx.flag }),
        item('hiddenByFlag', { visible: (ctx) => !ctx.flag }),
        item('disabledByFlag', { disabled: (ctx) => ctx.flag }),
        item('staticDisabled', { disabled: true }),
      ],
      { flag: true },
      identity,
    );

    expect(bottom.map(({ label, disabled }) => ({ label, disabled }))).toEqual([
      { label: 'byFlag', disabled: false },
      { label: 'disabledByFlag', disabled: true },
      { label: 'staticDisabled', disabled: true },
    ]);
  });

  it('predicate 예외를 fail-closed 처리하고 보고한다', () => {
    const onError = vi.fn();
    const { bottom } = evaluatePluginMenuItems(
      [
        item('brokenVisible', {
          visible: () => {
            throw new Error('visible boom');
          },
        }),
        item('brokenDisabled', {
          disabled: () => {
            throw new Error('disabled boom');
          },
        }),
      ],
      { flag: true },
      identity,
      onError,
    );

    // visible 예외 → 항목 숨김, disabled 예외 → 클릭 불가
    expect(bottom).toEqual([
      { id: 'custom-1', label: 'brokenDisabled', disabled: true },
    ]);
    expect(onError).toHaveBeenCalledWith(0, 'visible', expect.any(Error));
    expect(onError).toHaveBeenCalledWith(1, 'disabled', expect.any(Error));
  });

  it('label을 번역 함수로 변환한다', () => {
    const { bottom } = evaluatePluginMenuItems(
      [item('menu.clear')],
      { flag: true },
      (label) => `translated:${label}`,
    );

    expect(bottom[0].label).toBe('translated:menu.clear');
  });

  it('items가 undefined면 빈 결과를 반환한다', () => {
    expect(
      evaluatePluginMenuItems(undefined, { flag: true }, identity),
    ).toEqual({ top: [], bottom: [] });
  });
});
