import { useCallback, useEffect, useRef } from 'react';
import { useLenis } from '@hooks/useLenis';
import { TABS, TabType } from './types';

interface ScrollThumbState {
  top: number;
  height: number;
  visible: boolean;
}

interface UsePanelScrollReturn {
  // 일괄 스크롤 ref
  batchScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  batchThumbRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  // 단일 스크롤 ref
  singleScrollRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  singleThumbRefFor: (tab: TabType) => (node: HTMLDivElement | null) => void;
  // 수동 thumb 업데이트
  updateThumbs: (tab: TabType) => void;
}

export function usePanelScroll(
  activeTab: TabType,
  selectedElementsLength: number,
): UsePanelScrollReturn {
  // Thumb refs (탭별, 직접 DOM 조작으로 리렌더링 방지)
  const batchThumbRefs = useRef<Record<TabType, HTMLDivElement | null>>({
    [TABS.STYLE]: null,
    [TABS.NOTE]: null,
    [TABS.COUNTER]: null,
  });
  const singleThumbRefs = useRef<Record<TabType, HTMLDivElement | null>>({
    [TABS.STYLE]: null,
    [TABS.NOTE]: null,
    [TABS.COUNTER]: null,
  });

  // Scroll element refs (탭별, thumb 계산용)
  const batchScrollElementRefs = useRef<Record<TabType, HTMLDivElement | null>>(
    {
      [TABS.STYLE]: null,
      [TABS.NOTE]: null,
      [TABS.COUNTER]: null,
    },
  );
  const singleScrollElementRefs = useRef<
    Record<TabType, HTMLDivElement | null>
  >({
    [TABS.STYLE]: null,
    [TABS.NOTE]: null,
    [TABS.COUNTER]: null,
  });

  const calculateThumb = useCallback((el: HTMLDivElement): ScrollThumbState => {
    const { scrollTop, scrollHeight, clientHeight } = el;
    const canScroll = scrollHeight > clientHeight + 1;
    if (!canScroll) return { top: 0, height: 0, visible: false };

    const minThumbHeight = 16;
    const height = Math.max(
      minThumbHeight,
      (clientHeight / scrollHeight) * clientHeight,
    );
    const maxTop = clientHeight - height;
    const top =
      maxTop <= 0 ? 0 : (scrollTop / (scrollHeight - clientHeight)) * maxTop;

    return { top, height, visible: true };
  }, []);

  // thumb DOM 직접 업데이트 (리렌더링 없이 성능 최적화)
  const updateThumbDOM = useCallback(
    (thumbEl: HTMLDivElement | null, scrollEl: HTMLDivElement | null) => {
      if (!thumbEl || !scrollEl) return;
      const thumb = calculateThumb(scrollEl);
      thumbEl.style.top = `${thumb.top}px`;
      thumbEl.style.height = `${thumb.height}px`;
      thumbEl.style.display = thumb.visible ? 'block' : 'none';
    },
    [calculateThumb],
  );

  // Lenis 스크롤 적용 (탭별 6개 훅: batch 3개 + single 3개)
  const { scrollContainerRef: batchLenisStyleRef } = useLenis({
    onScroll: useCallback(() => {
      updateThumbDOM(
        batchThumbRefs.current[TABS.STYLE],
        batchScrollElementRefs.current[TABS.STYLE],
      );
    }, [updateThumbDOM]),
  });
  const { scrollContainerRef: batchLenisNoteRef } = useLenis({
    onScroll: useCallback(() => {
      updateThumbDOM(
        batchThumbRefs.current[TABS.NOTE],
        batchScrollElementRefs.current[TABS.NOTE],
      );
    }, [updateThumbDOM]),
  });
  const { scrollContainerRef: batchLenisCounterRef } = useLenis({
    onScroll: useCallback(() => {
      updateThumbDOM(
        batchThumbRefs.current[TABS.COUNTER],
        batchScrollElementRefs.current[TABS.COUNTER],
      );
    }, [updateThumbDOM]),
  });

  const { scrollContainerRef: singleLenisStyleRef } = useLenis({
    onScroll: useCallback(() => {
      updateThumbDOM(
        singleThumbRefs.current[TABS.STYLE],
        singleScrollElementRefs.current[TABS.STYLE],
      );
    }, [updateThumbDOM]),
  });
  const { scrollContainerRef: singleLenisNoteRef } = useLenis({
    onScroll: useCallback(() => {
      updateThumbDOM(
        singleThumbRefs.current[TABS.NOTE],
        singleScrollElementRefs.current[TABS.NOTE],
      );
    }, [updateThumbDOM]),
  });
  const { scrollContainerRef: singleLenisCounterRef } = useLenis({
    onScroll: useCallback(() => {
      updateThumbDOM(
        singleThumbRefs.current[TABS.COUNTER],
        singleScrollElementRefs.current[TABS.COUNTER],
      );
    }, [updateThumbDOM]),
  });

  // callback ref를 합성하여 Lenis와 내부 ref 모두 업데이트 (탭별)
  const batchScrollRefFor = useCallback(
    (tab: TabType) => (node: HTMLDivElement | null) => {
      batchScrollElementRefs.current[tab] = node;
      if (tab === TABS.STYLE) batchLenisStyleRef(node);
      if (tab === TABS.NOTE) batchLenisNoteRef(node);
      if (tab === TABS.COUNTER) batchLenisCounterRef(node);
    },
    [batchLenisStyleRef, batchLenisNoteRef, batchLenisCounterRef],
  );

  const singleScrollRefFor = useCallback(
    (tab: TabType) => (node: HTMLDivElement | null) => {
      singleScrollElementRefs.current[tab] = node;
      if (tab === TABS.STYLE) singleLenisStyleRef(node);
      if (tab === TABS.NOTE) singleLenisNoteRef(node);
      if (tab === TABS.COUNTER) singleLenisCounterRef(node);
    },
    [singleLenisStyleRef, singleLenisNoteRef, singleLenisCounterRef],
  );

  const batchThumbRefFor = useCallback(
    (tab: TabType) => (node: HTMLDivElement | null) => {
      batchThumbRefs.current[tab] = node;
    },
    [],
  );

  const singleThumbRefFor = useCallback(
    (tab: TabType) => (node: HTMLDivElement | null) => {
      singleThumbRefs.current[tab] = node;
    },
    [],
  );

  const updateThumbs = useCallback(
    (tab: TabType) => {
      updateThumbDOM(
        batchThumbRefs.current[tab],
        batchScrollElementRefs.current[tab],
      );
      updateThumbDOM(
        singleThumbRefs.current[tab],
        singleScrollElementRefs.current[tab],
      );
    },
    [updateThumbDOM],
  );

  // 탭 변경 또는 선택 변경 시 thumb 업데이트
  useEffect(() => {
    updateThumbs(activeTab);
  }, [updateThumbs, activeTab, selectedElementsLength]);

  return {
    batchScrollRefFor,
    batchThumbRefFor,
    singleScrollRefFor,
    singleThumbRefFor,
    updateThumbs,
  };
}
