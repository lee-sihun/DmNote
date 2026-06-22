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
