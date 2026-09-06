import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ convertFileSrc: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}));

import { canLoadFont } from './assetProbe';

describe('assetProbe 폰트 검증', () => {
  let fontFaceDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    fontFaceDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'FontFace',
    );
    mocks.convertFileSrc.mockReset().mockReturnValue('asset://font.woff2');
  });

  afterEach(() => {
    if (fontFaceDescriptor) {
      Object.defineProperty(globalThis, 'FontFace', fontFaceDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'FontFace');
    }
    vi.restoreAllMocks();
  });

  it('FontFace 생성이 동기 예외를 내면 로드 실패로 반환한다', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    class ThrowingFontFace {
      constructor() {
        throw new DOMException('Invalid font source', 'SyntaxError');
      }
    }
    Object.defineProperty(globalThis, 'FontFace', {
      configurable: true,
      value: ThrowingFontFace,
    });

    await expect(canLoadFont('/tmp/broken.woff2')).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to create font probe',
      expect.any(DOMException),
    );
  });
});
