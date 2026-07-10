import { useCallback, useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';
import { LENIS_CONFIG } from '@config/lenis';

interface UseLenisOptions {
  /**
   * 스크롤 애니메이션 지속 시간 (초)
   * 지정 시 duration+easing 방식, 미지정 시 lerp 방식 (기본)
   */
  duration?: number;
  /**
   * 목표점 추적 강도 (0~1)
   * @default LENIS_CONFIG.lerp
   */
  lerp?: number;
  /**
   * 이징 함수
   * @default easeOutExpo
   */
  easing?: (t: number) => number;
  /**
   * 휠 이벤트 multiplier
   * @default LENIS_CONFIG.wheelMultiplier
   */
  wheelMultiplier?: number;
  /**
   * 터치 이벤트 multiplier
   * @default LENIS_CONFIG.touchMultiplier
   */
  touchMultiplier?: number;
  /**
   * 스크롤 이벤트 콜백
   * Lenis 스크롤 발생 시 호출됨
   */
  onScroll?: () => void;
}

// easeOutExpo 이징 함수
const easeOutExpo = (t: number): number => {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
};

/**
 * Lenis smooth scroll을 특정 컨테이너에 적용하는 훅
 * @param options Lenis 옵션 (미지정 시 전역 설정 사용)
 * @returns scrollContainerRef - 스크롤 컨테이너에 연결할 ref (callback ref)
 */
export const useLenis = (options: UseLenisOptions = {}) => {
  const [wrapper, setWrapper] = useState<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const lenisRef = useRef<Lenis | null>(null);
  const onScrollRef = useRef<(() => void) | undefined>(options.onScroll);

  // onScroll 콜백 업데이트
  useEffect(() => {
    onScrollRef.current = options.onScroll;
  }, [options.onScroll]);

  const {
    duration,
    lerp = LENIS_CONFIG.lerp,
    easing = easeOutExpo,
    wheelMultiplier = LENIS_CONFIG.wheelMultiplier,
  } = options;

  // callback ref - DOM 요소가 마운트/언마운트될 때 호출됨
  const scrollContainerRef = useCallback((node: HTMLElement | null) => {
    if (wrapperRef.current === node) return;
    wrapperRef.current = node;
    setWrapper(node);
  }, []);

  useEffect(() => {
    if (!wrapper) return;

    const computeScrollbarWidth = () => {
      // offsetWidth는 스크롤바 포함, clientWidth는 스크롤바 제외
      const width = Math.max(0, wrapper.offsetWidth - wrapper.clientWidth);
      setScrollbarWidth((prev) => (prev === width ? prev : width));
    };

    computeScrollbarWidth();

    // 기존 Lenis 인스턴스 정리
    if (lenisRef.current) {
      lenisRef.current.destroy();
      lenisRef.current = null;
    }

    // Lenis 인스턴스 생성
    // 참고: Lenis의 autoResize는 ResizeObserver로 content 변화를 감지한다.
    // wrapper를 content로 지정하면(=동일 노드) 콘텐츠 높이 변화가 관측되지 않아
    // limit 계산이 갱신되지 않고 스크롤이 중간에 멈출 수 있다.
    const contentEl =
      wrapper.childElementCount === 1
        ? (wrapper.firstElementChild as HTMLElement | null) ?? wrapper
        : wrapper;
    // duration 미지정 시 lerp 방식 — 꼬리 구간의 서브픽셀 계단(드르륵) 없이 연속 추적
    const lenis = new Lenis({
      wrapper,
      content: contentEl,
      ...(duration != null ? { duration, easing } : { lerp }),
      wheelMultiplier,
    });

    lenisRef.current = lenis;

    // Lenis scroll 이벤트 리스너 등록
    // 스크롤 중에만 is-scrolling 클래스 유지 — 스크롤바 자동 숨김용
    let scrollingTimer: ReturnType<typeof setTimeout> | null = null;
    const handleLenisScroll = () => {
      wrapper.classList.add('is-scrolling');
      if (scrollingTimer) clearTimeout(scrollingTimer);
      scrollingTimer = setTimeout(() => {
        wrapper.classList.remove('is-scrolling');
      }, 600);
      onScrollRef.current?.();
    };
    lenis.on('scroll', handleLenisScroll);

    // RAF 루프 시작
    let rafId: number;
    const raf = (time: number) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    // 스크롤바 너비 변화를 감지 (OS/시스템 설정에 따라 스크롤바가 레이아웃 폭을 차지할 수 있음)
    let ro: ResizeObserver | null = null;
    const onResize = () => computeScrollbarWidth();
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(wrapper);
    } else {
      window.addEventListener('resize', onResize);
    }

    // 클린업
    return () => {
      cancelAnimationFrame(rafId);
      if (scrollingTimer) clearTimeout(scrollingTimer);
      wrapper.classList.remove('is-scrolling');
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', onResize);
      lenis.off('scroll', handleLenisScroll);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [wrapper, duration, lerp, easing, wheelMultiplier]);

  return {
    scrollContainerRef,
    /** 스크롤 컨테이너 DOM 요소 (state로 관리됨) */
    wrapperElement: wrapper,
    lenisInstance: lenisRef,
    /** wrapper의 실제 스크롤바 너비(px). overlay 스크롤바인 경우 0일 수 있음 */
    scrollbarWidth,
  };
};
