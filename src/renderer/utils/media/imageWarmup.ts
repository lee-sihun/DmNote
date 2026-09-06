const imageWarmupCache = new Map<string, Promise<void>>();
const IMAGE_WARMUP_CACHE_LIMIT = 256;
// 동시 디코드 상한 - 자세 이미지가 많은 문서가 마운트 순간 로드를 전부
// 시작하면 메모리·디코드 스파이크가 생긴다. 나머지는 FIFO로 뒤따른다
const MAX_CONCURRENT_WARMUPS = 6;
// 로드도 에러도 나지 않는 src가 슬롯을 붙잡으면 큐 전체가 멈춘다. 사전 디코드
// 최적화라 포기해도 본 렌더의 img 로드는 그대로 진행된다
const WARMUP_SETTLE_TIMEOUT_MS = 10_000;

// 진행·대기 중 src - LRU 퇴출에서 제외해 같은 src의 중복 enqueue를 막는다
const inFlightSrcs = new Set<string>();
const warmupQueue: Array<() => void> = [];
let runningWarmups = 0;

const pumpWarmupQueue = (): void => {
  while (runningWarmups < MAX_CONCURRENT_WARMUPS && warmupQueue.length > 0) {
    const start = warmupQueue.shift();
    start?.();
  }
};

// 완료분만 오래된 순으로 퇴출. 전부 진행 중이면 일시 초과를 허용하고
// settle 시점에 다시 줄인다
const trimCompletedCache = (): void => {
  if (imageWarmupCache.size <= IMAGE_WARMUP_CACHE_LIMIT) return;
  for (const key of imageWarmupCache.keys()) {
    if (imageWarmupCache.size <= IMAGE_WARMUP_CACHE_LIMIT) break;
    if (inFlightSrcs.has(key)) continue;
    imageWarmupCache.delete(key);
  }
};

export function warmupImageSource(src?: string | null): void {
  if (!src) return;
  const cached = imageWarmupCache.get(src);
  if (cached) {
    imageWarmupCache.delete(src);
    imageWarmupCache.set(src, cached);
    return;
  }

  inFlightSrcs.add(src);
  const task = new Promise<void>((resolve) => {
    // Image 생성은 실행 차례가 왔을 때 - 대기 항목이 디코드를 들고 있지 않게
    warmupQueue.push(() => {
      runningWarmups += 1;
      let settled = false;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;

      const done = () => {
        if (settled) return;
        settled = true;
        if (settleTimer !== null) clearTimeout(settleTimer);
        runningWarmups -= 1;
        inFlightSrcs.delete(src);
        resolve();
        trimCompletedCache();
        pumpWarmupQueue();
      };

      // 멈춘 src가 슬롯을 영구히 물지 않게 한다. 만료 후 뒤늦게 load·error가
      // 와도 done은 한 번만 유효하다
      settleTimer = setTimeout(done, WARMUP_SETTLE_TIMEOUT_MS);

      try {
        const img = new Image();
        img.onload = done;
        img.onerror = done;
        img.src = src;

        if (typeof img.decode === 'function') {
          img
            .decode()
            .then(done)
            .catch(() => {
              if (img.complete) done();
            });
        } else if (img.complete) {
          done();
        }
      } catch {
        // 생성·초기화가 던져도 카운터와 in-flight를 회수한다
        done();
      }
    });
  });

  imageWarmupCache.set(src, task);
  pumpWarmupQueue();
  trimCompletedCache();
}
