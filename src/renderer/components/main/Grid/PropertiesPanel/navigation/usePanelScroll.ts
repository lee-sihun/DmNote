import { useCallback } from 'react';
import { useLenis } from '@hooks/useLenis';
import { TABS, TabType } from '../types';

interface UsePanelScrollReturn {
  // 탭별 keepalive 뷰포트에 Lenis 스무스 스크롤 연결
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
}

export function usePanelScroll(): UsePanelScrollReturn {
  // 탭별 6개 인스턴스 (batch 3 + single 3) — 뷰포트가 keepalive라 각자 유지
  const { scrollContainerRef: batchLenisStyleRef } = useLenis();
  const { scrollContainerRef: batchLenisNoteRef } = useLenis();
  const { scrollContainerRef: batchLenisCounterRef } = useLenis();
  const { scrollContainerRef: singleLenisStyleRef } = useLenis();
  const { scrollContainerRef: singleLenisNoteRef } = useLenis();
  const { scrollContainerRef: singleLenisCounterRef } = useLenis();

  const batchScrollRefFor = useCallback(
    (tab: TabType) => (node: HTMLDivElement | null) => {
      if (tab === TABS.STYLE) batchLenisStyleRef(node);
      if (tab === TABS.NOTE) batchLenisNoteRef(node);
      if (tab === TABS.COUNTER) batchLenisCounterRef(node);
    },
    [batchLenisStyleRef, batchLenisNoteRef, batchLenisCounterRef],
  );

  const singleScrollRefFor = useCallback(
    (tab: TabType) => (node: HTMLDivElement | null) => {
      if (tab === TABS.STYLE) singleLenisStyleRef(node);
      if (tab === TABS.NOTE) singleLenisNoteRef(node);
      if (tab === TABS.COUNTER) singleLenisCounterRef(node);
    },
    [singleLenisStyleRef, singleLenisNoteRef, singleLenisCounterRef],
  );

  return { batchScrollRefFor, singleScrollRefFor };
}
