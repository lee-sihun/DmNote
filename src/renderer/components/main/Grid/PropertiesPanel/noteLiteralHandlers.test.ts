import { describe, expect, it, vi } from 'vitest';

import { createNoteLiteralHandlers } from './noteLiteralHandlers';

describe('note literal handlers', () => {
  it('single과 batch가 쓰는 5개 callback을 absolute one-leaf로 변환한다', () => {
    const onChange = vi.fn();
    const handlers = createNoteLiteralHandlers(
      {
        noteEffectEnabled: true,
        noteAutoYCorrection: false,
        noteGlowEnabled: false,
      },
      onChange,
    );

    handlers.toggleEffect();
    handlers.toggleAutoYCorrection();
    handlers.toggleGlow();
    handlers.setAlignment('right');
    handlers.setBorderSide('vertical');

    expect(onChange.mock.calls).toEqual([
      ['noteEffectEnabled', false],
      ['noteAutoYCorrection', true],
      ['noteGlowEnabled', true],
      ['noteAlignment', 'right'],
      ['noteBorderSide', 'vertical'],
    ]);
  });
});
