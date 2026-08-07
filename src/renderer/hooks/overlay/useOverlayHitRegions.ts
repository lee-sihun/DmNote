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

let hitRegionRevision = (() => {
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

const syncHitRegions = (rects: HitRegionRect[]) => {
  invoke<void>('overlay_sync_hit_regions', {
    payload: { rects, revision: nextRevision() },
  })
    .then(() => {
      lastSyncFailureMessage = null;
    })
    .catch((error) => {
      const message = String(error);
      if (message === lastSyncFailureMessage) return;
      lastSyncFailureMessage = message;
      console.warn('Failed to sync overlay hit regions', error);
    });
};

const measureKeyRects = (): HitRegionRect[] => {
  // 키 전용 표식만 측정 - data-key-element는 스탯 등 다른 요소도 공유하는 스타일 표식
  const nodes = document.querySelectorAll<HTMLElement>(
    '[data-overlay-hit="true"]',
  );
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

// applied 지오메트리·커스텀 CSS가 DOM에 반영된 뒤 키 rect를 실측해
// 백엔드 히트 창과 동기화 (계약: tasks/plan/overlay-hit-window.md)
export const useOverlayHitRegions = (appliedGeneration: unknown) => {
  const scheduleRef = useRef<() => void>(() => {});

  // CSS 변경 구독은 마운트 수명 - applied 변경마다 재등록하면
  // IPC 처닝과 재등록 구간의 이벤트 유실이 생김
  useEffect(() => {
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
    let cancelled = false;
    let raf = 0;

    // 더블 rAF - 페인트 확정 후 실측
    const scheduleMeasure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (cancelled) return;
          syncHitRegions(measureKeyRects());
        });
      });
    };

    scheduleRef.current = scheduleMeasure;
    scheduleMeasure();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      scheduleRef.current = () => {};
    };
  }, [appliedGeneration]);
};

// 히트 창 우클릭 → 기존 네이티브 메뉴 브릿지
export const subscribeHitContextMenu = (
  listener: (pos: { x: number; y: number }) => void,
) => subscribe<{ x: number; y: number }>('overlay-hit-context-menu', listener);
