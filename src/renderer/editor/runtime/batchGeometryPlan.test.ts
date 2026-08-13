import { describe, expect, it } from 'vitest';

import {
  computeBatchGeometryPlan,
  computeBatchSpacingValue,
  type BatchGeometryLayoutElement,
} from './batchGeometryPlan';

const element = (
  key: string,
  x: number,
  y: number,
  width = 10,
  height = 10,
): BatchGeometryLayoutElement => ({ key, x, y, width, height });

const patchFor = (
  plan: ReturnType<typeof computeBatchGeometryPlan>,
  key: string,
) => plan?.updates.find((update) => update.key === key)?.patch;

describe('computeBatchGeometryPlan', () => {
  it('크기가 다른 같은 행은 동적 tolerance 또는 edge overlap으로 함께 묶는다', () => {
    const plan = computeBatchGeometryPlan(
      [element('large', 0, 0, 10, 100), element('small', 30, 0, 10, 10)],
      { kind: 'spacing', spacing: 5 },
    );

    expect(patchFor(plan, 'small')).toMatchObject({ dx: 15 });
  });

  it('여러 행의 수직 간격은 첫 행을 고정하고 행 내부 y 상대값을 보존한다', () => {
    const plan = computeBatchGeometryPlan(
      [
        element('a', 0, 0),
        element('b', 20, 2),
        element('c', 0, 30),
        element('d', 20, 35),
      ],
      { kind: 'spacing', spacing: 5 },
    );

    expect(patchFor(plan, 'c')).toMatchObject({ dy: 17 });
    expect(patchFor(plan, 'd')).toMatchObject({ dy: 22 });
  });

  it('한 행으로 묶인 세로 열은 column fallback으로 간격을 적용한다', () => {
    const plan = computeBatchGeometryPlan(
      [element('a', 0, 0, 10, 100), element('b', 0, 30, 10, 100)],
      { kind: 'spacing', spacing: 5 },
    );

    expect(patchFor(plan, 'b')).toMatchObject({ dy: 105 });
  });

  it('시작점 차이가 0.1 이하인 요소는 한 stack으로 함께 이동한다', () => {
    const plan = computeBatchGeometryPlan(
      [
        element('a', 0, 0, 10),
        element('b', 0.08, 0, 20),
        element('c', 30, 0, 10),
      ],
      { kind: 'spacing', spacing: 5 },
    );

    expect(patchFor(plan, 'a')).toBeUndefined();
    expect(patchFor(plan, 'b')).toMatchObject({ dx: 0 });
    expect(patchFor(plan, 'c')).toMatchObject({ dx: 25 });
  });

  it('0.05 이하 위치 차이는 변경으로 보내지 않는다', () => {
    const plan = computeBatchGeometryPlan(
      [element('a', 0, 0), element('b', 20.04, 0)],
      {
        kind: 'spacing',
        spacing: 10,
      },
    );

    expect(plan?.updates).toEqual([]);
    expect(plan?.bounds.map(({ key }) => key)).toEqual(['a', 'b']);
  });

  it('표시 간격도 적용 계획과 같은 행 그룹과 반올림을 쓴다', () => {
    expect(
      computeBatchSpacingValue([
        element('large', 0, 0, 10, 100),
        element('small', 22.26, 0, 10, 10),
        element('next-row', 0, 120, 10, 10),
      ]),
    ).toEqual({ isMixed: true, value: 12.3 });
  });

  it('음수 spacing은 0으로 제한한다', () => {
    const plan = computeBatchGeometryPlan(
      [element('a', 0, 0), element('b', 30, 0)],
      { kind: 'spacing', spacing: -2.26 },
    );

    expect(patchFor(plan, 'b')).toMatchObject({ dx: 10 });
  });

  it('같은 좌표 분배는 frozen 선택 순서를 tie-break로 유지한다', () => {
    const plan = computeBatchGeometryPlan(
      [
        element('first', 0, 0),
        element('second', 0, 0),
        element('last', 100, 0),
      ],
      { kind: 'distribute', direction: 'horizontal' },
    );

    expect(plan?.bounds.map(({ key, bounds }) => [key, bounds.dx])).toEqual([
      ['first', 0],
      ['second', 50],
      ['last', 100],
    ]);
  });

  it('변하지 않는 대상도 semantic N-op bounds에는 포함한다', () => {
    const plan = computeBatchGeometryPlan(
      [element('anchor', 0, 0), element('moving', 20, 20)],
      { kind: 'align', direction: 'left' },
    );

    expect(plan?.bounds.map(({ key }) => key)).toEqual(['anchor', 'moving']);
    expect(plan?.updates).toEqual([
      { key: 'anchor', patch: { dx: 0 } },
      { key: 'moving', patch: { dx: 0 } },
    ]);
  });
});
