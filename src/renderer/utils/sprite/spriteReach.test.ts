import { describe, expect, it } from 'vitest';

import type { SpritePose, SpriteTransform } from '@src/types/key/sprites';
import { DEFAULT_SPRITE_TRANSITION_EASING } from '@src/types/key/sprites';

import {
  computeSpriteReachAabb as computeReachWithLiveKeys,
  easingOutputRange,
  easingOvershootExtension,
  resolveSpriteRenderEasing,
  SPRITE_SAFE_FALLBACK_EASING,
  type SpriteReachGeometry,
} from './spriteReach';
import { makeSpritePose } from './spriteFixtures';

// 기본은 모든 트리거가 살아있고 서로 다른 키에 물린 상태 (완전 독립).
// 죽은 키·공동 활성화 케이스만 맵을 명시한다
const computeSpriteReachAabb = (
  sprite: SpriteReachGeometry,
  canonicalByTrigger?: ReadonlyMap<string, string>,
) =>
  computeReachWithLiveKeys(
    sprite,
    canonicalByTrigger ??
      new Map(
        sprite.poses.flatMap((pose) =>
          pose.triggers.map((trigger) => [trigger, trigger] as const),
        ),
      ),
  );

const OVERSHOOT_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

const makeTransform = (
  overrides: Partial<SpriteTransform> = {},
): SpriteTransform => ({
  x: 0,
  y: 0,
  rotation: 0,
  scale: 1,
  ...overrides,
});

const makePose = (
  poseId: string,
  transform: Partial<SpriteTransform> = {},
  imageOverride: string | null = null,
): SpritePose =>
  makeSpritePose({
    poseId,
    triggers: [poseId],
    transform: makeTransform(transform),
    imageOverride,
  });

// 활동 영역 200x200, pivot 중앙 (기본 생성값 형태)
const makeSprite = (
  overrides: Partial<SpriteReachGeometry> = {},
): SpriteReachGeometry => ({
  baseImage: 'base.png',
  width: 200,
  height: 200,
  pivot: { x: 0.5, y: 0.5 },
  referenceNaturalSize: null,
  idleTransform: makeTransform(),
  poses: [],
  transitionEasing: DEFAULT_SPRITE_TRANSITION_EASING,
  ...overrides,
});

