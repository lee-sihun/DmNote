import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EDITOR_ELEMENT_PROPERTY_KEYS,
  EDITOR_OPS_VERSION,
  isEditorElementPropertyPatchV1,
} from '../src/types/editor';

// Rust 테스트(src-tauri/src/models/editor.rs)와 같은 fixture를 공유해
// 양 언어의 property 태그 목록이 기계적으로 일치함을 고정한다
const FIXTURE_PATH = join(__dirname, 'fixtures', 'editor-property-tags.json');

interface PropertyTagFixture {
  version: number;
  properties: string[];
}

const fixture = (): PropertyTagFixture =>
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as PropertyTagFixture;

describe('editor property wire parity', () => {
  it('canonical property 태그 배열은 공유 fixture와 순서까지 일치한다', () => {
    const { properties } = fixture();
    expect(properties).toHaveLength(75);
    expect([...EDITOR_ELEMENT_PROPERTY_KEYS]).toEqual(properties);
  });

  it('ops 버전은 fixture version과 일치하는 2다', () => {
    // 양방향 anchor: 한쪽 상수만 승격되면 fixture 대조에서 걸린다
    // (Rust는 models::editor 테스트가 같은 fixture와 대조)
    expect(EDITOR_OPS_VERSION).toBe(2);
    expect(fixture().version).toBe(EDITOR_OPS_VERSION);
  });

  it('v2 wire는 태그 형식만 수용하고 옛 one-key 형식을 거부한다', () => {
    expect(
      isEditorElementPropertyPatchV1(
        { property: 'hidden', value: true },
        'key',
      ),
    ).toBe(true);
    // 옛 one-key 형식
    expect(isEditorElementPropertyPatchV1({ hidden: true }, 'key')).toBe(false);
    // property 누락
    expect(isEditorElementPropertyPatchV1({ value: true }, 'key')).toBe(false);
    // value 키 누락
    expect(isEditorElementPropertyPatchV1({ property: 'hidden' }, 'key')).toBe(
      false,
    );
    // 알 수 없는 property
    expect(
      isEditorElementPropertyPatchV1({ property: 'unknown', value: 1 }, 'key'),
    ).toBe(false);
    // outer 추가 필드 - exact 2키(property·value) 검사로 거부 (Rust
    // deny_unknown_fields와 파리티)
    expect(
      isEditorElementPropertyPatchV1(
        { property: 'hidden', value: true, extra: 1 },
        'key',
      ),
    ).toBe(false);
    // 옛 형식 키가 태그 형식에 섞여 들어와도 거부
    expect(
      isEditorElementPropertyPatchV1(
        { property: 'hidden', value: true, hidden: true },
        'key',
      ),
    ).toBe(false);
  });

  it('nullable 4건은 value: null만 허용하고 value 키 누락을 거부한다', () => {
    for (const property of [
      'layerName',
      'noteOffsetX',
      'noteOffsetY',
      'noteWidth',
    ]) {
      expect(isEditorElementPropertyPatchV1({ property }, 'key')).toBe(false);
      expect(
        isEditorElementPropertyPatchV1({ property, value: null }, 'key'),
      ).toBe(true);
    }
  });

  it('shadow inner leaf는 태그 형식만 수용한다', () => {
    const patch = (value: unknown) =>
      isEditorElementPropertyPatchV1({ property: 'shadow', value }, 'key');
    expect(patch({ leaf: 'blur', value: 4.5 })).toBe(true);
    // 옛 one-key leaf 형식
    expect(patch({ blur: 4.5 })).toBe(false);
    // leaf 누락
    expect(patch({ value: 4.5 })).toBe(false);
    // leaf 오타
    expect(patch({ leaf: 'blr', value: 4.5 })).toBe(false);
    // value 누락
    expect(patch({ leaf: 'blur' })).toBe(false);
    // 추가 필드
    expect(patch({ leaf: 'blur', value: 4.5, extra: 1 })).toBe(false);
  });
});
