import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '@api/modules/shared';

export interface HitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 리로드 후에도 이전 세션보다 큰 revision을 보내도록 시각 기반 시드.
// 시작 시 발급 상한(lease)을 미리 저장해 두므로, 크래시 시점과 무관하게
// 다음 세션은 항상 이번 세션이 발급했을 수 있는 최대값보다 크게 시작한다
// (시계 역행 포함). 측정마다 쓰기가 없는 crash-safe 단조성
const REVISION_STORAGE_KEY = 'dmnote:overlay-hit-revision';
const REVISION_LEASE_SPAN = 10_000_000;
// JS 안전 정수 경계이자 발급 포화점 - 도달 시 동일 revision이 반복되어
// 백엔드가 거부하는 fail-closed (Date.now 기준 수천 년 뒤의 이론적 한계)
const MAX_REVISION = Number.MAX_SAFE_INTEGER;

// 저장값 해석: 정상 lease 상한은 그대로 이어가고, 손상값만 시각 시드로 폴백
export const computeRevisionSeed = (
  storedRaw: string | null,
  now: number,
): number => {
  const stored = Number(storedRaw);
  if (
    Number.isSafeInteger(stored) &&
    stored > 0 &&
    stored < MAX_REVISION &&
    stored >= now
  ) {
    return stored + 1;
  }
  return now;
};

export const computeLeaseEnd = (base: number): number =>
  Math.min(base + REVISION_LEASE_SPAN, MAX_REVISION);

let revisionLeaseEnd = 0;

const reserveRevisionLease = (base: number) => {
  revisionLeaseEnd = computeLeaseEnd(base);
  try {
    window.localStorage.setItem(REVISION_STORAGE_KEY, String(revisionLeaseEnd));
  } catch {
    // 저장 실패는 무시 - 다음 리로드에서 시각 시드로 폴백
  }
};

// 네이티브 부모 창이 없는 OBS 브라우저 소스에서는 측정도 IPC도 무의미하다.
// 커맨드가 allowlist 밖이라 호출이 항상 거부되므로 측정 자체를 건너뛴다
const IS_OBS = typeof window !== 'undefined' && window.__dmn_runtime === 'obs';

// 히트 창을 쓰지 않는 OBS에서는 lease 저장도 하지 않는다
let hitRegionRevision = IS_OBS
  ? 0
  : (() => {
      let storedRaw: string | null = null;
      try {
        storedRaw = window.localStorage.getItem(REVISION_STORAGE_KEY);
      } catch {
        // localStorage 접근 실패 시 시각 시드만 사용
      }
      const seed = computeRevisionSeed(storedRaw, Date.now());
      reserveRevisionLease(seed);
      return seed;
    })();

const nextRevision = () => {
  if (hitRegionRevision < MAX_REVISION) {
    hitRegionRevision += 1;
  }
  if (hitRegionRevision >= revisionLeaseEnd) {
    reserveRevisionLease(hitRegionRevision);
  }
  return hitRegionRevision;
};

// 동일 오류 반복만 억제 - 새로운 오류는 항상 노출
let lastSyncFailureMessage: string | null = null;
// 직전 발행 rect - 동일하면 IPC를 생략한다 (옵저버·이벤트 중복 트리거 흡수)
let lastSentRects: HitRegionRect[] | null = null;
// 배율도 발행 기준에 포함한다. rect는 CSS px라 배율만 바뀌면 값이 그대로인데,
// 백엔드는 이 배율로 물리 좌표를 만들기 때문에 생략하면 옛 배율에 갇힌다
let lastSentDpr: number | null = null;

const rectsEqual = (a: HitRegionRect[], b: HitRegionRect[]): boolean =>
  a.length === b.length &&
  a.every((rect, index) => {
    const other = b[index];
    return (
      rect.x === other.x &&
      rect.y === other.y &&
      rect.width === other.width &&
      rect.height === other.height
    );
  });

// 발행 여부 판정. rect와 배율을 함께 봐야 한다 - rect는 CSS px라 배율만 바뀌면
// 값이 그대로인데, 백엔드는 이 배율로 물리 좌표를 만든다
export const shouldPublishHitRegions = (
  lastRects: HitRegionRect[] | null,
  lastDpr: number | null,
  rects: HitRegionRect[],
  devicePixelRatio: number,
): boolean =>
  !lastRects || lastDpr !== devicePixelRatio || !rectsEqual(lastRects, rects);

