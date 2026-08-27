import { describe, expect, it } from 'vitest';

import { FULL_SURFACE_MATERIAL_CLASS } from './FullSurfaceModalLayout';

describe('FullSurfaceModalLayout material', () => {
  it('전면 시트는 대면적 glass 재질을 유지한다', () => {
    expect(FULL_SURFACE_MATERIAL_CLASS).toContain('bg-glass');
    expect(FULL_SURFACE_MATERIAL_CLASS).toContain('backdrop-glass');
    expect(FULL_SURFACE_MATERIAL_CLASS).toContain('backdrop-glass-canvas');
    expect(FULL_SURFACE_MATERIAL_CLASS).not.toContain('solid');
  });
});
