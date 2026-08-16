import { describe, expect, it } from 'vitest';

import { resolveDropIndexFromAnchors } from './useLayerDnD';

const layer = (id: string) =>
  ({ displayType: 'layer' as const, item: { id } } as never);
const header = (groupId: string) =>
  ({ displayType: 'group-header' as const, groupId } as never);

const NO_DRAG: ReadonlySet<string> = new Set();

describe('resolveDropIndexFromAnchors', () => {
  it('양 앵커 생존·인접이면 사이 index를 준다', () => {
    const display = [layer('a'), layer('b'), layer('c')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 99,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'b',
        },
        NO_DRAG,
        display,
      ),
    ).toBe(1);
  });

  it('앵커 순서가 역전되면 무커밋한다', () => {
    // 병행 재정렬이 b를 a 앞으로 옮긴 상황
    const display = [layer('b'), layer('c'), layer('a')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 1,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'b',
        },
        NO_DRAG,
        display,
      ),
    ).toBeNull();
  });

  it('앵커 사이에 비드래그 layer가 끼면 무커밋한다', () => {
    const display = [layer('a'), layer('x'), layer('b')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 1,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'b',
        },
        NO_DRAG,
        display,
      ),
    ).toBeNull();
  });

  it('앵커 사이에 그룹 헤더가 끼면 무커밋한다', () => {
    const display = [layer('a'), header('g1'), layer('b')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 1,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'b',
        },
        NO_DRAG,
        display,
      ),
    ).toBeNull();
  });

  it('한쪽 앵커만 생존하면 그 기준으로 배치한다', () => {
    const display = [layer('x'), layer('a'), layer('y')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'gone',
        },
        NO_DRAG,
        display,
      ),
    ).toBe(2);
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: undefined,
          anchorBeforeId: 'gone',
          anchorAfterId: 'a',
        },
        NO_DRAG,
        display,
      ),
    ).toBe(1);
  });

  it('양 앵커 소실이면 무커밋한다', () => {
    const display = [layer('x')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: undefined,
          anchorBeforeId: 'gone1',
          anchorAfterId: 'gone2',
        },
        NO_DRAG,
        display,
      ),
    ).toBeNull();
  });

  it('그룹 헤더 경계 앵커로 그룹 앞뒤 배치를 재해석한다', () => {
    const display = [layer('a'), header('g1'), layer('m1'), header('g2')];
    // g1 헤더 아래(명시 헤더 앵커)
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: 'g1',
          anchorHeaderGroupId: 'g1',
        },
        NO_DRAG,
        display,
      ),
    ).toBe(2);
    // 그룹 사이 경계: before=g1 마지막 멤버, after=g2 헤더
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 1,
          targetGroupId: undefined,
          anchorBeforeId: 'm1',
          anchorAfterHeaderGroupId: 'g2',
        },
        NO_DRAG,
        display,
      ),
    ).toBe(3);
  });

  it('대상 그룹이 삭제됐으면 무커밋한다', () => {
    const display = [layer('a')];
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: 'gone-group',
          anchorBeforeId: 'a',
        },
        NO_DRAG,
        display,
      ),
    ).toBeNull();
  });

  it('이동 집합에 편입된 앵커는 소실로 취급한다', () => {
    const display = [layer('x'), layer('a'), layer('y'), layer('b')];
    // before 앵커 a가 함께 이동 - a를 고정점으로 보면 사이의 y 개입으로
    // 무커밋되지만, 소실 취급하면 살아남은 after 앵커 b 기준으로 배치
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'b',
        },
        new Set(['a']),
        display,
      ),
    ).toBe(3);
    // 양 앵커 모두 이동 집합이면 무커밋
    expect(
      resolveDropIndexFromAnchors(
        {
          toDisplayIndex: 0,
          targetGroupId: undefined,
          anchorBeforeId: 'a',
          anchorAfterId: 'b',
        },
        new Set(['a', 'b']),
        display,
      ),
    ).toBeNull();
  });

  it('경계 드롭은 앵커 없이 top/bottom으로 해석한다', () => {
    const display = [layer('a')];
    expect(
      resolveDropIndexFromAnchors(
        { toDisplayIndex: 5, targetGroupId: undefined, boundary: 'top' },
        NO_DRAG,
        display,
      ),
    ).toBe(0);
    expect(
      resolveDropIndexFromAnchors(
        { toDisplayIndex: 0, targetGroupId: undefined, boundary: 'bottom' },
        NO_DRAG,
        display,
      ),
    ).toBe(1);
  });

  it('앵커도 경계도 없는 all-null 타깃은 무커밋한다', () => {
    // 앱 내부에선 도달 불가 - wire의 all-null 앵커가 숫자 index로
    // fail-open하지 않도록 fail-closed를 고정한다
    expect(
      resolveDropIndexFromAnchors(
        { toDisplayIndex: 0, targetGroupId: undefined },
        NO_DRAG,
        [layer('a')],
      ),
    ).toBeNull();
    expect(
      resolveDropIndexFromAnchors(
        { toDisplayIndex: 0, targetGroupId: undefined },
        NO_DRAG,
        [],
      ),
    ).toBeNull();
  });
});
