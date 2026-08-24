import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTE_SETTINGS_CONSTRAINTS } from '@src/types/settings/noteSettingsConstraints';
import { createNoteBuffer } from './noteBuffer';

const layoutFor = (trackKey: string) => ({
  trackKey,
  trackIndex: 0,
  position: { dx: 10, dy: 20 },
  width: 60,
  height: 60,
  noteColor: '#FFFFFF',
  noteOpacity: 80,
});

describe('NoteBuffer 시각 저장', () => {
  it('서브 프레임 노트 시작 시각을 프레임 단위로 양자화하지 않고 보존한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);

    buffer.allocate('Z', 'note-1', 1000.25);
    buffer.allocate('Z', 'note-2', 1004.75);

    expect(buffer.noteInfo[0]).toBeCloseTo(1000.25, 3);
    expect(buffer.noteInfo[3]).toBeCloseTo(1004.75, 3);
    expect(buffer.noteInfo[3] - buffer.noteInfo[0]).toBeCloseTo(4.5, 3);
  });

  it('한도 초과 시 epoch를 이동하고 저장 시각을 재기준화한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);

    buffer.allocate('Z', 'note-1', 1000.25);
    buffer.allocate('Z', 'note-2', 1004.75);

    expect(buffer.maybeRebaseEpoch(3_000_000)).toBe(true);
    expect(buffer.timeEpoch).toBe(3_000_000);
    // 상대값으로 이동하되 서브 프레임 간격은 보존
    expect(buffer.noteInfo[0]).toBeCloseTo(1000.25 - 3_000_000, 2);
    expect(buffer.noteInfo[3] - buffer.noteInfo[0]).toBeCloseTo(4.5, 3);

    // 이후 저장은 epoch 상대값 - 큰 절대값이 Float32에 들어가지 않음
    buffer.allocate('Z', 'note-3', 3_000_100.5);
    expect(buffer.noteInfo[6]).toBeCloseTo(100.5, 3);
    buffer.finalize('note-3', 3_000_150.25);
    expect(buffer.noteInfo[7]).toBeCloseTo(150.25, 3);
  });

  it('한도 이내에서는 재기준화하지 않는다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);
    buffer.allocate('Z', 'note-1', 500);

    expect(buffer.maybeRebaseEpoch(524_288)).toBe(false);
    expect(buffer.timeEpoch).toBe(0);
    expect(buffer.noteInfo[0]).toBe(500);
  });

  it('Float32 간격이 설정 가능한 최소 노트 길이보다 작다', () => {
    const rebaseLimitMs = 2 ** 19;
    const float32SpacingMs = 2 ** (Math.floor(Math.log2(rebaseLimitMs)) - 23);
    const minimumNoteLengthMs =
      (NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.min * 1000) /
      NOTE_SETTINGS_CONSTRAINTS.speed.max;

    expect(bufferAtEpochBoundary(rebaseLimitMs)).toBe(false);
    expect(bufferAtEpochBoundary(rebaseLimitMs + 1)).toBe(true);
    expect(float32SpacingMs).toBe(0.0625);
    expect(minimumNoteLengthMs).toBeGreaterThan(float32SpacingMs);
  });

  it('이전 한도에서도 최소 노트 길이가 0으로 양자화되지 않는다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);
    const startTime = 2 ** 21;
    const minimumNoteLengthMs =
      (NOTE_SETTINGS_CONSTRAINTS.shortNoteMinLengthPx.min * 1000) /
      NOTE_SETTINGS_CONSTRAINTS.speed.max;

    buffer.allocate('Z', 'note-1', startTime);
    buffer.finalize('note-1', startTime + minimumNoteLengthMs);

    expect(buffer.noteInfo[1] - buffer.noteInfo[0]).toBeGreaterThan(0);
  });

  it('장시간 유휴 후 첫 할당은 자동 재기준화되고 sentinel 0을 피한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);

    buffer.allocate('Z', 'note-1', 5_000_000);

    expect(buffer.timeEpoch).toBe(5_000_000);
    // startTime 0.0은 빈 슬롯 sentinel - 정확히 0이 되면 안 됨
    expect(buffer.noteInfo[0]).not.toBe(0);
    expect(Math.abs(buffer.noteInfo[0])).toBeLessThan(1);
  });

  it('재기준화 후 활성 노트의 finalize도 같은 기준을 쓴다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);

    buffer.allocate('Z', 'note-1', 2_000_000);
    buffer.maybeRebaseEpoch(4_200_000);
    buffer.finalize('note-1', 4_200_050);

    // 길이(end - start)가 물리 시간과 일치
    expect(buffer.noteInfo[1] - buffer.noteInfo[0]).toBeCloseTo(2_200_050, 0);
    expect(buffer.noteInfo[1]).toBeCloseTo(50, 3);
  });
});

