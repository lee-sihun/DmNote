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
    contentTopOffset?: number;
    fixedPositionDeltaX?: number;
    fixedPositionDeltaY?: number;
  }) => invoke<OverlayBounds>('overlay_resize', { payload }),
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
