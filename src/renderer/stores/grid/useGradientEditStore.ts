import { create } from 'zustand';
import type { GradientSpec } from '@src/types/color';

/**
 * 온캔버스 그라데이션 편집 세션 - 피커가 그라데이션 형식으로 열려 있는 동안
 * 그리드 오버레이(각도 핸들)가 어느 요소의 어떤 spec을 편집 중인지 공유
 */

export type GradientCanvasAnchor =
  | { kind: 'key' | 'stat' | 'graph' | 'knob'; id: string }
  | { kind: 'batch' };

/** 편집 중인 표면 - 캔버스 일시 페인트가 어느 필드를 덮을지 결정 */
// 노트 3표면은 그리드에 페인트 소비자가 없고 축 핸들 세션만 사용한다
export type GradientPreviewSurface =
  | 'background'
  | 'border'
  | 'counterFill'
  | 'noteBorder'
  | 'noteBody'
  | 'noteGlow';
export type GradientPreviewState = 'idle' | 'active';

export const supportsActiveVisualState = (
  kind: unknown,
): kind is 'key' | 'knob' => kind === 'key' || kind === 'knob';

export interface GradientEditSession {
  anchor: GradientCanvasAnchor;
  /** 편집 대상 식별자 (요소·필드·상태 포함) - 드래그 소유권 검증 기준.
      같은 요소라도 대기/입력·배경/테두리가 다르면 다른 세션이다 */
  sessionKey: string;
  /** 편집 중인 표면 - 대상 요소가 이 표면을 세션 spec으로 일시 페인트 */
  surface: GradientPreviewSurface;
  /** 캔버스가 함께 보여 줄 상태 - 표면 하나만 active로 섞이는 것을 방지 */
  stateMode: GradientPreviewState;
  spec: GradientSpec;
  /** 피커와 공유하는 선택 스톱 인덱스 */
  selectedIndex: number;
  selectStop: (index: number) => void;
  /** 스펙 적용 - commit=false는 프리뷰(피커 동기), true는 확정 커밋 */
  apply: (spec: GradientSpec, commit: boolean) => void;
}

export interface GradientAnchorBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface GradientEditState {
  session: GradientEditSession | null;
  /** 소유권 세대 - 세션 종료 또는 sessionKey 교체 때 증가. 같은 세션의
      프리뷰 patch에는 유지되므로, 포인터 이벤트 사이에 세션이 닫혔다가
      같은 key로 재개방돼도 이전 드래그가 새 세션을 소유할 수 없다 */
  generation: number;
  /** 현재 소유 세션의 key - 세대 증가 판정 기준 */
  lastOwnerKey: string | null;
  /** 축 핸들이 요소 저장 박스 대신 쓸 실측 앵커 박스 (그리드 좌표).
      카운터처럼 저장 박스와 실제 페인트 박스가 다른 표면이 등록한다 */
  anchorBounds: { sessionKey: string; bounds: GradientAnchorBounds } | null;
  /** 피커 색 표면 드래그 중 - 축 오버레이가 스스로를 흐려 대상이 보이게 한다 */
  colorAdjusting: boolean;
  setSession: (session: GradientEditSession | null) => void;
  /** 같은 세션의 spec·선택만 갱신 - 재발행(null 경유) 없이 알림 1회, 세대 유지 */
  patchSession: (
    sessionKey: string,
    patch: Partial<Pick<GradientEditSession, 'spec' | 'selectedIndex'>>,
  ) => void;
  /** 현재 세션의 앵커 박스 등록·해제 - 다른 세션 key는 무시 */
  setAnchorBounds: (
    sessionKey: string,
    bounds: GradientAnchorBounds | null,
  ) => void;
  setColorAdjusting: (adjusting: boolean) => void;
}

export const useGradientEditStore = create<GradientEditState>((set) => ({
  session: null,
  generation: 0,
  lastOwnerKey: null,
  anchorBounds: null,
  colorAdjusting: false,
  setSession: (session) =>
    set((state) => {
      if (!session) {
        return state.session
          ? {
              session: null,
              lastOwnerKey: null,
              generation: state.generation + 1,
              anchorBounds: null,
            }
          : {};
      }
      return session.sessionKey !== state.lastOwnerKey
        ? {
            session,
            lastOwnerKey: session.sessionKey,
            generation: state.generation + 1,
            anchorBounds: null,
          }
        : { session };
    }),
  patchSession: (sessionKey, patch) =>
    set((state) =>
      state.session && state.session.sessionKey === sessionKey
        ? { session: { ...state.session, ...patch } }
        : {},
    ),
  setAnchorBounds: (sessionKey, bounds) =>
    set((state) => {
      if (state.session?.sessionKey !== sessionKey) return {};
      if (!bounds) {
        return state.anchorBounds?.sessionKey === sessionKey
          ? { anchorBounds: null }
          : {};
      }
      const previous = state.anchorBounds;
      if (
        previous &&
        previous.sessionKey === sessionKey &&
        previous.bounds.x === bounds.x &&
        previous.bounds.y === bounds.y &&
        previous.bounds.width === bounds.width &&
        previous.bounds.height === bounds.height
      ) {
        return {};
      }
      return { anchorBounds: { sessionKey, bounds } };
    }),
  setColorAdjusting: (adjusting) =>
    set((state) =>
      state.colorAdjusting === adjusting ? {} : { colorAdjusting: adjusting },
    ),
}));

/**
 * 에디터 leaf용 일시 페인트 구독 - 세션이 이 요소·표면을 편집 중일 때만
 * 세션 spec을 반환한다. 드래그 프리뷰가 저장·히스토리를 거치지 않고
 * 화면에 반영되는 경로. 비대상 요소는 항상 null이라 리렌더 없음
 */
export function useGradientPreviewSpec(
  kind: 'key' | 'stat' | 'graph' | 'knob',
  id: string,
  surface: GradientPreviewSurface,
  isInBatchSelection = false,
): GradientSpec | null {
  const session = useGradientPreviewSession(kind, id, isInBatchSelection);
  return session?.surface === surface ? session.spec : null;
}

/**
 * 대상 요소의 편집 세션 전체 구독 - spec뿐 아니라 대기/입력 상태도 함께
 * 소비해 배경·보더·글자·카운터가 한 상태로 렌더되게 한다
 */
export function useGradientPreviewSession(
  kind: 'key' | 'stat' | 'graph' | 'knob',
  id: string,
  isInBatchSelection = false,
): GradientEditSession | null {
  return useGradientEditStore((state) => {
    const session = state.session;
    if (!session) return null;
    if (session.anchor.kind === 'batch') {
      if (!isInBatchSelection) return null;
      return session.stateMode !== 'active' || supportsActiveVisualState(kind)
        ? session
        : null;
    }
    if (session.anchor.kind !== kind || session.anchor.id !== id) {
      return null;
    }
    return session;
  });
}
