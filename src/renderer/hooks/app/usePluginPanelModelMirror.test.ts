import { describe, expect, it } from 'vitest';

import { advancePanelModelCursor } from './usePluginPanelModelMirror';

describe('plugin panel model cursor', () => {
  it('새 authority generation의 낮은 pushSeq를 적용한다', () => {
    expect(
      advancePanelModelCursor({ authorityGeneration: 4, pushSeq: 42 }, 5, 1),
    ).toEqual({ authorityGeneration: 5, pushSeq: 1 });
  });

  it('이전 generation과 같은 generation의 역순 push를 거절한다', () => {
    const current = { authorityGeneration: 5, pushSeq: 7 };

    expect(advancePanelModelCursor(current, 4, 100)).toBeNull();
    expect(advancePanelModelCursor(current, 5, 7)).toBeNull();
    expect(advancePanelModelCursor(current, 5, 6)).toBeNull();
    expect(advancePanelModelCursor(current, 5, 8)).toEqual({
      authorityGeneration: 5,
      pushSeq: 8,
    });
  });

  it('정수가 아닌 cursor 값은 거절한다', () => {
    const current = { authorityGeneration: 1, pushSeq: 1 };

    expect(advancePanelModelCursor(current, 2.5, 1)).toBeNull();
    expect(advancePanelModelCursor(current, 2, Number.NaN)).toBeNull();
  });
});
