import { describe, expect, it } from 'vitest';

import { HEADER_EDGE_RATIO, resolveLayerDropZone } from './layerDropZone';

// 실제 행 높이 34px 기준 - 헤더 가장자리 경계 8.5 / 25.5
const ROW = 34;
const EDGE = ROW * HEADER_EDGE_RATIO;

describe('resolveLayerDropZone 그룹 헤더 행', () => {
  it('상단 가장자리는 앞 삽입이다', () => {
    expect(resolveLayerDropZone('group-header', ROW, 0)).toBe('before');
    expect(resolveLayerDropZone('group-header', ROW, EDGE - 1)).toBe('before');
  });

  it('상단 경계 직전은 앞 삽입, 경계부터는 그룹 진입이다', () => {
    expect(resolveLayerDropZone('group-header', ROW, EDGE - 0.5)).toBe(
      'before',
    );
    expect(resolveLayerDropZone('group-header', ROW, EDGE)).toBe('into');
    expect(resolveLayerDropZone('group-header', ROW, EDGE + 1)).toBe('into');
  });

  it('중앙은 그룹 진입이다', () => {
    expect(resolveLayerDropZone('group-header', ROW, ROW / 2)).toBe('into');
  });

  it('하단 경계 직전은 그룹 진입, 경계부터는 뒤 삽입이다', () => {
    expect(resolveLayerDropZone('group-header', ROW, ROW - EDGE - 1)).toBe(
      'into',
    );
    expect(resolveLayerDropZone('group-header', ROW, ROW - EDGE - 0.5)).toBe(
      'into',
    );
    expect(resolveLayerDropZone('group-header', ROW, ROW - EDGE)).toBe('after');
    expect(resolveLayerDropZone('group-header', ROW, ROW - EDGE + 1)).toBe(
      'after',
    );
  });

  it('하단 가장자리 끝은 뒤 삽입이다', () => {
    expect(resolveLayerDropZone('group-header', ROW, ROW - 1)).toBe('after');
  });

  it('가장자리 폭은 행 높이 비율을 따른다', () => {
    // 다른 행 높이에서도 25/50/25 분할 유지
    expect(resolveLayerDropZone('group-header', 40, 9)).toBe('before');
    expect(resolveLayerDropZone('group-header', 40, 10)).toBe('into');
    expect(resolveLayerDropZone('group-header', 40, 29)).toBe('into');
    expect(resolveLayerDropZone('group-header', 40, 30)).toBe('after');
  });
});

describe('resolveLayerDropZone 일반 행', () => {
  it('상하 이등분 경계 전후로 앞/뒤 삽입이 갈린다', () => {
    expect(resolveLayerDropZone('layer', ROW, 0)).toBe('before');
    expect(resolveLayerDropZone('layer', ROW, ROW / 2 - 1)).toBe('before');
    expect(resolveLayerDropZone('layer', ROW, ROW / 2)).toBe('after');
    expect(resolveLayerDropZone('layer', ROW, ROW / 2 + 1)).toBe('after');
    expect(resolveLayerDropZone('layer', ROW, ROW - 1)).toBe('after');
  });

  it('일반 행에는 그룹 진입 존이 없다', () => {
    for (let offset = 0; offset < ROW; offset += 0.5) {
      expect(resolveLayerDropZone('layer', ROW, offset)).not.toBe('into');
    }
  });
});
