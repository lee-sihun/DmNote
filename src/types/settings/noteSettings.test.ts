import { describe, expect, it } from 'vitest';
import {
  mergeNoteSettings,
  normalizeNoteSettings,
  noteSettingsSchema,
  NOTE_SETTINGS_DEFAULTS,
  type NoteSettings,
} from './noteSettings';

const base: NoteSettings = { ...NOTE_SETTINGS_DEFAULTS };

describe('노트 방향 설정 계층', () => {
  it('direction 부재 시 up으로 채워진다 (구버전 store 호환)', () => {
    const { direction: _omitted, ...withoutDirection } = base;
    const parsed = noteSettingsSchema.parse(withoutDirection);
    expect(parsed.direction).toBe('up');
  });

  it('이상 direction은 필드 단위로만 up 복구되고 다른 설정은 보존된다', () => {
    const parsed = noteSettingsSchema.parse({
      ...base,
      speed: 777,
      direction: 'diagonal',
    });
    expect(parsed.direction).toBe('up');
    expect(parsed.speed).toBe(777);
  });

  it('normalizeNoteSettings도 이상 direction에서 전체 초기화되지 않는다', () => {
    const normalized = normalizeNoteSettings({
      ...base,
      trackHeight: 555,
      direction: 42,
    });
    expect(normalized.direction).toBe('up');
    expect(normalized.trackHeight).toBe(555);
  });

  it('탭 오버라이드가 없으면 전역 direction을 상속한다', () => {
    const merged = mergeNoteSettings({ ...base, direction: 'left' }, {});
    expect(merged.direction).toBe('left');
  });

  it('탭 오버라이드 direction이 전역을 덮는다', () => {
    const merged = mergeNoteSettings(
      { ...base, direction: 'left' },
      { direction: 'down' },
    );
    expect(merged.direction).toBe('down');
  });

  it('유효한 4방향 값은 그대로 통과한다', () => {
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      expect(noteSettingsSchema.parse({ ...base, direction }).direction).toBe(
        direction,
      );
    }
  });
});