const syncHitRegions = (rects: HitRegionRect[]) => {
  // 보정 줌이 곱해진 실측 배율 - 백엔드가 DPI로 대신 계산할 수 없다
  const devicePixelRatio = window.devicePixelRatio;
  if (
    !shouldPublishHitRegions(
      lastSentRects,
      lastSentDpr,
      rects,
      devicePixelRatio,
    )
  ) {
    return;
  }
  lastSentRects = rects;
  lastSentDpr = devicePixelRatio;
  invoke<void>('overlay_sync_hit_regions', {
    payload: {
      rects,
      revision: nextRevision(),
      devicePixelRatio,
    },
  })
    .then(() => {
      lastSyncFailureMessage = null;
    })
    .catch((error) => {
      // 실패한 발행은 기준선으로 남기지 않는다 - 같은 rect 재시도가 막히면
      // 히트 창이 영영 옛 배치에 머무른다
      lastSentRects = null;
      lastSentDpr = null;
      const message = String(error);
      if (message === lastSyncFailureMessage) return;
      lastSyncFailureMessage = message;
      console.warn('Failed to sync overlay hit regions', error);
    });
};

// 배율 변경은 CSS px 레이아웃을 바꾸지 않아 ResizeObserver도 resize 이벤트도 발화하지 않는다.
// 현재 배율에 고정한 미디어 쿼리를 걸어 두고, 깨지는 순간 다시 걸며 재측정을 알린다
const watchDevicePixelRatio = (onChange: () => void): (() => void) => {
  let query: MediaQueryList | null = null;
  let disposed = false;

  function handleChange() {
    arm();
    onChange();
  }

  function arm() {
    if (disposed) return;
    query?.removeEventListener('change', handleChange);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handleChange);
  }

  // 테스트 환경 등 matchMedia가 없는 곳에서는 감시를 건너뛴다.
  // 발행 기준에 배율이 들어가 있어 다음 재측정에서 어차피 따라잡는다
  if (typeof window.matchMedia !== 'function') {
    return () => {};
  }

  arm();
  return () => {
    disposed = true;
    query?.removeEventListener('change', handleChange);
    query = null;
  };
};

const hitNodes = (): HTMLElement[] =>
  // 키 전용 표식만 측정 - data-key-element는 스탯 등 다른 요소도 공유하는 스타일 표식
  Array.from(
    document.querySelectorAll<HTMLElement>('[data-overlay-hit="true"]'),
  );

const measureKeyRects = (nodes: HTMLElement[]): HitRegionRect[] => {
  const rects: HitRegionRect[] = [];
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    rects.push({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
  });
  return rects;
};

/**
 * 키 rect를 실측해 백엔드 히트 창과 동기화
 *
 * `generation`(레이아웃 계산 결과)이 바뀌면 노드 집합을 다시 모으고 옵저버를
 * 재등록한다. 실제 재측정은 ResizeObserver와 CSS 변경 이벤트가 몰아주므로,
 * 폰트 로드·커스텀 CSS/JS·플러그인 스타일처럼 레이아웃 계산 밖에서 키 크기가
 * 변하는 경로까지 원인 열거 없이 덮인다. 같은 rect면 IPC는 생략된다
 */
export const useOverlayHitRegions = (generation: unknown) => {
  const scheduleRef = useRef<() => void>(() => {});

  // CSS 변경 구독은 마운트 수명 - generation마다 재등록하면
  // IPC 처닝과 재등록 구간의 이벤트 유실이 생김
  useEffect(() => {
    if (IS_OBS) return;
    const notify = () => scheduleRef.current();
    const unsubscribers = [
      subscribe('css:use', notify),
      subscribe('css:content', notify),
      // 탭 스코프 CSS는 별도 채널로 전달됨
      subscribe('tabCss:changed', notify),
    ];
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  useEffect(() => {
    if (IS_OBS) return;
    let cancelled = false;
    let raf = 0;
    const observer = new ResizeObserver(() => scheduleMeasure());

    // rAF 1회로 coalesce - 페인트 확정 후 실측.
    // 노드 집합을 매번 다시 모아 커스텀 JS·플러그인이 키를 추가·제거한 경우도 덮는다
    const scheduleMeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const nodes = hitNodes();
        observer.disconnect();
        nodes.forEach((node) => observer.observe(node));
        syncHitRegions(measureKeyRects(nodes));
      });
    };

    scheduleRef.current = scheduleMeasure;
    const unwatchScale = watchDevicePixelRatio(scheduleMeasure);
    // 미디어 쿼리가 발화하지 않는 웹뷰를 대비한 두 번째 그물.
    // 발행 기준에 배율이 들어 있으므로 헛호출은 IPC로 이어지지 않는다
    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      unwatchScale();
      window.removeEventListener('resize', scheduleMeasure);
      scheduleRef.current = () => {};
    };
  }, [generation]);
};

// 히트 창 우클릭 → 기존 네이티브 메뉴 브릿지
export const subscribeHitContextMenu = (
  listener: (pos: { x: number; y: number }) => void,
) => subscribe<{ x: number; y: number }>('overlay-hit-context-menu', listener);
