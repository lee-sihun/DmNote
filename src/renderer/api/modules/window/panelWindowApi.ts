import { invoke } from '@tauri-apps/api/core';

import { subscribe } from '../shared';

// Windows 네이티브 드래그 세션 계약 - tasks/plan/panel-drag-coordinate-space.md
// macOS는 이 경로를 쓰지 않는다 (기존 moveTo 경로 유지)
export interface PanelDragGeometry {
  // 프론트 생성 UUID - 이벤트·커맨드 상관, 이전 제스처 응답 폐기
  gestureId: string;
  origin: 'docked' | 'detached';
  // 커서 - 패널 프레임 좌상단, CSS px. seed 배치에만 쓰고 이후는 OS가 소유
  grabOffsetCss: { x: number; y: number };
  // 최초 mousedown의 메인 창 client 좌표 - docked snapBack 기준점
  pressClientCss: { x: number; y: number };
  // 메인 content 기준 도크 존, CSS px. null이면 도킹 금지
  dockAreaCss: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  // 메인 창 실측 DPR - 접근성 텍스트 배율 보정 줌이 실패해도 CSS 환산이 어긋나지 않게
  // 백엔드가 scale_factor 대비 잔차를 계산한다 (overlay_hit의 실측 DPR 선례)
  mainDevicePixelRatio: number;
  // 패널 자식 창 실측 DPR - seed 순간 헤더를 그리는 표면은 패널 WebView라
  // 두 창의 보정 줌이 비대칭으로 실패해도 seed 앵커가 어긋나지 않게 별도로 보낸다.
  // 자식 창이 아직 없으면 null - 값 폴백이 아니라 출처를 보존해야 백엔드가
  // 잘못된 창 배율로 나누는 오해석이 없다 (백엔드는 main residual로 폴백).
  // docked tear-off는 창 생성 뒤 present 직전 재실측값이 최종이다 - panelNativeDragSession
  panelDevicePixelRatio: number | null;
}

// 네이티브 이동 루프의 종료 사유 - released일 때만 hit-test.
// canceled: 드래그 도중 생명주기 정리(도킹·트레이 숨김)가 제스처를 걷어갔다 - 정리만 하고 끝낸다
export type PanelDragOutcome =
  | 'released'
  | 'escaped'
  | 'releasedBeforeStart'
  | 'startFailed'
  | 'windowDestroyed'
  | 'canceled';

// 네이티브가 창 가장자리를 얼마나 가져갔는지 - 렌더러는 남은 몫만 그린다
export interface PanelWindowChrome {
  // 웹이 그릴 모서리 반경(px). 네이티브가 실루엣을 소유하면 0
  webRadius: number;
  // 웹이 1px 인셋 링을 그려야 하는지. 네이티브가 라인을 그리면 false
  webRing: boolean;
}

