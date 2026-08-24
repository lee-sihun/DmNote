import { describe, expect, it } from 'vitest';
import {
  isNotePaintValuePatchV1,
  legacyNoteColorToSpec,
  notePaintShadowColor,
  notePaintShadowOpacity,
  projectNotePaintPatch,
} from './notePaint';

const spec = {
  angle: 90,
  stops: [
    { color: 'rgba(255,0,128,0.5)', pos: 0 },
    { color: '#001122', pos: 1 },
  ],
};

const shadow = { type: 'gradient', top: '#FF0080', bottom: '#001122' } as const;

describe('notePaint full descriptor 검증 (계약 §9-5)', () => {
  it('gradient 객체는 정확한 shadow 객체와 배율을 요구한다', () => {
    expect(
      isNotePaintValuePatchV1({ color: shadow, opacity: 80, gradient: spec }),
    ).toBe(true);
    // shadow 불일치
    expect(
      isNotePaintValuePatchV1({
        color: { ...shadow, top: '#FF0081' },
        opacity: 80,
        gradient: spec,
      }),
    ).toBe(false);
    // 문자열 color와 gradient 객체 조합 불허
    expect(
      isNotePaintValuePatchV1({
        color: '#FF0080',
        opacity: 80,
        gradient: spec,
      }),
    ).toBe(false);
  });

  it('gradient null은 단색 문자열 확정', () => {
    expect(
      isNotePaintValuePatchV1({
        color: '#FFFFFF',
        opacity: 50,
        gradient: null,
      }),
    ).toBe(true);
    expect(
      isNotePaintValuePatchV1({ color: shadow, opacity: 50, gradient: null }),
    ).toBe(false);
  });

  it('§2A 밖 스톱은 거부', () => {
    expect(
      isNotePaintValuePatchV1({
        color: shadow,
        opacity: 80,
        gradient: {
          angle: 90,
          stops: [
            { color: 'tomato', pos: 0 },
            { color: '#001122', pos: 1 },
          ],
        },
      }),
    ).toBe(false);
  });

  it('기존 3형태는 그대로 통과한다', () => {
    expect(isNotePaintValuePatchV1({ color: '#FFFFFF' })).toBe(true);
    expect(isNotePaintValuePatchV1({ opacity: 80 })).toBe(true);
    expect(
      isNotePaintValuePatchV1({
        opacity: 80,
        opacityTop: 90,
        opacityBottom: 70,
      }),
    ).toBe(true);
  });
});

describe('projectNotePaintPatch 전이 표 (계약 §9-5)', () => {
  it('descriptor gradient는 배율·shadow 4필드를 원자 투영한다', () => {
    const projected = projectNotePaintPatch({
      property: 'notePaint',
      value: { color: shadow, opacity: 80, gradient: spec },
    });
    expect(projected.noteColor).toEqual(shadow);
    expect(projected.noteOpacity).toBe(80);
    // 첫 스톱 알파 0.5 × 80 = 40, 끝 스톱 알파 1 × 80 = 80
    expect(projected.noteOpacityTop).toBe(40);
    expect(projected.noteOpacityBottom).toBe(80);
    expect(projected.noteGradient).toEqual(spec);
  });

  it('descriptor null은 단색 확정 + 투명도 동일값', () => {
    const projected = projectNotePaintPatch({
      property: 'noteGlowPaint',
      value: { color: '#123456', opacity: 60, gradient: null },
    });
    expect(projected.noteGlowColor).toBe('#123456');
    expect(projected.noteGlowOpacity).toBe(60);
    expect(projected.noteGlowOpacityTop).toBe(60);
    expect(projected.noteGlowOpacityBottom).toBe(60);
    expect(projected.noteGlowGradient).toBeUndefined();
    expect('noteGlowGradient' in projected).toBe(true);
  });

  it('기존 {color}와 3필드 투명도는 sibling을 제거한다', () => {
    const colorPatch = projectNotePaintPatch({
      property: 'notePaint',
      value: { color: '#FFFFFF' },
    });
    expect('noteGradient' in colorPatch).toBe(true);
    expect(colorPatch.noteGradient).toBeUndefined();

    const profilePatch = projectNotePaintPatch({
      property: 'notePaint',
      value: { opacity: 80, opacityTop: 90, opacityBottom: 70 },
    });
    expect('noteGradient' in profilePatch).toBe(true);
    expect(profilePatch.noteGradient).toBeUndefined();
  });

  it('{opacity} 단독은 sibling을 건드리지 않는다 (배율 갱신)', () => {
    const projected = projectNotePaintPatch({
      property: 'notePaint',
      value: { opacity: 55 },
    });
    expect(projected).toEqual({ noteOpacity: 55 });
  });

  it('{opacity} 단독 + position sibling은 shadow 4필드를 함께 투영한다 (Rust 미러)', () => {
    const projected = projectNotePaintPatch(
      { property: 'notePaint', value: { opacity: 50 } },
      { noteGradient: spec },
    );
    expect(projected.noteOpacity).toBe(50);
    expect(projected.noteColor).toEqual(shadow);
    expect(projected.noteOpacityTop).toBe(25);
    expect(projected.noteOpacityBottom).toBe(50);
    expect('noteGradient' in projected).toBe(false);
  });
});

describe('legacyNoteColorToSpec (계약 §9-6 매핑)', () => {
  it('구형 top/bottom과 프로파일을 2스톱 spec으로', () => {
    const converted = legacyNoteColorToSpec(
      { type: 'gradient', top: '#FF0080', bottom: '#001122' },
      50,
      100,
    );
    expect(converted).toEqual({
      angle: 180,
      stops: [
        { color: 'rgba(255,0,128,0.5)', pos: 0 },
        { color: '#001122', pos: 1 },
      ],
    });
  });

  it('단색·환원 불가 색은 null', () => {
    expect(legacyNoteColorToSpec('#FFFFFF', 80, 80)).toBeNull();
    expect(
      legacyNoteColorToSpec(
        { type: 'gradient', top: 'tomato', bottom: '#001122' },
        80,
        80,
      ),
    ).toBeNull();
  });
});

describe('shadow 산출 헬퍼', () => {
  it('첫/끝 스톱 대문자 hex와 배율 곱 반올림', () => {
    expect(notePaintShadowColor(spec)).toEqual(shadow);
    expect(notePaintShadowOpacity(spec, 80)).toEqual({ top: 40, bottom: 80 });
    expect(notePaintShadowOpacity(spec, 0)).toEqual({ top: 0, bottom: 0 });
  });
});
