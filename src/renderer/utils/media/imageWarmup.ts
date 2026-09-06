const imageWarmupCache = new Map<string, Promise<void>>();
const IMAGE_WARMUP_CACHE_LIMIT = 256;

export function warmupImageSource(src?: string | null): void {
  if (!src) return;
  const cached = imageWarmupCache.get(src);
  if (cached) {
    imageWarmupCache.delete(src);
    imageWarmupCache.set(src, cached);
    return;
  }

  const task = new Promise<void>((resolve) => {
    const img = new Image();
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

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
  });

  imageWarmupCache.set(src, task);
  while (imageWarmupCache.size > IMAGE_WARMUP_CACHE_LIMIT) {
    const oldest = imageWarmupCache.keys().next().value;
    if (oldest === undefined) break;
    imageWarmupCache.delete(oldest);
  }
}
