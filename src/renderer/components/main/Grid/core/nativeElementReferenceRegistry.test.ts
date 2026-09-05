import { describe, expect, it } from 'vitest';
import { updateNativeElementReference } from './nativeElementReferenceRegistry';

describe('native element reference registry', () => {
  it('요소가 해제되면 UUID 참조 항목도 제거한다', () => {
    const registry = new Map<string, HTMLElement>();
    const key = 'graph:00000000-0000-4000-8000-000000000103';
    const node = {} as HTMLElement;

    updateNativeElementReference(registry, key, node);
    expect(registry.get(key)).toBe(node);

    updateNativeElementReference(registry, key, null);
    expect(registry.has(key)).toBe(false);
    expect(registry.size).toBe(0);
  });
});
