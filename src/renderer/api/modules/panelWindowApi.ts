import { invoke } from '@tauri-apps/api/core';

import { subscribe } from './shared';

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
  startDragging: (clientX: number, clientY: number) =>
    invoke<void>('panel_window_start_dragging', { clientX, clientY }),
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
