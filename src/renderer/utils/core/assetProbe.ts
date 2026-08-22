import { resolveImageSource } from './imageSource';

// 로컬 파일은 즉시 load/error가 나지만, 어떤 이유로든 응답이 없을 때 UI가 묶이지 않게 상한을 둔다
const PROBE_TIMEOUT_MS = 15000;

function withTimeout(probe: Promise<boolean>): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      console.error('Asset probe timed out');
      resolve(false);
    }, PROBE_TIMEOUT_MS);
    void probe.then((result) => {
      window.clearTimeout(timer);
      resolve(result);
    });
  });
}

/** 이미지 파일이 WebView에서 실제로 디코드되는지 확인 */
export function canDecodeImage(path: string): Promise<boolean> {
  const src = resolveImageSource(path);
  if (!src) return Promise.resolve(false);

  return withTimeout(
    new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(true);
      image.onerror = () => resolve(false);
      image.src = src;
    }),
  );
}

/** 폰트 파일이 WebView에서 실제로 로드되는지 확인 */
export function canLoadFont(path: string): Promise<boolean> {
  const src = resolveImageSource(path);
  if (!src) return Promise.resolve(false);
  if (typeof FontFace === 'undefined') return Promise.resolve(true);

  return withTimeout(
    // document.fonts에 넣지 않는다 - 판정만 하고 버린다
    new FontFace('dmn-font-probe', `url("${src}")`).load().then(
      () => true,
      () => false,
    ),
  );
}
