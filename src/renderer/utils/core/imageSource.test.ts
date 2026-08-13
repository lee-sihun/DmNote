import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ convertFileSrc: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: mocks.convertFileSrc,
}));

import { clearImageSourceCache, resolveImageSource } from './imageSource';

describe('image source cache', () => {
  beforeEach(() => {
    clearImageSourceCache();
    mocks.convertFileSrc.mockClear();
    mocks.convertFileSrc.mockImplementation(
      (path: string) => `asset://${path}`,
    );
  });

  it('고유 로컬 경로가 늘어나도 최근 256개만 유지한다', () => {
    for (let index = 0; index < 257; index += 1) {
      resolveImageSource(`/images/${index}.png`);
    }

    resolveImageSource('/images/0.png');

    expect(mocks.convertFileSrc).toHaveBeenCalledTimes(258);
  });

  it('cache hit을 최근 사용으로 승격해 다음 eviction에서 보존한다', () => {
    for (let index = 0; index < 256; index += 1) {
      resolveImageSource(`/images/${index}.png`);
    }
    resolveImageSource('/images/0.png');
    resolveImageSource('/images/256.png');
    resolveImageSource('/images/0.png');

    expect(mocks.convertFileSrc).toHaveBeenCalledTimes(257);
  });
});
