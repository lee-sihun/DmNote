import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '../shared';

import type {
  OverlayBounds,
  OverlayAnchorPayload,
  OverlayLockPayload,
  OverlayResizePayload,
  OverlayState,
  OverlayVisibilityPayload,
} from '@src/types/plugin/api';

export const overlayApi = {
  get: () => invoke<OverlayState>('overlay_get'),
  setVisible: (visible: boolean) =>
    invoke<void>('overlay_set_visible', { visible }),
  setLock: (locked: boolean) => invoke<void>('overlay_set_lock', { locked }),
  setAnchor: (anchor: string) =>
    invoke<string>('overlay_set_anchor', { anchor }),
  // 반환값은 실제로 적용된 bounds - 요청 크기가 한계를 넘으면 잘린다
  // OBS 모드는 allowlist 밖이라 shim이 거절한다
  resize: (payload: {
    width: number;
    height: number;
    anchor?: string;
    contentTopOffset?: number;
    fixedPositionDeltaX?: number;
    fixedPositionDeltaY?: number;
  }) => invoke<OverlayBounds>('overlay_resize', { payload }),
  // 오버레이를 작업 영역 안쪽 중앙으로 되돌린다 - 화면 밖으로 나갔을 때의 탈출구
  resetPosition: () => invoke<OverlayBounds>('overlay_reset_position'),
  // 반환값은 페이드 적용 여부 (창 없음·미지원 플랫폼이면 false)
  transitionFade: (alpha: number, durationMs: number) =>
    invoke<boolean>('overlay_transition_fade', { alpha, durationMs }),
  onVisibility: (listener: (payload: OverlayVisibilityPayload) => void) =>
    subscribe<OverlayVisibilityPayload>('overlay:visibility', listener),
  onLock: (listener: (payload: OverlayLockPayload) => void) =>
    subscribe<OverlayLockPayload>('overlay:lock', listener),
  onAnchor: (listener: (payload: OverlayAnchorPayload) => void) =>
    subscribe<OverlayAnchorPayload>('overlay:anchor', listener),
  onResized: (listener: (payload: OverlayResizePayload) => void) =>
    subscribe<OverlayResizePayload>('overlay:resized', listener),
};