describe('computeSpriteReachAabb', () => {
  it('변환 없는 스프라이트는 요소 상자 그대로', () => {
    const reach = computeSpriteReachAabb(makeSprite());
    expect(reach).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
  });

  it('45도 회전은 대각선 오버행을 만든다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ idleTransform: makeTransform({ rotation: 45 }) }),
    );
    // pivot 중앙 기준 반대각 100*sqrt(2)
    expect(reach?.minX).toBeCloseTo(-41.4214, 3);
    expect(reach?.minY).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxX).toBeCloseTo(241.4214, 3);
    expect(reach?.maxY).toBeCloseTo(241.4214, 3);
  });

  it('회전 방향은 CSS rotate와 같다 (y축 아래, 양수 시계방향)', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({
        pivot: { x: 0, y: 0 },
        idleTransform: makeTransform({ rotation: 90 }),
      }),
    );
    expect(reach?.minX).toBeCloseTo(-200, 6);
    expect(reach?.maxX).toBeCloseTo(0, 6);
    expect(reach?.minY).toBeCloseTo(0, 6);
    expect(reach?.maxY).toBeCloseTo(200, 6);
  });

  it('offset 이동은 AABB를 그대로 평행 이동한다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ idleTransform: makeTransform({ x: 300, y: -50 }) }),
    );
    expect(reach).toEqual({ minX: 300, minY: -50, maxX: 500, maxY: 150 });
  });

  it('scale 확대는 pivot 기준으로 사방으로 커진다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ idleTransform: makeTransform({ scale: 2 }) }),
    );
    expect(reach).toEqual({ minX: -100, minY: -100, maxX: 300, maxY: 300 });
  });

  it('상태 간 회전이 다르면 최원점 반경의 원을 상한으로 잡는다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ poses: [makePose('p1', { rotation: 90 })] }),
    );
    // 중간 각(예: 45도)의 대각선까지 커버해야 한다
    expect(reach?.minX).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxX).toBeCloseTo(241.4214, 3);
    expect(reach?.minY).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxY).toBeCloseTo(241.4214, 3);
  });

  it('회전 상이 + offset 상이는 각 offset 위치의 원 합집합이다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({ poses: [makePose('p1', { x: 500, rotation: 90 })] }),
    );
    expect(reach?.minX).toBeCloseTo(-41.4214, 3);
    expect(reach?.maxX).toBeCloseTo(741.4214, 3);
  });

  it('오버슈트 easing은 상태 범위 밖 여유를 더한다', () => {
    const noOvershoot = computeSpriteReachAabb(
      makeSprite({ poses: [makePose('p1', { x: 100 })] }),
    );
    expect(noOvershoot?.minX).toBeCloseTo(0, 6);
    expect(noOvershoot?.maxX).toBeCloseTo(300, 6);

    const withOvershoot = computeSpriteReachAabb(
      makeSprite({
        poses: [makePose('p1', { x: 100 })],
        transitionEasing: OVERSHOOT_EASING,
      }),
    );
    // e = 0.0978, 재타깃 상한 e/(1-e) = 0.1084, 여유 = 0.1084 * 100
    expect(withOvershoot?.minX).toBeCloseTo(-10.84, 1);
    expect(withOvershoot?.maxX).toBeCloseTo(310.84, 1);
  });

  it('렌더 가능한 이미지가 없으면 null', () => {
    expect(computeSpriteReachAabb(makeSprite({ baseImage: null }))).toBeNull();
  });

  // 스키마가 빈 문자열을 막지 않아 플러그인·임포트로 들어온다.
  // 렌더러는 이걸 이미지 없음으로 보므로 창 여유만 헛되이 커진다
  it('공백뿐인 이미지 참조는 이미지 없음으로 본다', () => {
    expect(computeSpriteReachAabb(makeSprite({ baseImage: '' }))).toBeNull();
    expect(computeSpriteReachAabb(makeSprite({ baseImage: '   ' }))).toBeNull();
    expect(
      computeSpriteReachAabb(
        makeSprite({
          baseImage: null,
          poses: [makePose('p1', { x: 100 }, '  ')],
        }),
      ),
    ).toBeNull();
  });

  // 키를 지우면 그 자세는 영원히 재생되지 않는다. 도달 계산만 그걸 모르면
  // 창이 넓어진 채 남아 키를 지워도 레이아웃이 되돌아오지 않는다
  it('트리거 키가 사라진 자세는 도달 범위를 넓히지 않는다', () => {
    const withDead = computeSpriteReachAabb(
      makeSprite({
        poses: [makePose('alive', { x: 40 }), makePose('dead', { x: -2000 })],
      }),
      new Map([['alive', 'KeyA']]),
    );

    expect(withDead).toEqual(
      computeSpriteReachAabb(
        makeSprite({ poses: [makePose('alive', { x: 40 })] }),
      ),
    );
    expect(withDead?.minX).toBe(0);
  });

  // 조합 자세는 트리거 전부가 눌려야 선택된다 - 하나만 죽어도 재생 불가
  it('조합 자세는 트리거 하나만 사라져도 제외된다', () => {
    const combo = makeSpritePose({
      poseId: 'combo',
      triggers: ['alive', 'dead'],
      transform: makeTransform({ x: -2000 }),
      imageOverride: null,
    });

    expect(
      computeSpriteReachAabb(
        makeSprite({ poses: [combo] }),
        new Map([['alive', 'KeyA']]),
      ),
    ).toEqual(computeSpriteReachAabb(makeSprite()));
  });

  // 활성 키가 없으면 해석기는 무조건 idle을 낸다 - 트리거 없는 자세는
  // 어떤 눌림 조합에서도 선택되지 않는다 (복구·grandfather 데이터로 들어온다)
  it('트리거가 빈 자세는 도달 범위를 넓히지 않는다', () => {
    const orphan = makeSpritePose({
      poseId: 'orphan',
      triggers: [],
      transform: makeTransform({ x: -2000 }),
      imageOverride: null,
    });

    expect(computeSpriteReachAabb(makeSprite({ poses: [orphan] }))).toEqual(
      computeSpriteReachAabb(makeSprite()),
    );
  });

  // 같은 트리거 집합이 겹치면 해석기는 poseId 사전순 첫 자세만 쓴다
  it('트리거 집합이 겹치는 뒤 순위 자세는 제외된다', () => {
    const first = makeSpritePose({
      poseId: 'a',
      triggers: ['k'],
      transform: makeTransform({ x: 40 }),
      imageOverride: null,
    });
    const shadowed = makeSpritePose({
      poseId: 'b',
      triggers: ['k'],
      transform: makeTransform({ x: -2000 }),
      imageOverride: null,
    });

    expect(
      computeSpriteReachAabb(makeSprite({ poses: [first, shadowed] })),
    ).toEqual(computeSpriteReachAabb(makeSprite({ poses: [first] })));
  });

  // 같은 물리 키에 묶인 키 요소는 항상 함께 눌린다. 두 자세는 개별로 도달하지
  // 못하고 평균으로만 나타나므로 범위가 그만큼 좁아진다
  it('같은 키에 묶인 자세들은 평균까지만 도달한다', () => {
    const poses = [
      makeSpritePose({
        poseId: 'a',
        triggers: ['k1'],
        transform: makeTransform({ x: -2000 }),
        imageOverride: null,
      }),
      makeSpritePose({
        poseId: 'b',
        triggers: ['k2'],
        transform: makeTransform({ x: 2000 }),
        imageOverride: null,
      }),
    ];
    const sprite = makeSprite({ poses });

    // k1·k2가 같은 KeyA에 물리면 둘만 함께 눌리는 상태뿐이라 평균 0으로 수렴
    expect(
      computeSpriteReachAabb(
        sprite,
        new Map([
          ['k1', 'KeyA'],
          ['k2', 'KeyA'],
        ]),
      ),
    ).toEqual(computeSpriteReachAabb(makeSprite()));

    // 서로 다른 키면 각각 단독으로 도달하므로 범위가 그대로 넓다
    const independent = computeSpriteReachAabb(
      sprite,
      new Map([
        ['k1', 'KeyA'],
        ['k2', 'KeyS'],
      ]),
    );
    expect(independent?.minX).toBe(-2000);
    expect(independent?.maxX).toBe(2200);
  });

  // 조합 자세가 공동 활성화 때문에 정확 일치할 수 없으면 그 override는 어떤
  // 상태에서도 그려지지 않는다. 자세 목록만 보면 이걸 놓쳐 빈 창을 넓힌다
  it('어떤 상태에서도 그릴 이미지가 없으면 도달 범위가 없다', () => {
    const sprite = makeSprite({
      baseImage: null,
      poses: [
        // 이미지가 달린 조합 자세 - a가 켜지면 c도 함께 켜져 정확 일치가 안 된다
        makeSpritePose({
          poseId: 'image',
          triggers: ['a', 'b'],
          transform: makeTransform(),
          imageOverride: 'pose.png',
        }),
        makeSpritePose({
          poseId: 'plain',
          triggers: ['c'],
          transform: makeTransform({ x: 2000 }),
          imageOverride: null,
        }),
      ],
    });

    expect(
      computeSpriteReachAabb(
        sprite,
        new Map([
          ['a', 'KeyA'],
          ['c', 'KeyA'],
          ['b', 'KeyB'],
        ]),
      ),
    ).toBeNull();
  });

  // 폴백 경로도 재생 불가능한 자세를 계속 제외해야 한다
  it('폴백에서도 죽은 키·빈 트리거·중복 자세는 제외된다', () => {
    const alive = makeSpritePose({
      poseId: 'alive',
      triggers: ['k'],
      transform: makeTransform({ x: 40 }),
      imageOverride: null,
    });
    const noEnum = { enumerate: false } as const;
    const baseline = computeReachWithLiveKeys(
      makeSprite({ poses: [alive] }),
      new Map([['k', 'KeyA']]),
      noEnum,
    );

    for (const extra of [
      makeSpritePose({
        poseId: 'dead',
        triggers: ['gone'],
        transform: makeTransform({ x: -2000 }),
        imageOverride: null,
      }),
      makeSpritePose({
        poseId: 'orphan',
        triggers: [],
        transform: makeTransform({ x: -2000 }),
        imageOverride: null,
      }),
      makeSpritePose({
        poseId: 'zshadowed',
        triggers: ['k'],
        transform: makeTransform({ x: -2000 }),
        imageOverride: null,
      }),
    ]) {
      expect(
        computeReachWithLiveKeys(
          makeSprite({ poses: [alive, extra] }),
          new Map([['k', 'KeyA']]),
          noEnum,
        ),
      ).toEqual(baseline);
    }
  });

  // 조합 폭발을 막는 상한. 넘으면 자세 범위 과대 근사로 돌아간다
  it('키 그룹이 상한을 넘으면 과대 근사로 폴백한다', () => {
    const spread = (count: number) => {
      const poses = [
        makeSpritePose({
          poseId: 'a',
          triggers: ['k1'],
          transform: makeTransform({ x: -2000 }),
          imageOverride: null,
        }),
        makeSpritePose({
          poseId: 'b',
          triggers: ['k2'],
          transform: makeTransform({ x: 2000 }),
          imageOverride: null,
        }),
      ];
      const canonicals: Array<readonly [string, string]> = [
        ['k1', 'KeyA'],
        ['k2', 'KeyA'],
      ];
      // k1·k2가 한 그룹이므로 나머지 count-1개를 서로 다른 키로 채운다
      for (let i = 0; i < count - 1; i++) {
        poses.push(
          makeSpritePose({
            poseId: `pad-${i}`,
            triggers: [`pad${i}`],
            transform: makeTransform(),
            imageOverride: null,
          }),
        );
        canonicals.push([`pad${i}`, `Pad${i}`]);
      }
      return computeSpriteReachAabb(makeSprite({ poses }), new Map(canonicals));
    };

    // 10그룹까지는 열거해서 공동 활성화를 반영한다
    expect(spread(10)).toEqual(computeSpriteReachAabb(makeSprite()));
    // 11그룹부터는 폴백이라 두 극단이 다시 들어간다
    expect(spread(11)?.minX).toBe(-2000);
  });

  // 기본 이미지가 없고 죽은 자세의 override만 남으면 그릴 게 없다
  it('죽은 자세의 override만 남으면 이미지 없음으로 본다', () => {
    expect(
      computeSpriteReachAabb(
        makeSprite({
          baseImage: null,
          poses: [makePose('dead', { x: -2000 }, 'pose.png')],
        }),
        new Map(),
      ),
    ).toBeNull();
  });

  it('pose imageOverride만 있어도 도달 범위를 계산한다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({
        baseImage: null,
        poses: [makePose('p1', { x: 100 }, 'override.png')],
      }),
    );
    expect(reach?.maxX).toBeCloseTo(300, 6);
  });
});

