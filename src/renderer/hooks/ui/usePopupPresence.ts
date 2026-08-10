import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readMotionDuration } from '@utils/animation/motionPreferences';

export type PopupMotionState = 'entering' | 'open' | 'closing';

interface PopupPresenceOptions {
  /** false면 모션 없이 open을 그대로 따른다 */
  enabled?: boolean;
  /** 등장만 건너뛴다 - 재마운트로 다시 나타나는 화면 복귀 경로용. 퇴장은 그대로 */
  skipEnter?: boolean;
  /** 위치 실측이 끝나기 전에는 false - 감춰진 측정 프레임에 등장 모션이 소비되는 걸 막는다 */
  ready?: boolean;
  /**
   * 등퇴장 상태를 실제로 가진 노드. entering 값을 확정시킬 때 이 노드를 직접 측정한다.
   * document 전체 측정은 레이아웃이 이미 깨끗하면 건너뛸 수 있어 배리어로 불안정하다
   */
  motionRef?: React.RefObject<HTMLElement | null>;
  /** 퇴장 길이를 읽을 CSS 변수 */
  exitDurationVar?: string;
  /** 변수를 못 읽을 때 폴백 */
  fallbackExitMs?: number;
}

export interface PopupPresence {
  /** 퇴장 중에도 true - 이게 false가 될 때까지 DOM을 유지한다 */
  mounted: boolean;
  state: PopupMotionState;
  /**
   * 열 때마다 증가한다. 내용에 key로 걸어 '열 때마다 새 인스턴스' 계약을 지킨다.
   * 퇴장 유예가 생기면서 빠른 재오픈이 인스턴스를 재사용하게 됐고,
   * 편집 상태를 마운트 때 한 번만 잡는 컴포넌트는 취소한 값이 되살아난다
   */
  cycle: number;
}

const CLOSED: PopupPresence = { mounted: false, state: 'entering', cycle: 0 };

// 팝업 수명을 열림 여부에서 분리한다. 닫힘 모션이 도는 동안 DOM이 남아야 하므로
// open이 false가 돼도 퇴장 시간만큼은 mounted가 유지된다.
// 닫는 의미 처리(선택 확정, 포커스 복원, 레이어 해제)는 이 유예를 기다리면 안 된다
export const usePopupPresence = (
  open: boolean,
  {
    enabled = true,
    skipEnter = false,
    ready = true,
    motionRef,
    exitDurationVar = '--ui-popup-exit-duration',
    fallbackExitMs = 120,
  }: PopupPresenceOptions = {},
): PopupPresence => {
  const initialState: PopupMotionState = skipEnter ? 'open' : 'entering';
  const [presence, setPresence] = useState<PopupPresence>(() =>
    open ? { mounted: true, state: initialState, cycle: 1 } : CLOSED,
  );
  const exitTimerRef = useRef<number | null>(null);

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current === null) return;
    window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = null;
  }, []);

  const { mounted, state } = presence;

  // 마운트를 paint 전에 끝내야 한다. passive effect로 미루면 실측 기반 팝업의
  // 배치 레이아웃 이펙트가 이미 지나간 뒤라 좌표가 영영 확정되지 않는다
  useLayoutEffect(() => {
    if (!enabled) return;
    if (open) {
      clearExitTimer();
      // 닫히는 중 재오픈은 현재 값에서 이어받는다. entering으로 되돌리면 한 번 튄다.
      // 열림 전환마다 cycle을 올린다. 퇴장 잔상에서 이어받는 경우도 새 사이클이다
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresence((prev) =>
        prev.mounted && prev.state !== 'closing'
          ? prev
          : {
              mounted: true,
              state: prev.mounted ? 'open' : initialState,
              cycle: prev.cycle + 1,
            },
      );
      return;
    }

    if (!mounted) return;
    setPresence((prev) => ({ ...prev, state: 'closing' }));
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      // 완전히 닫혀도 cycle은 유지한다. 0으로 되돌리면 다음 열림 key가 재사용된다
      setPresence((prev) => ({ ...CLOSED, cycle: prev.cycle }));
    }, readMotionDuration(exitDurationVar, fallbackExitMs));

    return clearExitTimer;
  }, [
    clearExitTimer,
    enabled,
    exitDurationVar,
    fallbackExitMs,
    initialState,
    mounted,
    open,
  ]);

  useLayoutEffect(() => {
    // open까지 함께 확인해야 한다. 같은 커밋에 닫힘이 겹치면 첫 이펙트가 기록한
    // closing을 여기서 open으로 덮어써 타이머만 도는 유령 팝업이 남는다
    if (!enabled || !open || !mounted || state !== 'entering' || !ready) return;
    // entering 값을 브라우저에 한 번 확정시킨 뒤 open으로 넘겨야 transition이
    // 시작점을 잡는다. 대상 노드를 직접 읽어야 확실하다 - document 전체 측정은
    // 레이아웃이 이미 깨끗하면 건너뛸 수 있어 배리어로 불안정하다
    const node = motionRef?.current;
    if (node) {
      void window.getComputedStyle(node).opacity;
    } else {
      void document.body.offsetHeight;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresence((prev) => ({ ...prev, state: 'open' }));
  }, [enabled, motionRef, mounted, open, ready, state]);

  // 모션을 끄면 상태 이펙트가 서지 않아 cycle이 멈춘다. 이 경로는 mounted가
  // open을 그대로 따라 닫힐 때마다 통째로 언마운트되므로 key 재사용 자체가 없다
  const bypass = useMemo<PopupPresence>(
    () => ({ mounted: open, state: 'open', cycle: presence.cycle }),
    [open, presence.cycle],
  );

  if (!enabled) return bypass;
  return presence;
};

// 카드 모달용 다이얼. 팝업보다 느긋한 등퇴장을 쓴다
export const useModalPresence = (
  open: boolean,
  options: Omit<
    PopupPresenceOptions,
    'exitDurationVar' | 'fallbackExitMs'
  > = {},
): PopupPresence =>
  usePopupPresence(open, {
    ...options,
    exitDurationVar: '--ui-modal-exit-duration',
    fallbackExitMs: 150,
  });
