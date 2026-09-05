import {
  panelWindowApi,
  type PanelDragGeometry,
  type PanelDragOutcome,
} from '@api/modules/window/panelWindowApi';
import {
  detachPropertiesPanel,
  dockPropertiesPanel,
  usePanelHostStore,
} from '@stores/grid/usePanelHostStore';
import { getPanelChildWindow } from '@utils/panelWindow/panelChildWindow';

// Windows 전용 네이티브 드래그 세션 - tasks/plan/panel-drag-coordinate-space.md
//
// 이동은 OS 모달 루프가 소유한다. 프론트는 시작(인계)과 종료(terminal 판정)만 맡고
// 이동 중에는 panel:drag-hint / panel:drag-ended 이벤트를 구독할 뿐이다.
// macOS는 이 모듈을 쓰지 않는다 - 기존 moveTo 루프가 그대로 산다

interface NativePanelDragCallbacks {
  // 도크 존이 아직 유효한가 - 설정 화면 등에서 그리드가 사라지면 stale 존 도킹 금지
  dockAreaAlive: () => boolean;
  // docked 스냅백 반경 (CSS px) - usePanelHeaderDrag의 SNAP_BACK_PX
  snapBackPx: number;
  onDockHint: (visible: boolean) => void;
  // terminal 처리까지 끝났다 - 훅이 endSession으로 세션을 정리한다
  onFinished: () => void;
}

export interface NativePanelDragHandle {
  // 인계 전 DOM mouseup - releasedBeforeStart 기록용. 종료 권위는 drag-ended 이벤트
  noteDomMouseUp: (client: { x: number; y: number }) => void;
  // 훅 언마운트 등 강제 정리 - 구독만 걷는다 (OS 드래그는 취소 불가, 백엔드가 자체 정리)
  dispose: () => void;
}

// detach 전환(transition)이 끝나기 전에 drag-ended가 먼저 올 수 있다 -
// idle로 돌아온 뒤 한 번만 terminal을 처리한다 (terminalPending)
const waitForIdleTransition = (): Promise<void> => {
  if (usePanelHostStore.getState().transition === 'idle') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsubscribe = usePanelHostStore.subscribe((state) => {
      if (state.transition === 'idle') {
        unsubscribe();
        resolve();
      }
    });
  });
};

