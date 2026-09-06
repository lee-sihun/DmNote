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

export interface ProbedImageSize {
  width: number;
  height: number;
}

/**
 * 이미지 파일을 WebView에서 디코드해 원본 픽셀 크기를 돌려준다. 디코드 실패·
 * 시간 초과·크기 0은 null. 스프라이트 축 배치가 이 값을 경로와 함께 저장한다
 */
export function probeImageSize(path: string): Promise<ProbedImageSize | null> {
  const src = resolveImageSource(path);
  if (!src) return Promise.resolve(null);

  return new Promise<ProbedImageSize | null>((resolve) => {
    const timer = window.setTimeout(() => {
      console.error('Asset probe timed out');
      resolve(null);
    }, PROBE_TIMEOUT_MS);
    const image = new Image();
    image.onload = () => {
      window.clearTimeout(timer);
      const { naturalWidth, naturalHeight } = image;
      resolve(
        naturalWidth > 0 && naturalHeight > 0
          ? { width: naturalWidth, height: naturalHeight }
          : null,
      );
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = src;
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

  try {
    // document.fonts에 넣지 않는다 - 판정만 하고 버린다
    const probe = new FontFace('dmn-font-probe', `url("${src}")`);
    return withTimeout(
      probe.load().then(
        () => true,
        () => false,
      ),
    );
  } catch (error) {
    console.error('Failed to create font probe', error);
    return Promise.resolve(false);
  }
}
