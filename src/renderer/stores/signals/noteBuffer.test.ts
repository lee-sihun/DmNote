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

describe('NoteBuffer noteDir 인스턴스 속성', () => {
  const directedLayout = (
    trackKey: string,
    direction: 'up' | 'down' | 'left' | 'right',
    trackIndex = 0,
  ) => ({
    ...layoutFor(trackKey),
    trackIndex,
    direction,
  });

  it('allocate가 트랙 방향 벡터를 스냅샷한다 (미지정 = up)', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([layoutFor('Z'), directedLayout('X', 'left', 1)]);

    buffer.allocate('Z', 'note-up', 1000);
    buffer.allocate('X', 'note-left', 1001);

    expect([buffer.noteDir[0], buffer.noteDir[1]]).toEqual([0, -1]);
    expect([buffer.noteDir[2], buffer.noteDir[3]]).toEqual([-1, 0]);
  });

  it('release 시프트가 noteDir 정렬을 유지한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([
      directedLayout('A', 'down', 0),
      directedLayout('B', 'right', 1),
    ]);
    buffer.allocate('A', 'note-a', 1000);
    buffer.allocate('B', 'note-b', 1001);

    buffer.release('note-a');

    expect([buffer.noteDir[0], buffer.noteDir[1]]).toEqual([1, 0]);
    expect([buffer.noteDir[2], buffer.noteDir[3]]).toEqual([0, 0]);
  });

  it('releaseBatch 압축과 clear가 noteDir를 정리한다', () => {
    const buffer = createNoteBuffer();
    buffer.updateTrackLayouts([
      directedLayout('A', 'down', 0),
      directedLayout('B', 'left', 1),
      directedLayout('C', 'right', 2),
    ]);
    buffer.allocate('A', 'note-a', 1000);
    buffer.allocate('B', 'note-b', 1001);
    buffer.allocate('C', 'note-c', 1002);

    buffer.releaseBatch(['note-a', 'note-c']);
    // 생존한 note-b(left)가 앞으로 압축되고 잔여 슬롯은 0
    expect([buffer.noteDir[0], buffer.noteDir[1]]).toEqual([-1, 0]);
    expect([buffer.noteDir[2], buffer.noteDir[3]]).toEqual([0, 0]);
    expect([buffer.noteDir[4], buffer.noteDir[5]]).toEqual([0, 0]);

    buffer.clear();
    expect(buffer.noteDir.every((v) => v === 0)).toBe(true);
  });
});
