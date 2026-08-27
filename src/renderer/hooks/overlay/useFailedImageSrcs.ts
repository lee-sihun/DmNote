import { useCallback, useState } from 'react';

const EMPTY: ReadonlySet<string> = new Set();

interface FailedImageState {
  // 집합이 어떤 이미지 경로 조합에서 만들어졌는지 - 경로가 바뀌면 파일을 복구했을 수
  // 있으므로 집합을 새로 시작한다 (effect 없이 렌더 중 파생 - useSignals 추적을 건드리지 않음)
  key: string;
  srcs: ReadonlySet<string>;
}

// 오류 이벤트가 지금 렌더된 src의 것인지 판정한다. idle↔active 전환으로 src가 먼저
// 바뀌면 브라우저가 보고하는 currentSrc(실제 시도한 URL)와 어긋나므로 무시한다 -
// 멀쩡한 이미지를 실패로 낙인찍지 않게. 여전히 없는 파일이면 다음 시도에서 다시 오류가 난다
export function isErrorForCurrentSrc(
  image: HTMLImageElement,
  src: string | null | undefined,
): boolean {
  if (!src) return false;
  const reported = image.currentSrc;
  // 보고가 없는 환경(jsdom 등)은 렌더 시점 src를 믿는다
  if (!reported) return true;
  try {
    return reported === new URL(src, image.ownerDocument.baseURI).href;
  } catch {
    return reported === src;
  }
}

// 디코드에 실패한 이미지 src를 기억해 렌더에서 제외한다 - replace 모드의 유실
// 이미지가 배경·라벨까지 지워 완전 투명 키를 만들지 않게
export function useFailedImageSrcs(
  ...imagePaths: Array<string | null | undefined>
) {
  const key = imagePaths.join(' ');
  const [state, setState] = useState<FailedImageState>({ key, srcs: EMPTY });
  const failedImageSrcs = state.key === key ? state.srcs : EMPTY;
  const markFailed = useCallback(
    (src: string | null | undefined) => {
      if (!src) return;
      setState((prev) => {
        const current = prev.key === key ? prev.srcs : EMPTY;
        if (current.has(src)) return prev;
        return { key, srcs: new Set(current).add(src) };
      });
    },
    [key],
  );
  return { failedImageSrcs, markFailed };
}
