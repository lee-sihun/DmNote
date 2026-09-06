import { useEffect, useRef, useState } from 'react';
import { overlayApi } from '@api/modules/window/overlayApi';

// 창 페이드아웃 후 레이아웃을 갈아끼우고, 리사이즈가 자리 잡은 뒤 페이드인
const FADE_OUT_MS = 80;
const FADE_GAP_MS = 20;
const RESIZE_SETTLE_MS = 160;
const FADE_IN_MS = 140;
const ALPHA_RESTORE_RETRY_MS = 120;
const ALPHA_RESTORE_ATTEMPTS = 2;

export interface ContentFadeStyle {
  opacity: number;
  durationMs: number;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// 네이티브 페이드 실패가 이어져도 창이 투명하게 남지 않도록 경계 있는 재시도
async function restoreWindowAlpha() {
  for (let attempt = 0; attempt < ALPHA_RESTORE_ATTEMPTS; attempt += 1) {
    try {
      await overlayApi.transitionFade(1, attempt === 0 ? FADE_IN_MS : 0);
      return;
    } catch (error) {
      if (attempt === ALPHA_RESTORE_ATTEMPTS - 1) {
        console.error('오버레이 알파 복구 실패', error);
        return;
      }
      await sleep(ALPHA_RESTORE_RETRY_MS);
    }
  }
}

// 트랙 예약 공간 토글(0 ↔ trackHeight) 시 창 페이드로 리사이즈 전환을 감싼다
// 창 프레임 변경과 웹뷰 리페인트는 프로세스 경계라 같은 프레임에 커밋되지 않아
// 그대로 두면 키가 한두 프레임 어긋나 보인다
// 네이티브 페이드 미지원 환경은 콘텐츠 페이드로 대체하고, 창이 없는 OBS는 전환을 생략
export function useTrackReserveTransition(
  target: number,
  hydrated: boolean,
): { trackHeight: number; contentFade: ContentFadeStyle | null } {
  const [applied, setApplied] = useState(target);
  const [contentFade, setContentFade] = useState<ContentFadeStyle | null>(null);
  const runIdRef = useRef(0);

  // 하이드레이션 전 값과, 예약이 유지되는 값 변경(트랙 높이 조절)은
  // 전환 없이 같은 렌더 패스에서 채택
  const adoptNow =
    target !== applied && (!hydrated || (target > 0 && applied > 0));
  if (adoptNow) {
    setApplied(target);
  }

  useEffect(() => {
    if (!hydrated || target === applied) return;

    // OBS는 창 리사이즈가 없어 레이아웃이 한 커밋에 원자 반영되므로 전환 불필요
    if (window.__dmn_runtime === 'obs') {
      setApplied(target);
      return;
    }

    // runId 증가는 모든 조기 리턴 가드 뒤여야 함
    // 조기 리턴하는 effect가 이전 런의 복구 소유권을 훔치지 않도록
    const runId = ++runIdRef.current;
    const isCurrent = () => runId === runIdRef.current;
    let disposed = false;
    let domFaded = false;

    void (async () => {
      try {
        // 반환값이 페이드 적용 여부 - 미지원 플랫폼이면 콘텐츠 페이드로 대체
        const native =
          (await overlayApi.transitionFade(0, FADE_OUT_MS)) === true;
        if (!native && isCurrent()) {
          domFaded = true;
          setContentFade({ opacity: 0, durationMs: FADE_OUT_MS });
        }
        await sleep(FADE_OUT_MS + FADE_GAP_MS);
        if (disposed) return;
        setApplied(target);
        await sleep(RESIZE_SETTLE_MS);
      } catch (error) {
        console.warn('트랙 예약 전환 실패', error);
        if (!disposed) {
          setApplied(target);
        }
      } finally {
        // 어떤 경로로 끝나든 현재 런이 가시성을 되돌린다
        // 새 런이 시작됐다면 소유권이 넘어가 그쪽이 책임진다
        if (isCurrent()) {
          void restoreWindowAlpha();
          setContentFade(
            domFaded ? { opacity: 1, durationMs: FADE_IN_MS } : null,
          );
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [hydrated, target, applied]);

  // 페이드인 완료 후 인라인 opacity 제거 - 유저 CSS가 다시 최우선이 되도록
  useEffect(() => {
    if (!contentFade || contentFade.opacity !== 1) return;
    const timer = setTimeout(
      () => setContentFade(null),
      contentFade.durationMs + FADE_GAP_MS,
    );
    return () => clearTimeout(timer);
  }, [contentFade]);

  return { trackHeight: adoptNow ? target : applied, contentFade };
}