describe('easingOutputRange', () => {
  it('기본 easing과 키워드는 0~1을 벗어나지 않는다', () => {
    expect(easingOutputRange(DEFAULT_SPRITE_TRANSITION_EASING)).toEqual({
      min: 0,
      max: 1,
    });
    expect(easingOutputRange('linear')).toEqual({ min: 0, max: 1 });
    expect(easingOutputRange('ease-in-out')).toEqual({ min: 0, max: 1 });
  });

  it('오버슈트 cubic-bezier의 최대 출력을 정확히 구한다', () => {
    expect(easingOutputRange(OVERSHOOT_EASING).max).toBeCloseTo(1.0978, 3);
    expect(easingOutputRange(OVERSHOOT_EASING).min).toBe(0);
  });

  it('linear() 함수는 정지점 최소·최대를 쓴다', () => {
    expect(easingOutputRange('linear(0, 1.5, 1)')).toEqual({
      min: 0,
      max: 1.5,
    });
    expect(easingOutputRange('linear(-0.2, 0.5 50%, 1)').min).toBe(-0.2);
  });

  // 유한한 초대형 제어점은 3*y1이나 b*b가 넘쳐 판별식이 NaN이 되고,
  // NaN >= 0이 false라 극점을 통째로 놓쳐 범위를 {0, 1}로 오판했다.
  // 브라우저는 이 곡선을 거부하지 않으므로 창 여유 0으로 스프라이트가 잘린다
  it('중간 연산이 넘치면 제어점 볼록 껍질로 폴백한다', () => {
    expect(easingOutputRange('cubic-bezier(0, 1e308, 1, 0)').max).toBe(1e308);
    expect(easingOutputRange('cubic-bezier(0, -1e308, 1, 0)').min).toBe(-1e308);
    // 3*y1 - 3*y2가 Infinity - Infinity로 상쇄되는 경우도 같다
    expect(easingOutputRange('cubic-bezier(0, 1e308, 1, 1e308)').max).toBe(
      1e308,
    );
    // Number 변환 자체가 Infinity인 입력
    expect(easingOutputRange('cubic-bezier(0, 1e999, 1, 0)').max).toBe(
      Infinity,
    );
  });

  it('넘치지 않는 큰 제어점은 해석적 극점을 그대로 쓴다', () => {
    // 껍질(1e100)이 아니라 실제 극점이어야 한다 - 폴백이 상시 적용되면 안 된다
    expect(easingOutputRange('cubic-bezier(0, 1e100, 1, 0)').max).toBeCloseTo(
      4.444444444444445e99,
      -85,
    );
    expect(easingOutputRange('cubic-bezier(0.5, 2, 0.5, 1)').max).toBe(1.25);
  });

  it('해석 불가 문자열은 스냅 전환이라 0~1로 본다', () => {
    expect(easingOutputRange('not-an-easing')).toEqual({ min: 0, max: 1 });
    // x 제어점이 0~1 밖이면 CSS 선언 자체가 무효
    expect(easingOutputRange('cubic-bezier(2, 5, 0.5, 1)')).toEqual({
      min: 0,
      max: 1,
    });
  });
});

