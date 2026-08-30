import { afterEach, describe, expect, it } from 'vitest';
import { warmupImageSource } from './imageWarmup';

type MockImage = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  complete: boolean;
  src: string;
};

describe('image warmup cache', () => {
  const originalImage = globalThis.Image;

  const installMockImage = (): MockImage[] => {
    const images: MockImage[] = [];
    globalThis.Image = class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      complete = false;
      src = '';

      constructor() {
        images.push(this as unknown as MockImage);
      }
    } as unknown as typeof Image;
    return images;
  };

  // 큐가 다음 로드를 이어가도록 생성된 이미지를 순서대로 settle한다
  const settleAll = (images: MockImage[]) => {
    for (let index = 0; index < images.length; index += 1) {
      images[index].onload?.();
    }
  };

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  it('동일 source는 settle 뒤에도 한 번만 warmup한다', async () => {
    const images = installMockImage();

    warmupImageSource('asset://one');
    warmupImageSource('asset://one');
    expect(images).toHaveLength(1);

    images[0].onload?.();
    await Promise.resolve();
    warmupImageSource('asset://one');

    expect(images).toHaveLength(1);
  });

  it('동시 로드는 상한까지만 시작하고 settle되면 다음이 이어진다', () => {
    const images = installMockImage();

    for (let index = 0; index < 20; index += 1) {
      warmupImageSource(`asset://queued-${index}`);
    }
    expect(images).toHaveLength(6);

    images[0].onload?.();
    expect(images).toHaveLength(7);

    // 대기 중 재요청은 새 로드를 만들지 않는다
    warmupImageSource('asset://queued-19');
    expect(images).toHaveLength(7);

    settleAll(images);
    expect(images).toHaveLength(20);
  });

  it('상한 초과 burst도 settle이 끝나면 캐시가 상한으로 돌아온다', () => {
    const images = installMockImage();

    // 전부 in-flight인 동안은 퇴출 불가라 일시 초과 상태
    for (let index = 0; index < 300; index += 1) {
      warmupImageSource(`asset://burst-${index}`);
    }
    settleAll(images);
    expect(images).toHaveLength(300);

    // settle 시점 trim으로 오래된 44개가 빠졌어야 재-warmup이 일어난다
    warmupImageSource('asset://burst-0');
    expect(images).toHaveLength(301);
    warmupImageSource('asset://burst-299');
    expect(images).toHaveLength(301);
  });

  it('최근 256개만 유지해 오래된 source를 다시 warmup한다', () => {
    const images = installMockImage();

    for (let index = 0; index < 257; index += 1) {
      warmupImageSource(`asset://bounded-${index}`);
      settleAll(images);
    }
    warmupImageSource('asset://bounded-0');

    expect(images).toHaveLength(258);
  });
});
