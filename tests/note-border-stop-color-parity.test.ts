import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hexRepresentative, isStrictStopColor } from '../src/types/color';

// Rust 경계(src-tauri/src/models/mod.rs의 note border 스톱 색 검증)와 같은
// fixture를 공유해 §2A 색 문법과 hex 대표색 변환의 양 언어 parity를 고정한다
const FIXTURE_PATH = join(__dirname, 'fixtures', 'note-border-stop-colors.json');

interface StopColorFixture {
  valid: Array<{ input: string; representative: string }>;
  invalid: string[];
}

const fixture: StopColorFixture = JSON.parse(
  readFileSync(FIXTURE_PATH, 'utf-8'),
);

describe('note border 스톱 색 문법 parity (계약 v2 §2A)', () => {
  it('fixture 형태 유효성', () => {
    expect(fixture.valid.length).toBeGreaterThan(0);
    expect(fixture.invalid.length).toBeGreaterThan(0);
  });

  it('허용 케이스는 전부 통과하고 대표색이 일치한다', () => {
    for (const { input, representative } of fixture.valid) {
      expect(isStrictStopColor(input), input).toBe(true);
      expect(hexRepresentative(input), input).toBe(representative);
    }
  });

  it('불허 케이스는 전부 거부한다', () => {
    for (const input of fixture.invalid) {
      expect(isStrictStopColor(input), input).toBe(false);
      expect(hexRepresentative(input), input).toBeNull();
    }
  });
});
