import { describe, it, expect } from 'vitest';
import {
  canonicalGradientOrNull,
  canonicalizePositionGradients,
  counterFillPair,
  gradientPairPatch,
  gradientToCss,
  hexRepresentative,
  isStrictStopColor,
  resolveStatePair,
  toCanonicalGradient,
  toCompactRgba,
} from './color';
import { canonicalizeEditorGradients } from './editor';
import type { EditorPatchV1 } from './editor';

describe('toCanonicalGradient', () => {
  it('angle 정규화 (450 → 90, -90 → 270)', () => {
    expect(
      toCanonicalGradient({ angle: 450, stops: [c('#000', 0), c('#fff', 1)] })
        .angle,
    ).toBe(90);
    expect(
      toCanonicalGradient({ angle: -90, stops: [c('#000', 0), c('#fff', 1)] })
        .angle,
    ).toBe(270);
  });

  it('stops 정렬·클램프', () => {
    const spec = toCanonicalGradient({
      stops: [c('#a', 1.2), c('#b', -0.5), c('#c', 0.5)],
    });
    expect(spec.stops.map((s) => s.pos)).toEqual([0, 0.5, 1]);
    expect(spec.stops.map((s) => s.color)).toEqual(['#b', '#c', '#a']);
    expect(spec.angle).toBe(90);
  });
});

describe('canonicalGradientOrNull — Rust 경계 drop/repair 규칙 일치', () => {
  it('정상 spec은 canonical로 정규화', () => {
    expect(
      canonicalGradientOrNull({
        angle: 450,
        stops: [c('#fff', 1.5), c('#000', 0)],
      }),
    ).toEqual({
      angle: 90,
      stops: [c('#000', 0), c('#fff', 1)],
    });
  });

  it('타입 불일치는 통째 drop', () => {
    expect(canonicalGradientOrNull('linear-gradient(...)')).toBeNull();
    expect(canonicalGradientOrNull({ angle: '90', stops: [] })).toBeNull();
    expect(
      canonicalGradientOrNull({ stops: [c('#fff', 0), { color: 5, pos: 1 }] }),
    ).toBeNull();
    expect(canonicalGradientOrNull({ stops: [c('#fff', 0)] })).toBeNull();
  });
});

