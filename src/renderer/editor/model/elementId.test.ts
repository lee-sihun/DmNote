import { describe, expect, it } from 'vitest';

import { isNativeElementId } from './elementId';

describe('isNativeElementId', () => {
  it.each([
    'aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    '{aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa}',
    'urn:uuid:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ])('Rust UUID parser와 같은 형식을 허용한다: %s', (id) => {
    expect(isNativeElementId(id)).toBe(true);
  });

  it.each([
    '',
    ' aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa ',
    'URN:UUID:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '00000000000000000000000000000000',
    '00000000-0000-0000-0000-000000000000',
    '{00000000-0000-0000-0000-000000000000}',
    'key-0',
    null,
  ])('Rust native ID 경계와 같은 값을 거절한다: %s', (id) => {
    expect(isNativeElementId(id)).toBe(false);
  });
});
