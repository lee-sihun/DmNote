import { describe, expect, it, vi } from 'vitest';
import type { PluginSettingSchema } from '@src/types/plugin/api';
import {
  coerceSettingValue,
  getDefaultSettings,
  normalizeSettingsSections,
  omitLayoutSettingValues,
  safeEvaluateVisibility,
  type PluginValueSettingSchema,
} from './settingsSections';

const value = (label: string): PluginSettingSchema => ({
  type: 'string',
  default: '',
  label,
});

describe('normalizeSettingsSections', () => {
  it('section이 없으면 암시적 카드 하나를 만든다', () => {
    const sections = normalizeSettingsSections({ name: value('Name') }, {});

    expect(sections).toMatchObject([
      { key: null, markerVisible: true, renderVisible: true },
    ]);
  });

  it('선두, 연속, 말미의 빈 section을 만들지 않는다', () => {
    const sections = normalizeSettingsSections(
      {
        first: { type: 'section', label: 'First' },
        second: { type: 'section', label: 'Second' },
        name: value('Name'),
        trailing: { type: 'section', label: 'Trailing' },
      },
      {},
    );

    expect(sections.map(({ key }) => key)).toEqual(['second']);
  });

  it('숨긴 section의 경계를 유지하면서 그룹 전체를 숨긴다', () => {
    const sections = normalizeSettingsSections(
      {
        before: value('Before'),
        hidden: { type: 'section', visible: false },
        middle: value('Middle'),
        after: { type: 'section' },
        end: value('End'),
      },
      {},
    );

    expect(
      sections.map(({ key, renderVisible }) => ({ key, renderVisible })),
    ).toEqual([
      { key: null, renderVisible: true },
      { key: 'hidden', renderVisible: false },
      { key: 'after', renderVisible: true },
    ]);
  });

  it('내부 값이 모두 숨겨지면 카드를 숨긴다', () => {
    const sections = normalizeSettingsSections(
      {
        hiddenValues: { type: 'section', label: 'Hidden' },
        name: { ...value('Name'), visible: false },
      },
      {},
    );

    expect(sections[0].renderVisible).toBe(false);
    expect(sections[0].entries.every((entry) => !entry.renderVisible)).toBe(
      true,
    );
  });

  it('제거된 divider 타입은 미지원으로 제외되고 진단을 보고한다', () => {
    const onError = vi.fn();
    const schema = {
      first: { type: 'string', default: '', label: 'First' },
      legacyDivider: { type: 'divider' },
      second: { type: 'string', default: '', label: 'Second' },
    } as unknown as Record<string, PluginSettingSchema>;

    const sections = normalizeSettingsSections(schema, {}, onError);

    expect(sections[0].entries.map(({ key }) => key)).toEqual([
      'first',
      'second',
    ]);
    expect(onError).toHaveBeenCalledWith(
      'legacyDivider',
      expect.objectContaining({ message: 'Unsupported setting type: divider' }),
      'unsupported-type',
    );
  });

  it('visibility 예외를 fail-closed 처리한다', () => {
    const onError = vi.fn();
    const sections = normalizeSettingsSections(
      {
        broken: {
          ...value('Broken'),
          visible: () => {
            throw new Error('boom');
          },
        },
      },
      {},
      onError,
    );

    expect(sections[0].renderVisible).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      'broken',
      expect.any(Error),
      'visibility',
    );
  });

  it('section visibility 예외 시 그룹 경계를 유지하고 그룹을 숨긴다', () => {
    const onError = vi.fn();
    const sections = normalizeSettingsSections(
      {
        brokenSection: {
          type: 'section',
          label: 'Broken',
          visible: () => {
            throw new Error('boom');
          },
        },
        value: value('Value'),
      },
      {},
      onError,
    );

    expect(sections).toMatchObject([
      { key: 'brokenSection', markerVisible: false, renderVisible: false },
    ]);
    expect(onError).toHaveBeenCalledWith(
      'brokenSection',
      expect.any(Error),
      'visibility',
    );
  });

  it('미지원 타입만 있으면 렌더 가능한 section을 만들지 않는다', () => {
    const onError = vi.fn();
    const schema = {
      unsupported: { type: 'range', default: 1, label: 'Range' },
    } as unknown as Record<string, PluginSettingSchema>;

    expect(normalizeSettingsSections(schema, {}, onError)).toEqual([]);
    expect(onError).toHaveBeenCalledWith(
      'unsupported',
      expect.objectContaining({ message: 'Unsupported setting type: range' }),
      'unsupported-type',
    );
  });

  it('section label을 정규화 결과에 보존한다', () => {
    const sections = normalizeSettingsSections(
      {
        appearance: { type: 'section', label: 'Appearance' },
        first: value('First'),
        second: value('Second'),
      },
      {},
    );

    expect(sections[0].label).toBe('Appearance');
    expect(sections[0].entries.map(({ key }) => key)).toEqual([
      'first',
      'second',
    ]);
  });
});

