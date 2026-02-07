const imageWarmupCache = new Map<string, Promise<void>>();

export function warmupImageSource(src?: string | null): void {
  if (!src || imageWarmupCache.has(src)) return;

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

    if (typeof img.decode === "function") {
      img.decode().then(done).catch(() => {
        if (img.complete) done();
      });
    } else if (img.complete) {
      done();
    }
  });

  imageWarmupCache.set(src, task);
}
