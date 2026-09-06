import { useLayoutEffect, useRef, type RefObject } from 'react';
import { measureLabelGlyphBox } from '@utils/counter/counterGlyphMetrics';
import { GLYPH_BOX_CHANGE_EVENT } from './useCounterGlyphPaint';
import type { CounterGlyphBox } from '@utils/counter/counterGlyphMetrics';

const POSITION_VAR = '--dmn-key-text-position-default';
const SIZE_VAR = '--dmn-key-text-size-default';

// 캐시 상한 - 라벨·타이포 조합은 상태 2종 정도라 넉넉
const CACHE_LIMIT = 8;

/**
 * 그라데이션 라벨의 페인트 박스를 글리프 잉크 범위에 맞춘다.
 * 카운터와 같은 계약(변수·dataset·이벤트)을 쓰되, 라벨은 텍스트가 정적이라
 * (텍스트, 타이포그래피) 조합별로 측정을 캐시해 입력 상태 토글마다
 * 레이아웃 읽기가 반복되지 않게 한다. 폰트 지연 로드와 커스텀 CSS 적용은
 * 캐시를 비우고 재측정한다. 그라데이션이 아닐 때는 아무것도 남기지 않는다
 */
export function useLabelGlyphPaint(
  ref: RefObject<HTMLElement | null>,
  hasGradient: boolean,
  labelText: string,
  typographyDep: string,
) {
  const cacheRef = useRef<Map<string, CounterGlyphBox | null>>(new Map());
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const notify = () => el.dispatchEvent(new Event(GLYPH_BOX_CHANGE_EVENT));
    const clear = () => {
      el.style.removeProperty(POSITION_VAR);
      el.style.removeProperty(SIZE_VAR);
      delete el.dataset.dmnGlyphBox;
    };
    if (!hasGradient) {
      // 남긴 박스가 없으면 무비용 - 단색 라벨의 리렌더마다 정리·통지 방지
      if (el.dataset.dmnGlyphBox === undefined) return;
      clear();
      notify();
      return;
    }
    const cache = cacheRef.current;
    const apply = () => {
      // 폭 포함 - 컨테이너 리사이즈로 줄바꿈이 바뀌면 캐시를 지나 재측정
      const cacheKey = `${labelText}|${typographyDep}|${el.offsetWidth}`;
      let box = cache.get(cacheKey);
      if (box === undefined) {
        box = measureLabelGlyphBox(el, labelText);
        if (cache.size >= CACHE_LIMIT) cache.clear();
        cache.set(cacheKey, box);
      }
      if (!box) {
        // 측정 실패·폴백 조건은 이전 박스를 남기지 않는다 - 줄 박스 전체 페인트
        clear();
      } else {
        el.style.setProperty(POSITION_VAR, `${box.x}px ${box.y}px`);
        el.style.setProperty(SIZE_VAR, `${box.width}px ${box.height}px`);
        el.dataset.dmnGlyphBox = `${box.x} ${box.y} ${box.width} ${box.height}`;
      }
      notify();
    };
    apply();
    const invalidate = () => {
      cache.clear();
      apply();
    };
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', invalidate);
    // 커스텀 CSS는 요소 크기를 안 바꿔도 메트릭을 바꿀 수 있다
    window.addEventListener('dmn-custom-css-applied', invalidate);
    // 리사이즈 재측정 - 같은 폭이면 캐시 적중이라 무비용
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => apply())
        : null;
    observer?.observe(el);
    return () => {
      fonts?.removeEventListener?.('loadingdone', invalidate);
      window.removeEventListener('dmn-custom-css-applied', invalidate);
      observer?.disconnect();
    };
  }, [ref, hasGradient, labelText, typographyDep]);
}
