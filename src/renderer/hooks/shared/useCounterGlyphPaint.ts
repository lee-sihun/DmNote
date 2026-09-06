import { useLayoutEffect, useRef, type RefObject } from 'react';
import { measureCounterGlyphBox } from '@utils/counter/counterGlyphMetrics';

const POSITION_VAR = '--dmn-counter-fill-position-default';
const SIZE_VAR = '--dmn-counter-fill-size-default';

// 글리프 박스 재측정을 같은 요소의 축 앵커에 알리는 로컬 이벤트
export const GLYPH_BOX_CHANGE_EVENT = 'dmn-glyph-box-change';

const NOOP = () => {};

/**
 * 그라데이션 카운터의 페인트 박스를 글리프 잉크 범위에 맞춘다.
 * 측정값을 background-position/size 기본 변수로 스팬에 직접 반영하고,
 * 축 앵커가 같은 박스를 읽도록 dataset에도 기록한다.
 * 카운터 텍스트는 입력마다 바뀌므로 측정 effect와 리스너·옵저버 effect를
 * 분리해 값 변경이 리스너 재등록·옵저버 재생성을 일으키지 않게 한다.
 * 그라데이션이 아닐 때는 아무것도 남기지 않는다 (측정 비용 0)
 */
export function useCounterGlyphPaint(
  ref: RefObject<HTMLElement | null>,
  hasGradient: boolean,
  textDep: string | number,
  typographyDep: string,
) {
  const applyRef = useRef<() => void>(NOOP);

  // 측정 - 값·타이포그래피 변경마다
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
      applyRef.current = NOOP;
      // 남긴 박스가 없으면 무비용 - 단색 카운터가 값 변경마다 정리·통지를 반복하지 않게
      if (el.dataset.dmnGlyphBox === undefined) return;
      clear();
      notify();
      return;
    }
    const apply = () => {
      const box = measureCounterGlyphBox(el);
      if (!box) {
        // 측정 실패 시 이전 박스를 남기지 않는다 - 폴백은 박스 전체 페인트
        clear();
      } else {
        el.style.setProperty(POSITION_VAR, `${box.x}px ${box.y}px`);
        el.style.setProperty(SIZE_VAR, `${box.width}px ${box.height}px`);
        el.dataset.dmnGlyphBox = `${box.x} ${box.y} ${box.width} ${box.height}`;
      }
      notify();
    };
    applyRef.current = apply;
    apply();
  }, [ref, hasGradient, textDep, typographyDep]);

  // 재측정 트리거 - 그라데이션 여부가 바뀔 때만 붙였다 뗀다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !hasGradient) return;
    const reapply = () => applyRef.current();
    // 커스텀 폰트 지연 로드 - 메트릭이 바뀌므로 로드 완료 시 재측정
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', reapply);
    // 커스텀 CSS는 요소 크기를 안 바꿔도 메트릭을 바꿀 수 있다 (라벨 훅과 동일 계약)
    window.addEventListener('dmn-custom-css-applied', reapply);
    // 뷰포트 상대 단위·컨테이너발 크기 변화 재측정. observe 직후의 최초 통지는
    // 방금 측정한 크기라 건너뛰고 실제 크기 변화에만 반응한다
    let lastSize = `${el.offsetWidth}x${el.offsetHeight}`;
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const size = `${el.offsetWidth}x${el.offsetHeight}`;
            if (size === lastSize) return;
            lastSize = size;
            reapply();
          })
        : null;
    observer?.observe(el);
    return () => {
      fonts?.removeEventListener?.('loadingdone', reapply);
      window.removeEventListener('dmn-custom-css-applied', reapply);
      observer?.disconnect();
    };
  }, [ref, hasGradient]);
}
