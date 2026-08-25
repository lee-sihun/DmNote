import { useLayoutEffect, type RefObject } from 'react';
import {
  useGradientEditStore,
  type GradientEditSession,
} from '@stores/grid/useGradientEditStore';
import { gridAnchorBoundsFor } from '@utils/core/gridAnchorBounds';
import { GLYPH_BOX_CHANGE_EVENT } from './useCounterGlyphPaint';

/**
 * 카운터 표면 편집 세션 동안 실측 카운터 박스를 축 핸들 앵커로 등록한다.
 * 세션이 없거나 카운터 표면이 아니면 아무것도 하지 않는다 (오버레이 창 무해)
 */
export function useCounterAxisAnchor(
  session: GradientEditSession | null,
  hostRef: RefObject<HTMLElement | null>,
  textDep: string | number,
  selector?: string,
) {
  const sessionKey =
    session?.surface === 'counterFill' ? session.sessionKey : null;
  useLayoutEffect(() => {
    if (!sessionKey) return;
    const host = hostRef.current;
    const element = selector
      ? host?.querySelector<HTMLElement>(selector) ?? null
      : host;
    if (!element) return;
    const register = () => {
      let bounds = gridAnchorBoundsFor(element);
      if (!bounds) return;
      // 페인트 박스가 글리프 잉크에 맞춰져 있으면 축도 같은 박스를 쓴다
      // (useCounterGlyphPaint가 기록, 로컬 px = 그리드 px)
      const glyph = element.dataset.dmnGlyphBox?.split(' ').map(Number);
      if (glyph?.length === 4 && glyph.every(Number.isFinite)) {
        bounds = {
          x: bounds.x + glyph[0],
          y: bounds.y + glyph[1],
          width: glyph[2],
          height: glyph[3],
        };
      }
      useGradientEditStore.getState().setAnchorBounds(sessionKey, bounds);
    };
    register();
    // 세션 중 타이포그래피 변경·폰트 지연 로드로 페인트 박스가 이동하면 재등록
    element.addEventListener(GLYPH_BOX_CHANGE_EVENT, register);
    return () => {
      element.removeEventListener(GLYPH_BOX_CHANGE_EVENT, register);
      useGradientEditStore.getState().setAnchorBounds(sessionKey, null);
    };
  }, [sessionKey, hostRef, selector, textDep]);
}
