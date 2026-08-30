import { describe, expect, it } from 'vitest';

import type {
  ReactiveSpritePosition,
  SpritePose,
  SpriteTransform,
} from '@src/types/key/sprites';

import { resolveSpriteTarget } from './poseResolver';

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
  triggers: string[],
  transform: Partial<SpriteTransform> = {},
  imageOverride: string | null = null,
): SpritePose => ({
  poseId,
  triggers,
  matchMode: 'exact',
  transform: makeTransform(transform),
  imageOverride,
});

const makeSprite = (
  poses: SpritePose[],
  overrides: Partial<ReactiveSpritePosition> = {},
): ReactiveSpritePosition => ({
  dx: 0,
  dy: 0,
  width: 200,
  height: 120,
  hidden: false,
  zIndex: null,
  layerName: null,
  groupId: null,
  className: null,
  useInlineStyles: null,
  baseImage: 'base.png',
  imageFit: null,
  imageRect: { x: 0, y: 0, width: 100, height: 100 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: makeTransform(),
  poses,
  activation: 'whileHeld',
  transitionMs: 90,
  transitionEasing: 'linear',
  ...overrides,
});

// 진리표 기준 스프라이트: 키 요소 kA, kS, kD와 단일 자세 3개
const poseA = makePose('poseA', ['kA'], { x: 10, y: -30, rotation: -30 });
const poseS = makePose('poseS', ['kS'], {
  x: 20,
  y: 0,
  rotation: 0,
  scale: 2,
});
const poseD = makePose('poseD', ['kD'], {
  x: 60,
  y: 30,
  rotation: 30,
  scale: 3,
});

const baseSprite = makeSprite([poseA, poseS, poseD]);

const pressed = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('resolveSpriteTarget 진리표', () => {
  it('아무 키도 안 눌리면 idleTransform 참조와 baseImage를 반환한다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed());

    expect(result.transform).toBe(baseSprite.idleTransform);
    expect(result.imageSrc).toBe('base.png');
  });

  it('kA만 눌리면 poseA의 transform 참조를 그대로 반환한다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed('kA'));

    expect(result.transform).toBe(poseA.transform);
    expect(result.imageSrc).toBe('base.png');
  });

  it('kA와 kS가 눌리면 두 자세의 균등 평균을 낸다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed('kA', 'kS'));

    expect(result.transform.x).toBeCloseTo(15, 10);
    expect(result.transform.y).toBeCloseTo(-15, 10);
    expect(result.transform.scale).toBeCloseTo(1.5, 10);
    // -30과 0의 원형 평균은 -15
    expect(result.transform.rotation).toBeCloseTo(-15, 10);
  });

  it('kA, kS, kD가 눌리면 세 자세의 균등 평균을 낸다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed('kA', 'kS', 'kD'));

    expect(result.transform.x).toBeCloseTo(30, 10);
    expect(result.transform.y).toBeCloseTo(0, 10);
    expect(result.transform.scale).toBeCloseTo(2, 10);
    // -30, 0, 30의 원형 평균은 0
    expect(result.transform.rotation).toBeCloseTo(0, 10);
  });

  it('triggers 집합이 정확히 일치하는 조합 자세가 있으면 그대로 쓴다', () => {
    const comboAS = makePose('comboAS', ['kA', 'kS'], { x: 999, rotation: 45 });
    const sprite = makeSprite([poseA, poseS, poseD, comboAS]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    expect(result.transform).toBe(comboAS.transform);
    expect(result.imageSrc).toBe('base.png');
  });

  it('정확 일치가 실패하면 조합 자세를 빼고 단일 자세만 평균한다', () => {
    const comboAS = makePose('comboAS', ['kA', 'kS'], { x: 999, y: 999 });
    const sprite = makeSprite([poseA, poseS, poseD, comboAS]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS', 'kD'));

    // comboAS(x 999)가 섞이지 않은 세 단일 자세의 평균
    expect(result.transform.x).toBeCloseTo(30, 10);
    expect(result.transform.y).toBeCloseTo(0, 10);
    expect(result.transform.scale).toBeCloseTo(2, 10);
    expect(result.transform.rotation).toBeCloseTo(0, 10);
  });

  it('triggers 저장 순서가 달라도 집합으로 비교해 일치시킨다', () => {
    const comboSA = makePose('comboSA', ['kS', 'kA'], { x: 77 });
    const sprite = makeSprite([poseA, poseS, poseD, comboSA]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    expect(result.transform).toBe(comboSA.transform);
  });

  it('triggers의 중복 항목은 무시하고 집합으로 비교한다', () => {
    const comboDup = makePose('comboDup', ['kA', 'kA', 'kS'], { x: 55 });
    const sprite = makeSprite([poseA, poseS, poseD, comboDup]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    expect(result.transform).toBe(comboDup.transform);
  });

  it('rotation +170과 -170의 평균은 0이 아니라 +180이다', () => {
    const sprite = makeSprite([
      makePose('poseA', ['kA'], { rotation: 170 }),
      makePose('poseS', ['kS'], { rotation: -170 }),
    ]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    // atan2(+0, 음수)는 +180, 부호를 양수로 고정한다
    expect(result.transform.rotation).toBeCloseTo(180, 10);
    expect(result.transform.rotation).toBeLessThanOrEqual(180);
    expect(result.transform.rotation).toBeGreaterThanOrEqual(-180);
  });

  it('rotation -80과 +80의 평균은 0이다', () => {
    const sprite = makeSprite([
      makePose('poseA', ['kA'], { rotation: -80 }),
      makePose('poseS', ['kS'], { rotation: 80 }),
    ]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    expect(result.transform.rotation).toBeCloseTo(0, 10);
  });

  it('정반대 각 +90과 -90은 poseId 사전순 첫 자세의 rotation으로 폴백한다', () => {
    // 평균 벡터 길이가 1e-16 수준이라 atan2 방향이 무의미한 경우
    const sprite = makeSprite([
      makePose('poseA', ['kA'], { rotation: 90 }),
      makePose('poseS', ['kS'], { rotation: -90 }),
    ]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    expect(result.transform.rotation).toBe(90);
  });

  it('담당 밖 키만 눌리면 idle을 반환한다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed('kZ', 'kX'));

    expect(result.transform).toBe(baseSprite.idleTransform);
    expect(result.imageSrc).toBe('base.png');
  });

  it('죽은 키 id가 섞여도 나머지는 정상 해석한다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed('kA', 'ghost'));

    expect(result.transform).toBe(poseA.transform);
  });

  it('평균 imageSrc는 poseId 사전순 첫 imageOverride를 쓴다', () => {
    const sprite = makeSprite([
      makePose('poseA', ['kA'], {}, null),
      makePose('poseD', ['kD'], {}, 'pose-d.png'),
      makePose('poseS', ['kS'], {}, 'pose-s.png'),
    ]);

    // poseA는 override 없음, 사전순 다음인 poseD의 override 선택
    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS', 'kD'));

    expect(result.imageSrc).toBe('pose-d.png');
  });

  it('평균 참여 자세에 imageOverride가 하나도 없으면 baseImage를 쓴다', () => {
    const result = resolveSpriteTarget(baseSprite, pressed('kA', 'kS'));

    expect(result.imageSrc).toBe('base.png');
  });

  it('정확 일치 자세의 imageOverride ?? baseImage 규칙을 지킨다', () => {
    const withOverride = makePose('poseA', ['kA'], {}, 'pose-a.png');
    const sprite = makeSprite([withOverride, poseS]);

    expect(resolveSpriteTarget(sprite, pressed('kA')).imageSrc).toBe(
      'pose-a.png',
    );
    expect(resolveSpriteTarget(sprite, pressed('kS')).imageSrc).toBe(
      'base.png',
    );
  });

  it('Set 삽입 순서가 달라도 같은 집합이면 결과가 동일하다', () => {
    const forward = resolveSpriteTarget(
      baseSprite,
      new Set(['kA', 'kS', 'kD']),
    );
    const backward = resolveSpriteTarget(
      baseSprite,
      new Set(['kD', 'kS', 'kA']),
    );

    expect(backward).toEqual(forward);
  });

  it('활성 키가 조합 자세에만 속하면 평균 대상이 없어 idle로 처리한다', () => {
    const comboOnly = makeSprite([makePose('comboAS', ['kA', 'kS'], { x: 5 })]);

    const result = resolveSpriteTarget(comboOnly, pressed('kA'));

    expect(result.transform).toBe(comboOnly.idleTransform);
    expect(result.imageSrc).toBe('base.png');
  });

  it('중복 trigger를 가진 자세도 집합 크기 1이면 단일 자세로 평균에 참여한다', () => {
    const dupSingle = makePose('poseA', ['kA', 'kA'], { x: 10, y: -30 });
    const sprite = makeSprite([dupSingle, poseS]);

    const result = resolveSpriteTarget(sprite, pressed('kA', 'kS'));

    expect(result.transform.x).toBeCloseTo(15, 10);
    expect(result.transform.y).toBeCloseTo(-15, 10);
  });

  it('입력 스프라이트와 눌림 집합을 변경하지 않는다', () => {
    const sprite = makeSprite([poseD, poseA, poseS]);
    const originalOrder = sprite.poses.map((pose) => pose.poseId);
    const keys = new Set(['kA', 'kS']);

    resolveSpriteTarget(sprite, keys);

    expect(sprite.poses.map((pose) => pose.poseId)).toEqual(originalOrder);
    expect([...keys]).toEqual(['kA', 'kS']);
  });
});
