import { describe, expect, it } from 'vitest';

import {
  contactWorldPosition,
  solveTransformTowardTarget,
  solveTranslationKeepingContact,
  type ContactGeometry,
} from './contactSolver';

// 축(0.5,0.25)·핀(0.5,1) - 위에서 매달린 팔 형태, 기본 길이 150px
const geometry: ContactGeometry = {
  imageRect: { x: 10, y: 20, width: 100, height: 200 },
  pivot: { x: 0.5, y: 0.25 },
  contactPoint: { x: 0.5, y: 1 },
};

const identity = { x: 0, y: 0, rotation: 0, scale: 1 };

describe('contactWorldPosition', () => {
  it('항등 변환에서는 핀의 rect 좌표 그대로다', () => {
    expect(contactWorldPosition(geometry, identity)).toEqual({
      x: 60,
      y: 220,
    });
  });

  it('이동·회전·배율을 축 기준으로 합성한다', () => {
    // 90도 회전: 아래로 뻗은 벡터(0,150)가 왼쪽(-150,0)으로 눕는다
    const world = contactWorldPosition(geometry, {
      x: 7,
      y: -3,
      rotation: 90,
      scale: 2,
    });
    expect(world.x).toBeCloseTo(7 + 60 - 300, 6);
    expect(world.y).toBeCloseTo(-3 + 70, 6);
  });
});

describe('solveTransformTowardTarget (축 고정)', () => {
  it('현재 핀 위치를 목표로 주면 transform이 보존된다 - 왕복 항등성', () => {
    const current = { x: 12, y: -8, rotation: 33, scale: 1.4 };
    const world = contactWorldPosition(geometry, current);
    const solved = solveTransformTowardTarget(geometry, current, world, true);
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    expect(solved.transform.x).toBe(current.x);
    expect(solved.transform.y).toBe(current.y);
    expect(solved.transform.rotation).toBeCloseTo(current.rotation, 6);
    expect(solved.transform.scale).toBeCloseTo(current.scale, 6);
  });

  it('역산된 transform은 핀을 목표에 정확히 올린다', () => {
    const target = { x: -40, y: 90 };
    const solved = solveTransformTowardTarget(geometry, identity, target, true);
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    const world = contactWorldPosition(geometry, solved.transform);
    expect(world.x).toBeCloseTo(target.x, 6);
    expect(world.y).toBeCloseTo(target.y, 6);
  });

  it('뻗기 OFF면 scale을 유지하고 방향각만 맞춘다', () => {
    const solved = solveTransformTowardTarget(
      geometry,
      { ...identity, scale: 1.5 },
      { x: 300, y: 220 },
      false,
    );
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    expect(solved.transform.scale).toBe(1.5);
    // 핀은 호 위의 최근접점 - 목표 방향은 일치한다
    const axisWorld = { x: 60, y: 70 };
    const world = contactWorldPosition(geometry, solved.transform);
    const targetAngle = Math.atan2(220 - axisWorld.y, 300 - axisWorld.x);
    const worldAngle = Math.atan2(world.y - axisWorld.y, world.x - axisWorld.x);
    expect(worldAngle).toBeCloseTo(targetAngle, 6);
  });

  it('scale·rotation은 계약 범위로 clamp된다', () => {
    // 기본 길이 150px, 목표 거리 6000px -> scale 40은 상한 10으로
    const solved = solveTransformTowardTarget(
      geometry,
      identity,
      { x: 60, y: 70 + 6000 },
      true,
    );
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    expect(solved.transform.scale).toBe(10);
  });

  it('핀=축 퇴화는 transform을 건드리지 않고 degenerate를 반환한다', () => {
    const degenerate = solveTransformTowardTarget(
      { ...geometry, contactPoint: geometry.pivot },
      identity,
      { x: 100, y: 100 },
      true,
    );
    expect(degenerate).toEqual({ status: 'degenerate' });
  });

  it('목표가 축 위인 퇴화도 degenerate다', () => {
    const solved = solveTransformTowardTarget(
      geometry,
      identity,
      { x: 60, y: 70 },
      true,
    );
    expect(solved).toEqual({ status: 'degenerate' });
  });
});

describe('solveTranslationKeepingContact (핀 고정)', () => {
  it('회전이 바뀌어도 핀 월드 위치가 유지된다', () => {
    const current = { x: 5, y: 5, rotation: 10, scale: 1.2 };
    const pinned = contactWorldPosition(geometry, current);
    const solved = solveTranslationKeepingContact(
      geometry,
      { rotation: -70, scale: 1.2 },
      pinned,
    );
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    const world = contactWorldPosition(geometry, solved.transform);
    expect(world.x).toBeCloseTo(pinned.x, 6);
    expect(world.y).toBeCloseTo(pinned.y, 6);
  });

  it('배율 변경도 핀을 고정한다', () => {
    const pinned = contactWorldPosition(geometry, identity);
    const solved = solveTranslationKeepingContact(
      geometry,
      { rotation: 0, scale: 2 },
      pinned,
    );
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    const world = contactWorldPosition(geometry, solved.transform);
    expect(world.x).toBeCloseTo(pinned.x, 6);
    expect(world.y).toBeCloseTo(pinned.y, 6);
  });

  it('offset 상한에 걸리면 닿는 데까지만 간다', () => {
    const solved = solveTranslationKeepingContact(
      geometry,
      { rotation: 180, scale: 10 },
      { x: 5000, y: 5000 },
    );
    expect(solved.status).toBe('ok');
    if (solved.status !== 'ok') return;
    expect(solved.transform.x).toBeLessThanOrEqual(2000);
    expect(solved.transform.y).toBeLessThanOrEqual(2000);
  });

  it('핀=축 퇴화는 degenerate다', () => {
    const solved = solveTranslationKeepingContact(
      { ...geometry, contactPoint: geometry.pivot },
      { rotation: 30, scale: 1 },
      { x: 0, y: 0 },
    );
    expect(solved).toEqual({ status: 'degenerate' });
  });
});