describe('getDefaultSettings', () => {
  it('value setting만 반환하고 section과 레거시 divider는 제외한다', () => {
    const schema = {
      section: { type: 'section', label: 'Group' },
      enabled: { type: 'boolean', default: true, label: 'Enabled' },
      legacyDivider: { type: 'divider', label: 'More' },
      count: { type: 'number', default: 3, label: 'Count' },
    } as unknown as Record<string, PluginSettingSchema>;

    expect(getDefaultSettings(schema)).toEqual({ enabled: true, count: 3 });
  });
});

describe('omitLayoutSettingValues', () => {
  it('저장값에서 section과 레거시 divider 키를 제거한다', () => {
    const schema = {
      section: { type: 'section' },
      value: { type: 'number', default: 1, label: 'Value' },
      legacyDivider: { type: 'divider' },
    } as unknown as Record<string, PluginSettingSchema>;

    expect(
      omitLayoutSettingValues(schema, {
        section: 'legacy',
        value: 2,
        legacyDivider: true,
        external: 'kept',
      }),
    ).toEqual({ value: 2, external: 'kept' });
  });
});

describe('coerceSettingValue', () => {
  const numberSchema: PluginValueSettingSchema = {
    type: 'number',
    default: 5,
    label: 'Count',
    min: 0,
    max: 100,
  };

  it('number 문자열을 숫자로 복원하고 명시된 min/max로 클램프한다', () => {
    expect(coerceSettingValue(numberSchema, '42')).toBe(42);
    expect(coerceSettingValue(numberSchema, '-5')).toBe(0);
    expect(coerceSettingValue(numberSchema, '150')).toBe(100);
    expect(coerceSettingValue(numberSchema, 7)).toBe(7);
  });

  it('복원 불가한 number 입력은 null을 반환한다 (커밋 스킵)', () => {
    expect(coerceSettingValue(numberSchema, '')).toBeNull();
    expect(coerceSettingValue(numberSchema, '  ')).toBeNull();
    expect(coerceSettingValue(numberSchema, '12abc')).toBeNull();
    expect(coerceSettingValue(numberSchema, 'Infinity')).toBeNull();
  });

  it('min/max 미지정 number는 클램프하지 않는다', () => {
    const unbounded: PluginValueSettingSchema = {
      type: 'number',
      default: 0,
      label: 'Free',
    };
    expect(coerceSettingValue(unbounded, '-9999')).toBe(-9999);
  });

  it('select 문자열을 원본 옵션 타입으로 역매핑한다', () => {
    const select: PluginValueSettingSchema = {
      type: 'select',
      default: 3,
      label: 'Mode',
      options: [
        { label: 'Three', value: 3 },
        { label: 'On', value: true },
        { label: 'Raw', value: 'raw' },
      ],
    };

    expect(coerceSettingValue(select, '3')).toBe(3);
    expect(coerceSettingValue(select, 'true')).toBe(true);
    expect(coerceSettingValue(select, 'raw')).toBe('raw');
    // 매칭 없으면 raw 그대로 — 패널 optionMap.get(...) ?? nextValue와 동일
    expect(coerceSettingValue(select, 'unknown')).toBe('unknown');
  });

  it('select 문자열 표현이 겹치면 마지막 옵션을 선택한다 (패널 Map 규칙)', () => {
    const select: PluginValueSettingSchema = {
      type: 'select',
      default: 'true',
      label: 'Dup',
      options: [
        { label: 'Bool', value: true },
        { label: 'String', value: 'true' },
      ],
    };

    expect(coerceSettingValue(select, 'true')).toBe('true');
  });

  it('boolean/color/string은 그대로 통과시킨다', () => {
    expect(
      coerceSettingValue(
        { type: 'boolean', default: false, label: 'On' },
        true,
      ),
    ).toBe(true);
    expect(
      coerceSettingValue(
        { type: 'color', default: '#fff', label: 'Tint' },
        '#8B5CF6',
      ),
    ).toBe('#8B5CF6');
    expect(
      coerceSettingValue(
        { type: 'string', default: '', label: 'Name' },
        'hello',
      ),
    ).toBe('hello');
  });
});

describe('safeEvaluateVisibility', () => {
  it('예외를 로깅하고 false를 반환한다', () => {
    const onError = vi.fn();

    expect(
      safeEvaluateVisibility(
        () => {
          throw new Error('boom');
        },
        {},
        onError,
      ),
    ).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it.each([
    { visible: 1, expected: true },
    { visible: '', expected: false },
    { visible: 'false', expected: true },
  ])(
    'visible=$visible 값을 JS truthiness로 변환한다',
    ({ visible, expected }) => {
      expect(safeEvaluateVisibility(visible as unknown as boolean, {})).toBe(
        expected,
      );
    },
  );
});
