import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '@api/modules/shared';

export interface HitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 리로드 후에도 이전 세션보다 큰 revision을 보내도록 시각 기반 시드
let hitRegionRevision = Date.now();

// OBS 등 커맨드 미지원 컨텍스트의 반복 로그 방지
let syncFailureLogged = false;

const syncHitRegions = (rects: HitRegionRect[]) => {
  hitRegionRevision += 1;
  invoke<void>('overlay_sync_hit_regions', {
    payload: { rects, revision: hitRegionRevision },
  }).catch((error) => {
    if (!syncFailureLogged) {
      syncFailureLogged = true;
      console.warn('Failed to sync overlay hit regions', error);
    }
  });
};

const measureKeyRects = (): HitRegionRect[] => {
  const nodes = document.querySelectorAll<HTMLElement>(
    '[data-key-element="true"]',
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

    scheduleMeasure();
    const unsubscribeUse = subscribe('css:use', scheduleMeasure);
    const unsubscribeContent = subscribe('css:content', scheduleMeasure);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      unsubscribeUse();
      unsubscribeContent();
    };
  }, [appliedGeneration]);
};

// 히트 창 우클릭 → 기존 네이티브 메뉴 브릿지
export const subscribeHitContextMenu = (
  listener: (pos: { x: number; y: number }) => void,
) => subscribe<{ x: number; y: number }>('overlay-hit-context-menu', listener);