describe('easingOvershootExtension', () => {
  it('오버슈트 없는 easing은 0', () => {
    expect(easingOvershootExtension(DEFAULT_SPRITE_TRANSITION_EASING)).toBe(0);
    expect(easingOvershootExtension('linear')).toBe(0);
  });

  it('재타깃 누적 상한 e/(1-e)를 적용한다', () => {
    expect(easingOvershootExtension(OVERSHOOT_EASING)).toBeCloseTo(0.1084, 3);
    expect(easingOvershootExtension('linear(0, 1.5, 1)')).toBeCloseTo(1, 6);
  });

  it('지나침 폭 1 이상은 폴백 곡선으로 강등되어 여유 0', () => {
    expect(resolveSpriteRenderEasing('cubic-bezier(0.5, 10, 0.5, -9)')).toBe(
      SPRITE_SAFE_FALLBACK_EASING,
    );
    expect(easingOvershootExtension('cubic-bezier(0.5, 10, 0.5, -9)')).toBe(0);
    expect(easingOvershootExtension('linear(0, 2.5, 1)')).toBe(0);
  });

  it('지나침 폭 1 미만 easing은 강등 없이 유지된다', () => {
    expect(resolveSpriteRenderEasing(OVERSHOOT_EASING)).toBe(OVERSHOOT_EASING);
    expect(resolveSpriteRenderEasing('linear')).toBe('linear');
    // 넘치지 않는 큰 제어점은 지나침이 커서 강등되지만, 판정은 해석적 값 기준이다
    expect(resolveSpriteRenderEasing('cubic-bezier(0.5, 2, 0.5, 1)')).toBe(
      'cubic-bezier(0.5, 2, 0.5, 1)',
    );
  });

  // 범위를 {0, 1}로 오판하면 강등도 안 걸리고 창 여유도 0이라
  // 실제 곡선이 아무리 튀어도 방어가 전부 통과해 버린다
  it('연산이 넘치는 제어점은 강등되고 창 여유가 0이다', () => {
    for (const easing of [
      'cubic-bezier(0, 1e308, 1, 0)',
      'cubic-bezier(0, -1e308, 1, 0)',
      'cubic-bezier(0, 1e308, 1, 1e308)',
      'cubic-bezier(0, 1e999, 1, 0)',
    ]) {
      expect(resolveSpriteRenderEasing(easing)).toBe(
        SPRITE_SAFE_FALLBACK_EASING,
      );
      expect(easingOvershootExtension(easing)).toBe(0);
    }
  });

  // WAAPI는 무효 easing에 TypeError를 던져 단발 재생을 통째로 끊는다.
  // CSS transition만 보던 시절의 통과 규칙이 남으면 그 예외가 그대로 나간다
  it('문법이 무효한 easing은 폴백 곡선으로 강등된다', () => {
    for (const easing of [
      'cubic-bezier(2, 0, 0.5, 1)',
      'cubic-bezier(-1, 0, 0.5, 1)',
      'cubic-bezier(0, 0, 1.2, 1)',
      'wobble',
      'ease-in-out-back',
      'steps(0)',
      'steps(-2)',
      'steps(1, jump-none)',
      'linear(0, abc, 1)',
      // 백분율 단독 스톱과 괄호 누수 - parseFloat에 맡기면 유한값으로 새어 나간다
      'linear(0, 1%, 1)',
      'linear(0, 50%, 1)',
      'linear(0, 1))',
      'linear(0,1) junk)',
      // 스톱 하나짜리 목록과 무한대 스톱 - 앞은 엔진이 거부하고
      // 뒤는 유한값으로 잘려 도달 계산이 [0, 1]로 오판한다
      'linear(0)',
      'linear(1)',
      'linear(1e999, 0)',
      'linear(0, 1e999)',
      'linear(-1e999, 1)',
      '',
    ]) {
      expect(resolveSpriteRenderEasing(easing)).toBe(
        SPRITE_SAFE_FALLBACK_EASING,
      );
    }
  });

  it('유효한 문법은 강등 대상이 아니다', () => {
    for (const easing of [
      'ease-in-out',
      'step-start',
      'steps(4)',
      'steps(4, jump-none)',
      'steps(2, end)',
      'steps(+2, end)',
      'linear(0, 0.25 75%, 1)',
      'linear(0, 0.5 25% 75%, 1)',
      ' cubic-bezier(0.4, 0, 0.2, 1) ',
    ]) {
      expect(resolveSpriteRenderEasing(easing)).toBe(easing);
    }
  });

  it('무효 easing 강등은 도달 여유를 늘리지 않는다', () => {
    expect(easingOvershootExtension('cubic-bezier(2, 0, 0.5, 1)')).toBe(0);
    expect(easingOvershootExtension('wobble')).toBe(0);
  });
});

describe('computeSpriteReachAabb 자세 이미지 배치', () => {
  it('자세 이미지의 배치가 상자보다 크면 그만큼 도달 범위가 넓어진다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({
        pivot: { x: 0.5, y: 1 },
        referenceNaturalSize: { source: 'base.png', width: 200, height: 200 },
        poses: [
          makeSpritePose({
            poseId: 'p',
            triggers: ['p'],
            transform: makeTransform(),
            imageOverride: 'hand.png',
            imageOverrideMetrics: {
              source: 'hand.png',
              width: 200,
              height: 400,
            },
          }),
        ],
      }),
    );
    // 기준 이미지는 상자 그대로(0..200), 자세 이미지는 바닥 기준점(100,200) 위로 400px
    expect(reach).toEqual({ minX: 0, minY: -200, maxX: 200, maxY: 200 });
  });

  it('원본 크기가 없는 자세는 상자 배치로 세어 상자 밖으로 나가지 않는다', () => {
    const reach = computeSpriteReachAabb(
      makeSprite({
        referenceNaturalSize: { source: 'base.png', width: 200, height: 200 },
        poses: [makePose('p', {}, 'hand.png')],
      }),
    );
    expect(reach).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 200 });
  });
});
