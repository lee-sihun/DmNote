import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

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
  resize: (payload: {
    width: number;
    height: number;
    anchor?: string;
    // 적용 확인(응답·overlay:resized)과의 상관용 요청 gen
    requestGen?: number;
    // 콘텐츠 bounds 최소점 절대값 - 백엔드가 fixed-position 위치를 멱등 계산
    contentMin?: { x: number; y: number };
    contentTopOffset?: number;
    // 4변 마진 계약 (v2). 부재 시 백엔드는 contentTopOffset 경로로 동작
    contentMargins?: {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
    fixedPositionDeltaX?: number;
    fixedPositionDeltaY?: number;
  }) => invoke<OverlayBounds>('overlay_resize', { payload }),
  onVisibility: (listener: (payload: OverlayVisibilityPayload) => void) =>
    subscribe<OverlayVisibilityPayload>('overlay:visibility', listener),
  onLock: (listener: (payload: OverlayLockPayload) => void) =>
    subscribe<OverlayLockPayload>('overlay:lock', listener),
  onAnchor: (listener: (payload: OverlayAnchorPayload) => void) =>
    subscribe<OverlayAnchorPayload>('overlay:anchor', listener),
  onResized: (listener: (payload: OverlayResizePayload) => void) =>
    subscribe<OverlayResizePayload>('overlay:resized', listener),
};
