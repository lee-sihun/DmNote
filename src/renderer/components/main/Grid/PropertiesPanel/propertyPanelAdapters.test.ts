import { describe, expect, it } from 'vitest';
import { TABS } from './types';
import {
  geometryAxisPatch,
  getFontFamilyPatch,
  getFontStylePatch,
  getGraphRuntimePropertyPatch,
  getKnobRuntimePropertyPatch,
  getNotePropertyPatch,
  getStatTypeLabel,
  getUseInlineStylesPatch,
  shouldNormalizePropertyTabToStyle,
} from './propertyPanelAdapters';

describe('property panel adapters', () => {
  it('통계 유형과 기하 축을 UI 표현으로 변환한다', () => {
    expect(getStatTypeLabel('kpsAvg')).toBe('AVG');
    expect(getStatTypeLabel('kpsMax')).toBe('MAX');
    expect(getStatTypeLabel('total')).toBe('Total');
    expect(getStatTypeLabel(null)).toBe('KPS');
    expect(geometryAxisPatch('dx', 12)).toEqual({ dx: 12 });
    expect(geometryAxisPatch('height', 48)).toEqual({ height: 48 });
  });

  it('선택 구성에 맞지 않는 탭만 스타일 탭으로 정규화한다', () => {
    expect(
      shouldNormalizePropertyTabToStyle([{ type: 'stat' }], TABS.NOTE),
    ).toBe(true);
    expect(
      shouldNormalizePropertyTabToStyle([{ type: 'graph' }], TABS.COUNTER),
    ).toBe(true);
    expect(
      shouldNormalizePropertyTabToStyle([{ type: 'key' }], TABS.NOTE),
    ).toBe(false);
    expect(
      shouldNormalizePropertyTabToStyle([{ type: 'graph' }], TABS.STYLE),
    ).toBe(false);
  });

  it('graph와 knob 런타임 패치를 단일 허용 필드로 제한한다', () => {
    expect(getGraphRuntimePropertyPatch({ showAvgLine: true })).toEqual({
      property: 'showAvgLine',
      value: true,
    });
    expect(getGraphRuntimePropertyPatch({ graphSpeed: 120 })).toEqual({
      property: 'graphSpeed',
      value: 120,
    });
    expect(getGraphRuntimePropertyPatch({ graphSpeed: -1 })).toBeNull();
    expect(
      getGraphRuntimePropertyPatch({ showAvgLine: true, graphSpeed: 1 }),
    ).toBeNull();
    expect(getKnobRuntimePropertyPatch({ sensitivity: 1.5 })).toEqual({
      property: 'sensitivity',
      value: 1.5,
    });
    expect(getKnobRuntimePropertyPatch({ sensitivity: Number.NaN })).toBeNull();
  });

  it('공통 스타일 패치를 wire 태그 유니온으로 변환한다', () => {
    expect(getUseInlineStylesPatch({ useInlineStyles: false })).toBe(false);
    expect(getFontFamilyPatch({ fontFamily: 'Pretendard' })).toEqual({
      property: 'fontFamily',
      value: 'Pretendard',
    });
    expect(getFontStylePatch({ fontWeight: 700 })).toEqual({
      property: 'fontWeight',
      value: 700,
    });
    expect(getFontStylePatch({ fontWeight: -1 })).toBeNull();
    expect(getFontStylePatch({ fontBold: true, fontItalic: true })).toBeNull();
  });

  it('노트 패치의 허용 값과 단일 필드 불변식을 검증한다', () => {
    expect(getNotePropertyPatch({ noteAlignment: 'center' })).toEqual({
      property: 'noteAlignment',
      value: 'center',
    });
    expect(getNotePropertyPatch({ noteBorderSide: 'vertical' })).toEqual({
      property: 'noteBorderSide',
      value: 'vertical',
    });
    expect(getNotePropertyPatch({ noteAlignment: 'middle' })).toBeNull();
    expect(
      getNotePropertyPatch({ noteGlowEnabled: true, noteGlowSyncPaint: true }),
    ).toBeNull();
  });
});