// 분리 패널 창 제어. 창은 메인 웹뷰의 window.open으로만 생기고(opener 자식) 그 뒤로는
// present(show)/dock(hide)만 오간다 - 자세한 수명 규칙은 utils/panelWindow/panelChildWindow.ts
export const panelWindowApi = {
  // window.open 직전 arm - 이어지는 요청 하나만 패널 창으로 인정된다
  armOpen: () => invoke<void>('panel_window_arm_open'),
  // 도킹(hide)돼 있던 창을 다시 띄운다. 창이 없으면 실패
  present: () => invoke<void>('panel_window_present'),
  // 드래그 드롭 위치(논리 좌표, 창 좌상단)에 띄운다. focus=false는 드래그 도중 tear-off용
  presentAt: (x: number, y: number, focus: boolean) =>
    invoke<void>('panel_window_present_at', { x, y, focus }),
  // 드래그 중 창 이동 (논리 좌표, 창 좌상단)
  moveTo: (x: number, y: number) =>
    invoke<void>('panel_window_move_to', { x, y }),
  // 저장된 위치·크기를 버리고 기본 배치(메인 창 옆)로 되돌린다.
  // 창이 없으면 저장값만 비운다 - 창을 새로 보이거나 포커스를 옮기지 않는다
  resetPosition: () => invoke<void>('panel_window_reset_position'),
  // 실제 mouseDown 소유 창과 분리 창의 네이티브 커서를 Rust에서 함께 전환
  setDragCursor: (active: boolean) =>
    invoke<void>('panel_window_set_drag_cursor', { active }),
  // 헤더 드래그 세션 컨텍스트 - 도크 존 판정 기준 좌표. content 원점은 백엔드 실측
  // (프레임리스+그림자 창의 인셋을 렌더러의 outerWidth-innerWidth로는 못 잡는다 - WebView2에선 0)
  dragContext: () =>
    invoke<{
      // content 원점 실측 실패 시 근사 폴백용 outer 프레임
      mainFrame: { x: number; y: number; width: number; height: number } | null;
      mainContentOrigin: { x: number; y: number } | null;
    }>('panel_window_drag_context'),
  // 창을 감춘다 - 파괴하지 않는다
  dock: () => invoke<void>('panel_window_dock'),
  // 기동 시 "분리 상태로 종료했다" 복원 요청 1회 소비
  takeRestoreRequest: () =>
    invoke<boolean>('panel_window_take_restore_request'),
  // Windows 전용 - docked tear-off: seed 배치 + show + 네이티브 드래그 인계를 한 트랜잭션으로.
  // WM_ENTERSIZEMOVE 관측 뒤에만 성공으로 확정된다
  dragPresentAndStart: (geometry: PanelDragGeometry) =>
    invoke<void>('panel_drag_present_and_start', { geometry }),
  // Windows 전용 - 이미 분리된 창: 위치를 바꾸지 않고 인계만
  dragStartExisting: (geometry: PanelDragGeometry) =>
    invoke<void>('panel_drag_start_existing', { geometry }),
  // 드래그 중 도크 존 무효화 - 설정 화면 등에서 그리드가 사라지면 백엔드 판정을 멈춘다
  dragDisarmDockZone: (gestureId: string) =>
    invoke<void>('panel_drag_disarm_dock_zone', { gestureId }),
  // 종료(outcome=released) 후 1회 - 판정 기준은 백엔드의 released 영수증이 들고 있어
  // 식별자만 보낸다
  dragHitTest: (gestureId: string, origin: PanelDragGeometry['origin']) =>
    invoke<{ gestureId: string; wouldDock: boolean }>('panel_drag_hit_test', {
      gestureId,
      origin,
    }),
  // 네이티브 드래그 중 도크 존 위 여부 - 값이 바뀔 때만 발행
  onDragHint: (
    listener: (payload: { gestureId: string; wouldDock: boolean }) => void,
  ) =>
    subscribe<{ gestureId: string; wouldDock: boolean }>(
      'panel:drag-hint',
      listener,
    ),
  // 네이티브 이동 루프 종료 - Windows Dragging 단계의 유일한 종료 권위.
  // wouldSnapBack: releasedBeforeStart 한정, 백엔드가 해제 시점 커서로 계산한 스냅백 판정
  // (DOM mouseup보다 이벤트가 먼저 와도 판정이 유실되지 않게)
  onDragEnded: (
    listener: (payload: {
      gestureId: string;
      outcome: PanelDragOutcome;
      wouldSnapBack?: boolean;
    }) => void,
  ) =>
    subscribe<{
      gestureId: string;
      outcome: PanelDragOutcome;
      wouldSnapBack?: boolean;
    }>('panel:drag-ended', listener),
  // 창 가장자리 표면을 네이티브 레이어에 위임 - 리사이즈 프레임을 못 따라오는
  // 웹 페인트 대신 면과 1px 라인을 컴포지터가 그린다.
  // 반환값은 네이티브가 가져가고 남은 몫 - 렌더러는 그것만 그린다
  applyNativeChrome: (
    fill: [number, number, number, number],
    line: [number, number, number, number],
  ) =>
    invoke<PanelWindowChrome>('panel_window_apply_native_chrome', {
      fill,
      line,
    }),
  // X 버튼 ack - 제한 시간 내 미호출 시 백엔드가 fallback으로 창을 감춘다
  ackClose: (requestId: string) =>
    invoke<boolean>('panel_window_close_ack', { requestId }),
  onVisibility: (
    listener: (payload: {
      visible: boolean;
      // visible=false 한정 - 정상 도킹과 창 파괴(종료) 구분
      reason?: 'closed' | 'destroyed';
    }) => void,
  ) =>
    subscribe<{ visible: boolean; reason?: 'closed' | 'destroyed' }>(
      'panel:visibility',
      listener,
    ),
  onCloseRequested: (listener: (payload: { requestId: string }) => void) =>
    subscribe<{ requestId: string }>('panel:close-requested', listener),
};
