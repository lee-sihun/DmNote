import { useEffect, useRef, useState } from 'react';
import { overlayApi } from '@api/modules/overlayApi';

// 창 페이드아웃 후 레이아웃을 갈아끼우고, 리사이즈가 자리 잡은 뒤 페이드인
const FADE_OUT_MS = 80;
const RESIZE_SETTLE_MS = 160;
const FADE_IN_MS = 140;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 트랙 예약 공간 토글(0 ↔ trackHeight) 시 창 페이드로 리사이즈 전환을 감싼다
// 창 프레임 변경과 웹뷰 리페인트는 프로세스 경계라 같은 프레임에 커밋되지 않아
// 그대로 두면 키가 한두 프레임 어긋나 보인다
export function useTrackReserveTransition(target: number): number {
  const [applied, setApplied] = useState(target);
  const runIdRef = useRef(0);

  // 예약이 유지되는 값 변경(트랙 높이 조절)은 같은 렌더 패스에서 즉시 반영
  const inReserveAdjust = target !== applied && target > 0 && applied > 0;
  if (inReserveAdjust) {
    setApplied(target);
  }

  useEffect(() => {
    if (target === applied) return;

    const runId = ++runIdRef.current;
    let disposed = false;
    (async () => {
      // 반환값이 페이드 적용 여부 - 창이 없거나(OBS) 미지원 플랫폼이면 가림 없이 즉시 전환
      let faded = false;
      try {
        faded = (await overlayApi.transitionFade(0, FADE_OUT_MS)) === true;
      } catch {
        faded = false;
      }
      if (!faded) {
        if (!disposed) {
          setApplied(target);
        }
        return;
      }
      try {
        await sleep(FADE_OUT_MS + 20);
        if (disposed) return;
        setApplied(target);
        await sleep(RESIZE_SETTLE_MS);
      } finally {
        // 새 전환이 시작됐다면 페이드인은 그쪽에 맡긴다
        if (runId === runIdRef.current) {
          overlayApi.transitionFade(1, FADE_IN_MS).catch(() => {});
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [target, applied]);

  return inReserveAdjust ? target : applied;
}