describe('canonicalizePositionGradients', () => {
  it('변경 없으면 동일 참조 (base = 첫 스톱)', () => {
    const pos = {
      backgroundColor: '#a',
      backgroundGradient: toCanonicalGradient({
        angle: 90,
        stops: [c('#a', 0), c('#b', 1)],
      }),
    };
    expect(canonicalizePositionGradients(pos)).toBe(pos);
  });

  it('손상 필드만 drop하고 base 색은 보존', () => {
    const pos = {
      backgroundColor: '#fff',
      backgroundGradient: { stops: [c('#a', 0)] },
      borderGradient: { angle: 450, stops: [c('#a', 0), c('#b', 1)] },
    };
    const next = canonicalizePositionGradients(pos);
    expect(next).not.toBe(pos);
    expect('backgroundGradient' in next).toBe(false);
    expect(next.backgroundColor).toBe('#fff');
    expect(next.borderGradient).toEqual({
      angle: 90,
      stops: [c('#a', 0), c('#b', 1)],
    });
  });

  it('counter fill gradient도 함께 정규화', () => {
    const pos = {
      counter: {
        fill: { idle: '#fff', active: '#000' },
        fillIdleGradient: { angle: 720, stops: [c('#a', 0), c('#b', 1)] },
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect(
      (next.counter as { fillIdleGradient?: { angle: number } })
        .fillIdleGradient?.angle,
    ).toBe(0);
  });

  it('gradient Some이면 base를 첫 스톱으로 repair (Rust 미러)', () => {
    const pos = {
      backgroundColor: '#stale',
      backgroundGradient: {
        angle: 90,
        stops: [c('#ABCDEF', 0), c('#000', 1)],
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect(next.backgroundColor).toBe('#ABCDEF');
  });

  it('counter fill base는 compact rgba로 repair', () => {
    const pos = {
      counter: {
        fill: { idle: '#stale', active: '#000' },
        fillIdleGradient: {
          angle: 90,
          stops: [c('#FFFFFF', 0), c('#000', 1)],
        },
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect((next.counter as { fill: { idle: string } }).fill.idle).toBe(
      'rgba(255,255,255,1)',
    );
    expect((next.counter as { fill: { active: string } }).fill.active).toBe(
      '#000',
    );
  });
});

describe('canonicalizeEditorGradients — patch 공통 canonical (계약 v2.3)', () => {
  it('keyPositions의 비정규 spec을 canonical로', () => {
    const patch: EditorPatchV1 = {
      schemaVersion: 1,
      keyPositions: {
        '4key': [
          {
            dx: 0,
            dy: 0,
            width: 60,
            height: 60,
            backgroundColor: '#fff',
            backgroundGradient: {
              angle: 450,
              stops: [c('#b', 1), c('#a', 0)],
            },
          },
        ],
      } as unknown as EditorPatchV1['keyPositions'],
    };
    const canonical = canonicalizeEditorGradients(patch);
    expect(canonical).not.toBe(patch);
    const item = canonical.keyPositions!['4key'][0] as Record<string, unknown>;
    expect(item.backgroundGradient).toEqual({
      angle: 90,
      stops: [c('#a', 0), c('#b', 1)],
    });
  });

  it('변경 없으면 동일 참조', () => {
    const patch: EditorPatchV1 = {
      schemaVersion: 1,
      keyPositions: {
        '4key': [{ dx: 0, dy: 0, width: 60, height: 60 }],
      } as unknown as EditorPatchV1['keyPositions'],
    };
    expect(canonicalizeEditorGradients(patch)).toBe(patch);
  });
});

describe('gradientPairPatch / counterFillPair', () => {
  it('단색 전환은 base 갱신 + sibling 제거를 한 patch로', () => {
    const patch = gradientPairPatch('backgroundColor', {
      mode: 'solid',
      color: '#123456',
    });
    expect(patch.backgroundColor).toBe('#123456');
    expect('backgroundGradient' in patch).toBe(true);
    expect(patch.backgroundGradient).toBeUndefined();
  });

  it('그라데이션 커밋은 base = 첫 스톱 원문', () => {
    const patch = gradientPairPatch('borderColor', {
      mode: 'gradient',
      spec: { angle: 90, stops: [c('#ABCDEF', 0), c('#000', 1)] },
    });
    expect(patch.borderColor).toBe('#ABCDEF');
  });

  it('counter fill 대표색은 compact canonical rgba', () => {
    const pair = counterFillPair({
      mode: 'gradient',
      spec: { angle: 90, stops: [c('#FFFFFF', 0), c('#000', 1)] },
    });
    expect(pair.color).toBe('rgba(255,255,255,1)');
    expect(pair.gradient?.angle).toBe(90);
  });
});

describe('toCompactRgba', () => {
  it('hex/rgb/rgba를 무공백 소문자 rgba로', () => {
    expect(toCompactRgba('#FFFFFF')).toBe('rgba(255,255,255,1)');
    expect(toCompactRgba('rgb(1, 2, 3)')).toBe('rgba(1,2,3,1)');
    expect(toCompactRgba('rgba(1, 2, 3, 0.50)')).toBe('rgba(1,2,3,0.5)');
    // 절반값 양자화 — Rust (a*10000).round()와 동일 (toFixed는 0.0187로 발산)
    expect(toCompactRgba('rgba(1, 2, 3, 0.01875)')).toBe('rgba(1,2,3,0.0188)');
    // 비정상 채널은 원문 유지 (Rust parse 실패 동작)
    expect(toCompactRgba('rgba(1.2.3, 4, 5, 1)')).toBe('rgba(1.2.3, 4, 5, 1)');
  });

  it('파싱 불가 색은 원문 유지', () => {
    expect(toCompactRgba('tomato')).toBe('tomato');
  });
});

describe('resolveStatePair / gradientToCss', () => {
  it('active 쌍에 값이 하나라도 있으면 쌍 전체 사용', () => {
    const idle = {
      color: '#111',
      gradient: toCanonicalGradient({ stops: [c('#a', 0), c('#b', 1)] }),
    };
    expect(resolveStatePair(true, idle, { color: '#222' })).toEqual({
      color: '#222',
    });
    expect(resolveStatePair(true, idle, {})).toBe(idle);
    expect(resolveStatePair(true, idle, { color: '  ' })).toBe(idle);
    expect(resolveStatePair(false, idle, { color: '#222' })).toBe(idle);
  });

  it('linear-gradient CSS 생성', () => {
    expect(
      gradientToCss({ angle: 45, stops: [c('#a', 0), c('#b', 0.333)] }),
    ).toBe('linear-gradient(45deg, #a 0%, #b 33.3%)');
  });
});

describe('isStrictStopColor — 노트 테두리 스톱 문법 (계약 v2 §2A)', () => {
  it('허용 형태', () => {
    for (const value of [
      '#abc',
      '#ABCD',
      '#AbCdEf',
      '#abcdef12',
      'rgb(0, 128, 255)',
      'rgb(0,128,255)',
      'RGBA(255, 255, 255, 0.5)',
      'rgba(0,0,0,1)',
      'rgba(0,0,0,0)',
    ]) {
      expect(isStrictStopColor(value), value).toBe(true);
    }
  });

  it('불허 형태', () => {
    for (const value of [
      'tomato',
      'transparent',
      '#abcde',
      'rgb(256,0,0)',
      'rgb(0000,0,0)',
      'rgb (0,0,0)',
      'rgb(0,0,0,1)',
      'rgba(0,0,0)',
      'rgba(0,0,0,1.1)',
      'rgba(0,0,0,-0.1)',
      'rgba(0,0,0,1.)',
      'rgba(0,0,0,1e-1)',
      'rgba(0,0,0,50%)',
      'rgba(0;0;0;1)',
      'hsl(0,0%,0%)',
    ]) {
      expect(isStrictStopColor(value), value).toBe(false);
    }
  });
});

describe('hexRepresentative — 대표색 hex 변환', () => {
  it('축약·알파 hex와 rgba를 #RRGGBB 대문자로', () => {
    expect(hexRepresentative('#abc')).toBe('#AABBCC');
    expect(hexRepresentative('#abcd')).toBe('#AABBCC');
    expect(hexRepresentative('#abcdef12')).toBe('#ABCDEF');
    expect(hexRepresentative('rgba(255, 0, 128, 0.5)')).toBe('#FF0080');
    expect(hexRepresentative('rgb(0,0,0)')).toBe('#000000');
  });

  it('문법 밖은 null', () => {
    expect(hexRepresentative('tomato')).toBeNull();
    expect(hexRepresentative('rgb(300,0,0)')).toBeNull();
  });
});

describe('canonicalizePositionGradients — 노트 테두리 쌍', () => {
  it('대표색은 hex 전용으로 repair (rgba→hex 마이그레이션 핑퐁 방지)', () => {
    const pos = {
      noteBorderColor: '#stale',
      noteBorderGradient: {
        angle: 90,
        stops: [c('rgba(255,0,128,0.5)', 0), c('#000000', 1)],
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect(next.noteBorderColor).toBe('#FF0080');
    expect(next.noteBorderGradient).toEqual(pos.noteBorderGradient);
  });

  it('§2A 밖 스톱이 있으면 필드 drop + base 유지', () => {
    const pos = {
      noteBorderColor: '#FFFFFF',
      noteBorderGradient: {
        angle: 90,
        stops: [c('#000000', 0), c('tomato', 1)],
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect('noteBorderGradient' in next).toBe(false);
    expect(next.noteBorderColor).toBe('#FFFFFF');
  });

  it('절단으로 잘려 나갈 9번째 불허 스톱도 drop을 일으킨다 (Rust 원본 검사 미러)', () => {
    const stops = Array.from({ length: 8 }, (_, i) =>
      c(`#11223${i}`, i / 10),
    ).concat([c('transparent', 1)]);
    const pos = {
      noteBorderColor: '#112230',
      noteBorderGradient: { angle: 90, stops },
    };
    const next = canonicalizePositionGradients(pos);
    expect('noteBorderGradient' in next).toBe(false);
    expect(next.noteBorderColor).toBe('#112230');
  });

  it('null은 canonical None으로 필드 제거', () => {
    const pos = { noteBorderColor: '#FFFFFF', noteBorderGradient: null };
    const next = canonicalizePositionGradients(pos);
    expect('noteBorderGradient' in next).toBe(false);
  });

  it('변경 없으면 동일 참조', () => {
    const pos = {
      noteBorderColor: '#FF0080',
      noteBorderGradient: toCanonicalGradient({
        angle: 90,
        stops: [c('rgba(255,0,128,1)', 0), c('#000000', 1)],
      }),
    };
    expect(canonicalizePositionGradients(pos)).toBe(pos);
  });
});

describe('canonicalizePositionGradients — counter stroke 쌍', () => {
  it('stroke 대표색은 compact rgba로 repair', () => {
    const pos = {
      counter: {
        stroke: { idle: '#stale', active: '#000' },
        strokeIdleGradient: {
          angle: 90,
          stops: [c('#FFFFFF', 0), c('#000', 1)],
        },
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect((next.counter as { stroke: { idle: string } }).stroke.idle).toBe(
      'rgba(255,255,255,1)',
    );
    expect((next.counter as { stroke: { active: string } }).stroke.active).toBe(
      '#000',
    );
  });

  it('손상 stroke gradient는 필드만 drop', () => {
    const pos = {
      counter: {
        stroke: { idle: 'transparent', active: 'transparent' },
        strokeActiveGradient: { stops: [c('#fff', 0)] },
      },
    };
    const next = canonicalizePositionGradients(pos);
    expect('strokeActiveGradient' in (next.counter as object)).toBe(false);
    expect((next.counter as { stroke: { idle: string } }).stroke.idle).toBe(
      'transparent',
    );
  });
});

function c(color: string, pos: number) {
  return { color, pos };
}
