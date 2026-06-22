import { describe, expect, it } from 'vitest';
import { createNoteBuffer } from './noteBuffer';

describe('NoteBuffer', () => {
  it('keeps note border opacity independent from note body opacity', () => {
    const buffer = createNoteBuffer();

    buffer.updateTrackLayouts([
      {
        trackKey: 'Z',
        trackIndex: 0,
        position: { dx: 10, dy: 20 },
        width: 60,
        height: 60,
        noteColor: '#24BBB4',
        noteOpacity: 0,
        noteOpacityTop: 0,
        noteOpacityBottom: 0,
        noteBorderColor: '#FFFFFF',
        noteBorderOpacity: 100,
        noteBorderWidth: 12,
      },
    ]);

    const index = buffer.allocate('Z', 'note-z', 1234.5);

    expect(index).toBe(0);
    expect(buffer.noteColorTop[3]).toBe(0);
    expect(buffer.noteColorBottom[3]).toBe(0);
    expect(buffer.noteBorderOpacity[0]).toBe(1);
    expect(buffer.noteBorder[0]).toBe(12);
  });

  it('stores semi-transparent border alpha separately from solid note alpha', () => {
    const buffer = createNoteBuffer();

    buffer.updateTrackLayouts([
      {
        trackKey: 'X',
        trackIndex: 0,
        position: { dx: 10, dy: 20 },
        width: 60,
        height: 60,
        noteColor: '#FFFFFF',
        noteOpacity: 100,
        noteBorderColor: '#FF0000',
        noteBorderOpacity: 50,
        noteBorderWidth: 8,
      },
    ]);

    buffer.allocate('X', 'note-x', 2000);

    expect(buffer.noteColorTop[3]).toBe(1);
    expect(buffer.noteColorBottom[3]).toBe(1);
    expect(buffer.noteBorderOpacity[0]).toBe(0.5);
    expect(buffer.noteBorder[0]).toBe(8);
    expect(buffer.noteBorder[1]).toBeCloseTo(1, 5);
    expect(buffer.noteBorder[2]).toBeCloseTo(0, 5);
    expect(buffer.noteBorder[3]).toBeCloseTo(0, 5);
  });

  it('keeps border opacity attached to its note through insert shift / release / clear', () => {
    const buffer = createNoteBuffer();

    // 트랙 A(트랙인덱스 0, 테두리 30%), B(트랙인덱스 1, 테두리 80%)
    buffer.updateTrackLayouts([
      {
        trackKey: 'A',
        trackIndex: 0,
        position: { dx: 0, dy: 0 },
        width: 60,
        height: 60,
        noteColor: '#FFFFFF',
        noteOpacity: 100,
        noteBorderColor: '#FFFFFF',
        noteBorderOpacity: 30,
        noteBorderWidth: 4,
      },
      {
        trackKey: 'B',
        trackIndex: 1,
        position: { dx: 0, dy: 0 },
        width: 60,
        height: 60,
        noteColor: '#FFFFFF',
        noteOpacity: 100,
        noteBorderColor: '#FFFFFF',
        noteBorderOpacity: 80,
        noteBorderWidth: 4,
      },
    ]);

    // B 먼저 할당 후 A 할당 — A는 트랙인덱스가 더 작아 앞으로 삽입되며 B를 시프트
    buffer.allocate('B', 'b1', 2000);
    buffer.allocate('A', 'a1', 1000);

    // 시프트 후: index0=A(0.3), index1=B(0.8) — 시작시각으로 슬롯 식별
    expect(buffer.noteInfo[0]).toBeCloseTo(1000, 3);
    expect(buffer.noteBorderOpacity[0]).toBeCloseTo(0.3, 5);
    expect(buffer.noteInfo[3]).toBeCloseTo(2000, 3);
    expect(buffer.noteBorderOpacity[1]).toBeCloseTo(0.8, 5);

    // A 제거 → B가 index0으로 시프트, 테두리 opacity도 따라옴
    buffer.release('a1');
    expect(buffer.activeCount).toBe(1);
    expect(buffer.noteInfo[0]).toBeCloseTo(2000, 3);
    expect(buffer.noteBorderOpacity[0]).toBeCloseTo(0.8, 5);

    // clear → 슬롯 초기화
    buffer.clear();
    expect(buffer.activeCount).toBe(0);
    expect(buffer.noteBorderOpacity[0]).toBe(0);
  });

  it('preserves sub-frame note start times without quantizing to frame steps', () => {
    const buffer = createNoteBuffer();

    buffer.updateTrackLayouts([
      {
        trackKey: 'Z',
        trackIndex: 0,
        position: { dx: 10, dy: 20 },
        width: 60,
        height: 60,
        noteColor: '#FFFFFF',
        noteOpacity: 80,
      },
    ]);

    buffer.allocate('Z', 'note-1', 1000.25);
    buffer.allocate('Z', 'note-2', 1004.75);

    expect(buffer.noteInfo[0]).toBeCloseTo(1000.25, 3);
    expect(buffer.noteInfo[3]).toBeCloseTo(1004.75, 3);
    expect(buffer.noteInfo[3] - buffer.noteInfo[0]).toBeCloseTo(4.5, 3);
  });
});
