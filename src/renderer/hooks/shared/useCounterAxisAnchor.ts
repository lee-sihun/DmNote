import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  useGradientEditStore,
  type GradientEditSession,
  type GradientPreviewSurface,
} from '@stores/grid/useGradientEditStore';
import { gridAnchorBoundsFor } from '@utils/core/gridAnchorBounds';
import { rotatePointAround } from '@utils/core/rotation';
import { GLYPH_BOX_CHANGE_EVENT } from './useCounterGlyphPaint';

/**
 * 표면 편집 세션 동안 실측 박스를 축 핸들 앵커로 등록한다.
 * 단일 요소 세션만 등록 - 배치는 같은 sessionKey를 여러 작성자가
 * 덮어쓰므로 요소 합집합 폴백(GradientAxisHandle 기본 경로)을 쓴다.
 * 세션이 없거나 표면이 다르면 아무것도 하지 않는다 (오버레이 창 무해)
 */
export function useCounterAxisAnchor(
  session: GradientEditSession | null,
  hostRef: RefObject<HTMLElement | null>,
  textDep: string | number,
  selector?: string,
  expectedSurface: GradientPreviewSurface = 'counterFill',
  origin?: { x: number; y: number },
  rotation = 0,
) {
  const sessionKey =
    session?.surface === expectedSurface && session.anchor.kind !== 'batch'
      ? session.sessionKey
      : null;
  // 등록 시점 요소 저장 좌표 - 축 핸들이 이후 이동을 델타로 추종.
  // ref 경유로 읽어 좌표 변화가 재등록(레이아웃 읽기)을 유발하지 않게 한다
  const originRef = useRef(origin);
  useLayoutEffect(() => {
    originRef.current = origin;
  });
  useLayoutEffect(() => {
    if (!sessionKey) return;
    const host = hostRef.current;
    const element = selector
      ? host?.querySelector<HTMLElement>(selector) ?? null
      : host;
    if (!element) return;
    const register = () => {
      let bounds = gridAnchorBoundsFor(element, rotation);
      if (!bounds) return;
      // 페인트 박스가 글리프 잉크에 맞춰져 있으면 축도 같은 박스를 쓴다
      // (useCounterGlyphPaint가 기록, 로컬 px = 그리드 px)
      const glyph = element.dataset.dmnGlyphBox?.split(' ').map(Number);
      if (glyph?.length === 4 && glyph.every(Number.isFinite)) {
        const glyphCenter = rotatePointAround(
          {
            x: bounds.x + glyph[0] + glyph[2] / 2,
            y: bounds.y + glyph[1] + glyph[3] / 2,
          },
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
          rotation,
        );
        bounds = {
          x:
            rotation === 0 ? bounds.x + glyph[0] : glyphCenter.x - glyph[2] / 2,
          y:
            rotation === 0 ? bounds.y + glyph[1] : glyphCenter.y - glyph[3] / 2,
          width: glyph[2],
          height: glyph[3],
          ...(rotation !== 0 ? { rotation } : {}),
        };
      }
      useGradientEditStore
        .getState()
        .setAnchorBounds(sessionKey, bounds, originRef.current ?? null);
    };
    register();
    // 세션 중 타이포그래피 변경·폰트 지연 로드로 페인트 박스가 이동하면 재등록
    element.addEventListener(GLYPH_BOX_CHANGE_EVENT, register);
    // 라벨 줄바꿈·웹폰트 로드처럼 이벤트 없는 크기 변화도 추적
    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => register())
        : null;
    observer?.observe(element);
    return () => {
      element.removeEventListener(GLYPH_BOX_CHANGE_EVENT, register);
      observer?.disconnect();
      useGradientEditStore.getState().setAnchorBounds(sessionKey, null);
    };
  }, [sessionKey, hostRef, selector, textDep, rotation]);
}
