import { create } from 'zustand';
import type { GradientSpec } from '@src/types/color';

/**
 * 온캔버스 그라데이션 편집 세션 — 피커가 그라데이션 형식으로 열려 있는 동안
 * 그리드 오버레이(각도 핸들)가 어느 요소의 어떤 spec을 편집 중인지 공유
 */

export type GradientCanvasAnchor =
  | { kind: 'key' | 'stat' | 'graph' | 'knob'; index: number }
  | { kind: 'batch' };

/** 편집 중인 표면 — 캔버스 일시 페인트가 어느 필드를 덮을지 결정 */
export type GradientPreviewSurface = 'background' | 'border' | 'counterFill';

export interface GradientEditSession {
  anchor: GradientCanvasAnchor;
  /** 편집 대상 식별자 (요소·필드·상태 포함) — 드래그 소유권 검증 기준.
      같은 요소라도 대기/입력·배경/테두리가 다르면 다른 세션이다 */
  sessionKey: string;
  /** 편집 중인 표면 — 대상 요소가 이 표면을 세션 spec으로 일시 페인트 */
  surface: GradientPreviewSurface;
  spec: GradientSpec;
  /** 피커와 공유하는 선택 스톱 인덱스 */
  selectedIndex: number;
  selectStop: (index: number) => void;
  /** 스펙 적용 — commit=false는 프리뷰(피커 동기), true는 확정 커밋 */
  apply: (spec: GradientSpec, commit: boolean) => void;
}

interface GradientEditState {
  session: GradientEditSession | null;
  /** 소유권 세대 — sessionKey가 실제로 바뀔 때만 증가. 같은 key의 스펙
      재발행(프리뷰)에는 유지되므로, 포인터 이벤트 사이에 A→B→새 A로
      왕복해도 드래그가 세대 불일치로 중단된다 */
  generation: number;
  /** 마지막 비-null 세션의 key — 세대 증가 판정 기준 (null 경유는 무시) */
  lastOwnerKey: string | null;
  setSession: (session: GradientEditSession | null) => void;
}

export const useGradientEditStore = create<GradientEditState>((set) => ({
  session: null,
  generation: 0,
  lastOwnerKey: null,
  setSession: (session) =>
    set((state) =>
      session && session.sessionKey !== state.lastOwnerKey
        ? {
            session,
            lastOwnerKey: session.sessionKey,
            generation: state.generation + 1,
          }
        : { session },
    ),
}));

/**
 * 에디터 leaf용 일시 페인트 구독 — 세션이 이 요소·표면을 편집 중일 때만
 * 세션 spec을 반환한다. 드래그 프리뷰가 저장·히스토리를 거치지 않고
 * 화면에 반영되는 경로. 비대상 요소는 항상 null이라 리렌더 없음
 */
export function useGradientPreviewSpec(
  kind: 'key' | 'stat' | 'graph' | 'knob',
  index: number,
  surface: GradientPreviewSurface,
  isInBatchSelection = false,
): GradientSpec | null {
  return useGradientEditStore((state) => {
    const session = state.session;
    if (!session || session.surface !== surface) return null;
    if (session.anchor.kind === 'batch') {
      return isInBatchSelection ? session.spec : null;
    }
    if (session.anchor.kind !== kind || session.anchor.index !== index) {
      return null;
    }
    return session.spec;
  });
}
