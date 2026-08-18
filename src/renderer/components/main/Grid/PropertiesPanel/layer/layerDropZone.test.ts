import { describe, expect, it } from 'vitest';

import {
  HEADER_EDGE_RATIO,
  isNoopLayerDrop,
  resolveLayerDropZone,
} from './layerDropZone';

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

describe('isNoopLayerDrop', () => {
  const layer = (id: string, groupId?: string) => ({
    displayType: 'layer' as const,
    item: { id, groupId },
  });
  const header = () => ({ displayType: 'group-header' as const });
  const drag = (...ids: string[]) => new Set(ids);

  it('자기 행 위·아래 경계에 소속 그대로 놓으면 무변경이다', () => {
    const display = [layer('a'), layer('b'), layer('c')];
    expect(isNoopLayerDrop(display, drag('b'), 1, undefined)).toBe(true);
    expect(isNoopLayerDrop(display, drag('b'), 2, undefined)).toBe(true);
    expect(isNoopLayerDrop(display, drag('b'), 0, undefined)).toBe(false);
    expect(isNoopLayerDrop(display, drag('b'), 3, undefined)).toBe(false);
  });

  it('그룹 바로 아래 행을 마지막 멤버 하단으로 끌면 소속이 바뀌므로 이동이다', () => {
    // [헤더 g, 멤버 m, 바깥 b] - 슬롯 2는 b 자신의 위 경계
    const display = [header(), layer('m', 'g'), layer('b')];
    expect(isNoopLayerDrop(display, drag('b'), 2, 'g')).toBe(false);
    expect(isNoopLayerDrop(display, drag('b'), 2, undefined)).toBe(true);
    expect(isNoopLayerDrop(display, drag('b'), 3, undefined)).toBe(true);
  });

  it('그룹 마지막 멤버를 바깥 다음 행 상단으로 끌면 그룹 이탈이라 이동이다', () => {
    const display = [header(), layer('m', 'g'), layer('b')];
    expect(isNoopLayerDrop(display, drag('m'), 2, undefined)).toBe(false);
    expect(isNoopLayerDrop(display, drag('m'), 2, 'g')).toBe(true);
    expect(isNoopLayerDrop(display, drag('m'), 1, 'g')).toBe(true);
    // 헤더 위쪽은 그룹 밖 앞 삽입
    expect(isNoopLayerDrop(display, drag('m'), 0, undefined)).toBe(false);
  });

  it('여러 행을 끌 때 이어져 있어야 무변경이 된다', () => {
    const contiguous = [layer('a'), layer('b'), layer('c'), layer('d')];
    expect(isNoopLayerDrop(contiguous, drag('b', 'c'), 1, undefined)).toBe(
      true,
    );
    expect(isNoopLayerDrop(contiguous, drag('b', 'c'), 2, undefined)).toBe(
      true,
    );
    expect(isNoopLayerDrop(contiguous, drag('b', 'c'), 3, undefined)).toBe(
      true,
    );
    // 사이에 다른 행이 끼면 어느 슬롯이든 뭉치는 이동이다
    const split = [layer('a'), layer('x'), layer('c'), layer('d')];
    expect(isNoopLayerDrop(split, drag('a', 'c'), 0, undefined)).toBe(false);
    expect(isNoopLayerDrop(split, drag('a', 'c'), 2, undefined)).toBe(false);
    expect(isNoopLayerDrop(split, drag('a', 'c'), 3, undefined)).toBe(false);
  });

  it('사이에 헤더가 끼거나 소속이 섞이면 이동이다', () => {
    const display = [layer('a'), header(), layer('m', 'g'), layer('b')];
    expect(isNoopLayerDrop(display, drag('a', 'm'), 0, undefined)).toBe(false);
    // m·b는 이어져 있지만 소속이 다르다
    expect(isNoopLayerDrop(display, drag('m', 'b'), 2, 'g')).toBe(false);
    expect(isNoopLayerDrop(display, drag('m', 'b'), 3, undefined)).toBe(false);
  });

  it('끌던 행이 목록에 없으면 무변경으로 보지 않는다', () => {
    expect(isNoopLayerDrop([layer('a')], drag('zz'), 0, undefined)).toBe(false);
  });
});
