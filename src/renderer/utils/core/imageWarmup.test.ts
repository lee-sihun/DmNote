import { afterEach, describe, expect, it } from 'vitest';
import { warmupImageSource } from './imageWarmup';

describe('image warmup cache', () => {
  const originalImage = globalThis.Image;

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  it('동일 source는 settle 뒤에도 한 번만 warmup한다', async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      src = '';

      constructor() {
        images.push(this);
      }
    } as unknown as typeof Image;

    warmupImageSource('asset://one');
    warmupImageSource('asset://one');
    expect(images).toHaveLength(1);

    images[0].onload?.();
    await Promise.resolve();
    warmupImageSource('asset://one');

    expect(images).toHaveLength(1);
  });

  it('최근 256개만 유지해 오래된 source를 다시 warmup한다', () => {
    const images: unknown[] = [];
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      src = '';

      constructor() {
        images.push(this);
      }
    } as unknown as typeof Image;

    for (let index = 0; index < 257; index += 1) {
      warmupImageSource(`asset://bounded-${index}`);
    }
    warmupImageSource('asset://bounded-0');

    expect(images).toHaveLength(258);
  });
});
