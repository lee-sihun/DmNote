/**
 * 워밍업 슬롯 만료
 * - load도 error도 오지 않는 source가 동시 상한을 채우면 큐 전체가 멈춘다
 * - 만료가 슬롯을 돌려줘 뒤따르는 source가 이어진다
 * 모듈 카운터가 파일 단위 상태라 누적 캐시 테스트와 분리한다
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { warmupImageSource } from '../media/imageWarmup';

type MockImage = {
  onload: (() => void) | null;
  onerror: (() => void) | null;
  complete: boolean;
  src: string;
};

describe('image warmup settle timeout', () => {
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

  afterEach(() => {
    globalThis.Image = originalImage;
    vi.useRealTimers();
  });

  it('settle되지 않는 source가 상한을 채워도 만료 뒤 큐가 이어진다', () => {
    vi.useFakeTimers();
    const images = installMockImage();

    for (let index = 0; index < 7; index += 1) {
      warmupImageSource(`asset://stalled-${index}`);
    }
    expect(images).toHaveLength(6);

    // 만료 직전까지는 슬롯이 묶여 7번째가 시작되지 않는다
    vi.advanceTimersByTime(9_999);
    expect(images).toHaveLength(6);

    vi.advanceTimersByTime(1);
    expect(images).toHaveLength(7);

    // 만료 뒤 뒤늦게 도착한 load는 카운터를 두 번 깎지 않는다
    images[0].onload?.();
    warmupImageSource('asset://after-expiry');
    expect(images).toHaveLength(8);
  });
});