export const startNativePanelDrag = (
  geometry: PanelDragGeometry,
  callbacks: NativePanelDragCallbacks,
): NativePanelDragHandle => {
  let phase: 'starting' | 'dragging' | 'terminal' = 'starting';
  let releaseClient: { x: number; y: number } | null = null;
  let disposed = false;

  const hintSub = panelWindowApi.onDragHint((payload) => {
    if (payload.gestureId !== geometry.gestureId) return;
    // 백엔드는 같은 값을 중복 발행하지 않는다 - 커맨드 응답보다 먼저 온 첫 힌트를
    // 버리면 다시 오지 않으므로 terminal 이전이면 전부 수용한다 (gestureId가 이미 좁힌다)
    if (phase === 'terminal') return;
    const alive = callbacks.dockAreaAlive();
    // 도크 존이 사라졌는데 백엔드가 아직 이전 존으로 판정 중이다 - 즉시 무효화 (live invalidation)
    if (!alive && payload.wouldDock) {
      void panelWindowApi
        .dragDisarmDockZone(geometry.gestureId)
        .catch(() => {});
    }
    callbacks.onDockHint(payload.wouldDock && alive);
  });

  const endedSub = panelWindowApi.onDragEnded((payload) => {
    if (payload.gestureId !== geometry.gestureId) return;
    void finish(payload.outcome, payload.wouldSnapBack);
  });

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    hintSub();
    endedSub();
  };

  // 인계 전에 놓았고 제자리 근처다 - 레거시 releasedWhileTearingOff와 같은 CSS 거리 판정
  const releasedWithinSnapBack = (): boolean => {
    if (!releaseClient) return false;
    return (
      Math.hypot(
        releaseClient.x - geometry.pressClientCss.x,
        releaseClient.y - geometry.pressClientCss.y,
      ) <= callbacks.snapBackPx
    );
  };

  // terminal 도킹 - idle 직후 다른 작업(닫기 요청 등)이 transition을 선점하면 busy가
  // 돌아온다. usePanelCloseRequest처럼 idle을 다시 기다려 재시도한다
  const dockAtTerminal = async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const outcome = await dockPropertiesPanel();
      if (outcome !== 'busy') return;
      await waitForIdleTransition();
    }
    console.warn('패널 드래그 종료 도킹이 계속 밀려 포기했다');
  };

  const finish = async (outcome: PanelDragOutcome, wouldSnapBack?: boolean) => {
    if (phase === 'terminal') return;
    phase = 'terminal';
    await waitForIdleTransition();
    try {
      if (outcome === 'released') {
        // detached는 도크 존 판정이라 존이 사라졌으면 그 자리에 둔다.
        // docked는 스냅백(시작점 거리) 판정이라 존과 무관하게 물어본다
        if (geometry.origin === 'detached' && !callbacks.dockAreaAlive()) {
          return;
        }
        const { wouldDock } = await panelWindowApi.dragHitTest(
          geometry.gestureId,
          geometry.origin,
        );
        if (wouldDock) await dockAtTerminal();
      } else if (outcome === 'escaped') {
        // OS가 창을 드래그 시작 frame으로 복원한다.
        // 막 떼어낸 창의 Esc는 제자리 복귀 - 기존 계약 유지
        if (geometry.origin === 'docked') await dockAtTerminal();
      } else if (outcome === 'releasedBeforeStart') {
        // 백엔드 판정이 우선 - 이벤트가 DOM mouseup보다 먼저 와도 유실되지 않는다.
        // 없으면(구버전 페이로드 등) 프론트가 기록한 해제 좌표로 폴백
        const snapBack = wouldSnapBack ?? releasedWithinSnapBack();
        if (geometry.origin === 'docked' && snapBack) {
          await dockAtTerminal();
        }
      }
      // startFailed / windowDestroyed / canceled: 창 위치는 그대로, 제스처만 종료
    } catch (error) {
      // hit-test 실패는 도킹하지 않고 그 자리에 둔다 - 창을 잃지 않는 쪽이 안전
      console.error('패널 드래그 종료 판정 실패', error);
    } finally {
      cleanup();
      callbacks.onFinished();
    }
  };

  const start = async () => {
    try {
      // 이벤트가 구독보다 먼저 발행되면 유실된다 - 구독 완료 후 인계.
      // 구독 자체가 실패해도 세션이 매달리지 않게 try 안에서 기다린다
      await Promise.all([hintSub.ready, endedSub.ready]);
      if (disposed) return;
      if (geometry.origin === 'docked') {
        // 전환 조정(편집 정산·창 확보·호스트 부착·실패 롤백)은 기존 detach가 소유하고
        // present 자리만 네이티브 인계로 바꾼다. show 이후 실패는 커맨드가 아니라
        // drag-ended 이벤트로 온다 (계약: show가 경계)
        const outcome = await detachPropertiesPanel({
          keepMainFocus: true,
          present: () =>
            panelWindowApi.dragPresentAndStart({
              ...geometry,
              // 첫 tear-off는 자식 창이 이 detach 전환 안에서 생긴다 - mousedown
              // 시점의 null이 굳지 않게 seed를 그릴 창의 DPR을 present 직전에
              // 다시 실측한다. 그래도 못 읽으면 stale 값 대신 null - 출처를
              // 보존해야 백엔드가 main residual로 안전하게 폴백한다
              panelDevicePixelRatio:
                getPanelChildWindow()?.window.devicePixelRatio ?? null,
            }),
        });
        if (outcome !== 'done') {
          cleanup();
          callbacks.onFinished();
          return;
        }
      } else {
        await panelWindowApi.dragStartExisting(geometry);
      }
      if (phase === 'starting') phase = 'dragging';
    } catch (error) {
      // show 이전 거부(PANEL_NOT_OPEN 등) - 창 상태는 안 바뀌었다
      console.error('네이티브 패널 드래그 시작 실패', error);
      void finish(releaseClient ? 'releasedBeforeStart' : 'startFailed');
    }
  };
  void start();

  return {
    noteDomMouseUp: (client) => {
      if (phase === 'starting') releaseClient = client;
    },
    dispose: cleanup,
  };
};
