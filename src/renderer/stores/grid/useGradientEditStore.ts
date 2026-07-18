import { create } from 'zustand';
import type { GradientSpec } from '@src/types/color';

/**
 * 온캔버스 그라데이션 편집 세션 — 피커가 그라데이션 형식으로 열려 있는 동안
 * 그리드 오버레이(각도 핸들)가 어느 요소의 어떤 spec을 편집 중인지 공유
 */

export type GradientCanvasAnchor =
  | { kind: 'key' | 'stat' | 'graph' | 'knob'; index: number }
  | { kind: 'batch' };

export interface GradientEditSession {
  anchor: GradientCanvasAnchor;
  spec: GradientSpec;
  /** 피커와 공유하는 선택 스톱 인덱스 */
  selectedIndex: number;
  selectStop: (index: number) => void;
  /** 스펙 적용 — commit=false는 프리뷰(피커 동기), true는 확정 커밋 */
  apply: (spec: GradientSpec, commit: boolean) => void;
}

interface GradientEditState {
  session: GradientEditSession | null;
  setSession: (session: GradientEditSession | null) => void;
}

export const useGradientEditStore = create<GradientEditState>((set) => ({
  session: null,
  setSession: (session) => set({ session }),
}));
