import { invoke } from '@tauri-apps/api/core';

import { subscribe } from './shared';

// 분리 패널 창 제어. 창은 메인 웹뷰의 window.open으로만 생기고(opener 자식) 그 뒤로는
// present(show)/dock(hide)만 오간다 - 자세한 수명 규칙은 utils/panelWindow/panelChildWindow.ts
export const panelWindowApi = {
  // window.open 직전 arm - 이어지는 요청 하나만 패널 창으로 인정된다
  armOpen: () => invoke<void>('panel_window_arm_open'),
  // 도킹(hide)돼 있던 창을 다시 띄운다. 창이 없으면 실패
  present: () => invoke<void>('panel_window_present'),
  // 창을 감춘다 - 파괴하지 않는다
  dock: () => invoke<void>('panel_window_dock'),
  // 기동 시 "분리 상태로 종료했다" 복원 요청 1회 소비
  takeRestoreRequest: () =>
    invoke<boolean>('panel_window_take_restore_request'),
  startDragging: (clientX: number, clientY: number) =>
    invoke<void>('panel_window_start_dragging', { clientX, clientY }),
  // 창 가장자리 표면을 네이티브 레이어에 위임 - 리사이즈 프레임을 못 따라오는
  // 웹 페인트 대신 면과 1px 라인을 컴포지터가 그린다. true면 CSS 링은 그리지 않음
  applyNativeChrome: (
    fill: [number, number, number, number],
    line: [number, number, number, number],
  ) => invoke<boolean>('panel_window_apply_native_chrome', { fill, line }),
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