const bufferAtEpochBoundary = (nowMs: number): boolean => {
  const buffer = createNoteBuffer();
  return buffer.maybeRebaseEpoch(nowMs);
};

const gradientLayout = (
  trackKey: string,
  stops: Array<{ color: string; pos: number }>,
  angle = 90,
) => ({
  ...layoutFor(trackKey),
  noteBorderWidth: 2,
  noteBorderColor: '#FF0080',
  noteBorderGradient: { angle, stops },
});

describe('NoteBuffer 테두리 그라데이션 LUT', () => {
  const stopsA = [
    { color: '#FF0000', pos: 0 },
    { color: '#0000FF', pos: 1 },
  ];
  const stopsB = [
    { color: '#00FF00', pos: 0 },
    { color: '#000000', pos: 1 },
  ];

  it('allocate가 행 인덱스와 각도 라디안을 attribute에 기록한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([gradientLayout('Z', stopsA, 180)]);
    buffer.allocate('Z', 'note-1', 1000);

    expect(buffer.noteBorderGradientInfo[0]).toBe(0);
    expect(buffer.noteBorderGradientInfo[1]).toBeCloseTo(Math.PI, 5);
  });

  it('그라데이션 없는 트랙은 -1 (단색 경로)', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z')]);
    buffer.allocate('Z', 'note-1', 1000);

    expect(buffer.noteBorderGradientInfo[0]).toBe(-1);
  });

  it('같은 스톱 배열은 각도가 달라도 같은 행을 공유한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([
      gradientLayout('Z', stopsA, 0),
      gradientLayout('X', stopsA, 270),
    ]);
    buffer.allocate('Z', 'note-1', 1000);
    buffer.allocate('X', 'note-2', 1001);

    expect(buffer.noteBorderGradientInfo[0]).toBe(
      buffer.noteBorderGradientInfo[2],
    );
    expect(buffer.noteBorderGradientInfo[1]).not.toBeCloseTo(
      buffer.noteBorderGradientInfo[3],
      3,
    );
  });

  it('스톱이 다르면 새 행을 append한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([
      gradientLayout('Z', stopsA),
      gradientLayout('X', stopsB),
    ]);
    buffer.allocate('Z', 'note-1', 1000);
    buffer.allocate('X', 'note-2', 1001);

    const rows = [
      buffer.noteBorderGradientInfo[0],
      buffer.noteBorderGradientInfo[2],
    ].sort();
    expect(rows).toEqual([0, 1]);
  });

  it('premultiplied sRGB 보간을 저장한다 (투명 스톱 halo 방지)', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([
      gradientLayout('Z', [
        { color: 'rgba(255,0,0,0)', pos: 0 },
        { color: 'rgba(255,0,0,1)', pos: 1 },
      ]),
    ]);

    // 중앙 텍셀: premultiplied r ≈ 128, alpha ≈ 128 (straight 보간이면 r=255)
    const mid = 128 * 4;
    expect(buffer.gradientLUT[mid]).toBeGreaterThan(120);
    expect(buffer.gradientLUT[mid]).toBeLessThan(136);
    expect(buffer.gradientLUT[mid + 3]).toBeGreaterThan(120);
    expect(buffer.gradientLUT[mid + 3]).toBeLessThan(136);
    // 끝 텍셀: 불투명 순수 빨강
    const last = 255 * 4;
    expect(buffer.gradientLUT[last]).toBe(255);
    expect(buffer.gradientLUT[last + 3]).toBe(255);
  });

  it('참조 노트가 없으면 다음 레이아웃 갱신에서 팔레트를 리셋한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([gradientLayout('Z', stopsA)]);
    buffer.updateTrackLayouts([gradientLayout('Z', stopsB)]);
    const versionAfterGrowth = buffer.gradientLUTVersion;

    // 노트가 없으므로 리셋 후 행 0부터 재등록
    buffer.updateTrackLayouts([gradientLayout('Z', stopsB)]);
    expect(buffer.gradientLUTVersion).toBeGreaterThan(versionAfterGrowth);
    buffer.allocate('Z', 'note-1', 1000);
    expect(buffer.noteBorderGradientInfo[0]).toBe(0);
  });

  it('활성 노트가 있으면 리셋하지 않고 옛 행을 보존한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([gradientLayout('Z', stopsA)]);
    buffer.allocate('Z', 'note-1', 1000);

    buffer.updateTrackLayouts([gradientLayout('Z', stopsB)]);
    buffer.allocate('Z', 'note-2', 1001);

    expect(buffer.noteBorderGradientInfo[0]).toBe(0);
    expect(buffer.noteBorderGradientInfo[2]).toBe(1);
  });

  it('공유 fixture의 모든 유효 색을 래스터라이저가 실제로 파싱한다', () => {
    // 검증은 통과하는데 렌더가 흰색 폴백으로 새는 도메인 분열 방지
    const fixture = JSON.parse(
      readFileSync(
        join(
          __dirname,
          '../../../../tests/fixtures/note-border-stop-colors.json',
        ),
        'utf-8',
      ),
    ) as { valid: Array<{ input: string; representative: string }> };

    for (const { input, representative } of fixture.valid) {
      const buffer = createNoteBuffer();
      buffer.updateTrackLayouts([
        gradientLayout('Z', [
          { color: input, pos: 0 },
          { color: input, pos: 1 },
        ]),
      ]);
      const expected = {
        r: parseInt(representative.slice(1, 3), 16),
        g: parseInt(representative.slice(3, 5), 16),
        b: parseInt(representative.slice(5, 7), 16),
      };
      // premultiplied 저장이라 대표 RGB는 알파를 곱한 값과 일치해야 한다
      const alpha = buffer.gradientLUT[3] / 255;
      expect(buffer.gradientLUT[0], input).toBe(Math.round(expected.r * alpha));
      expect(buffer.gradientLUT[1], input).toBe(Math.round(expected.g * alpha));
      expect(buffer.gradientLUT[2], input).toBe(Math.round(expected.b * alpha));
    }
  });

  it('레이아웃 갱신 없이도 만석 다운그레이드에서 회복한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([gradientLayout('Z', stopsA)]);
    buffer.allocate('Z', 'hold', 1000);
    for (let i = 0; i < 256; i += 1) {
      const g = i.toString(16).padStart(2, '0');
      buffer.updateTrackLayouts([
        gradientLayout('Z', [
          { color: `#00${g}00`, pos: 0 },
          { color: '#FFFFFF', pos: 1 },
        ]),
      ]);
    }
    buffer.allocate('Z', 'over', 1001);
    expect(buffer.noteBorderGradientInfo[2]).toBe(-1);

    // 레이아웃 갱신 없이 참조가 비워진 뒤 첫 allocate가 팔레트를 재구축
    buffer.release('hold');
    buffer.release('over');
    buffer.allocate('Z', 'fresh', 1002);
    expect(buffer.noteBorderGradientInfo[0]).toBe(0);
  });

  it('용량 초과 시 -1로 다운그레이드하고 유휴 리셋 후 회복한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([gradientLayout('Z', stopsA)]);
    buffer.allocate('Z', 'hold', 1000);

    // 활성 노트가 행 리셋을 막는 동안 고유 스톱으로 용량을 소진
    for (let i = 0; i < 256; i += 1) {
      const g = (i % 256).toString(16).padStart(2, '0');
      const b = Math.floor(i / 256)
        .toString(16)
        .padStart(2, '0');
      buffer.updateTrackLayouts([
        gradientLayout('Z', [
          { color: `#00${g}${b}`, pos: 0 },
          { color: '#FFFFFF', pos: 1 },
        ]),
      ]);
    }
    buffer.allocate('Z', 'over', 1001);
    expect(buffer.noteBorderGradientInfo[2]).toBe(-1);

    buffer.release('hold');
    buffer.release('over');
    buffer.updateTrackLayouts([gradientLayout('Z', stopsB)]);
    buffer.allocate('Z', 'fresh', 1002);
    expect(buffer.noteBorderGradientInfo[0]).toBe(0);
  });

  it('release 시프트가 그라데이션 attribute를 함께 이동한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([
      gradientLayout('Z', stopsA, 45),
      gradientLayout('X', stopsB, 315),
    ]);
    buffer.allocate('Z', 'note-1', 1000);
    buffer.allocate('X', 'note-2', 1001);
    const secondRow = buffer.noteBorderGradientInfo[2];
    const secondAngle = buffer.noteBorderGradientInfo[3];

    buffer.release('note-1');

    expect(buffer.noteBorderGradientInfo[0]).toBe(secondRow);
    expect(buffer.noteBorderGradientInfo[1]).toBeCloseTo(secondAngle, 5);
    // 비운 슬롯은 단색 sentinel로 초기화
    expect(buffer.noteBorderGradientInfo[2]).toBe(-1);
  });
});
