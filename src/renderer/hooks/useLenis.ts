import { useEffect, useRef, useState, useCallback } from "react";
import Lenis from "lenis";
import { LENIS_CONFIG } from "@config/lenis";

interface UseLenisOptions {
  /**
   * 스크롤 애니메이션 지속 시간 (초)
   * @default LENIS_CONFIG.duration
   */
  duration?: number;
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
export function useLenis(options: UseLenisOptions = {}) {
  const [wrapper, setWrapper] = useState<HTMLElement | null>(null);
  const wrapperRef = useRef<HTMLElement | null>(null);
  const [scrollbarWidth, setScrollbarWidth] = useState(0);
  const lenisRef = useRef<Lenis | null>(null);
  const onScrollRef = useRef<(() => void) | undefined>(options.onScroll);

  // onScroll 콜백 업데이트 (매 렌더마다)
  onScrollRef.current = options.onScroll;

  const {
    duration = LENIS_CONFIG.duration,
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
      // offsetWidth includes scrollbar, clientWidth excludes it
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
    // NOTE: Lenis의 autoResize는 ResizeObserver로 content 변화를 감지한다.
    // wrapper를 content로 지정하면(=same node) 콘텐츠 높이 변화가 관측되지 않아
    // limit 계산이 갱신되지 않고 스크롤이 중간에 멈출 수 있다.
    const contentEl =
      wrapper.childElementCount === 1
        ? (wrapper.firstElementChild as HTMLElement | null) ?? wrapper
        : wrapper;
    const lenis = new Lenis({
      wrapper,
      content: contentEl,
      duration,
      easing,
      wheelMultiplier,
    });

    lenisRef.current = lenis;

    // Lenis scroll 이벤트 리스너 등록
    const handleLenisScroll = () => {
      onScrollRef.current?.();
    };
    lenis.on("scroll", handleLenisScroll);

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
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(wrapper);
    } else {
      window.addEventListener("resize", onResize);
    }

    // 클린업
    return () => {
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", onResize);
      lenis.off("scroll", handleLenisScroll);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [wrapper, duration, easing, wheelMultiplier]);

  return {
    scrollContainerRef,
    /** 스크롤 컨테이너 DOM 요소 (상태로 관리됨) */
    wrapperElement: wrapper,
    lenisInstance: lenisRef,
    /** wrapper의 실제 스크롤바 너비(px). overlay 스크롤바인 경우 0일 수 있음 */
    scrollbarWidth,
  };
}
