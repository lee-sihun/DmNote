import { invokeEditorWrite } from './invokeEditorWrite';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '../shared';
import { rawKeyEventBus } from '@utils/input/rawKeyEventBus';
import { enqueueEditorCompatibilityWrite } from '@src/renderer/editor/runtime/lifecycle/editorCompatibilityQueue';
import { editorCoordinator } from '@src/renderer/editor/runtime/coordinator/editorStateCoordinator';
import { runExclusiveLegacyMutation } from '@src/renderer/editor/runtime/lifecycle/legacyEditorMutation';
import { setKeyMode } from './keyModeApi';

import type {
  KeyCounterUpdate,
  KeysModeResponse,
  KeysResetAllResponse,
  ReadyUnsubscribe,
  Unsubscribe,
  ModeChangePayload,
  CustomTabsChangePayload,
  KeyStatePayload,
  KeysResetPayload,
  CustomTabResult,
  CustomTabDeleteResult,
  TabMetadataResult,
  TabOrderOp,
  RawInputPayload,
} from '@src/types/plugin/api';
import type {
  CustomTab,
  KeyMappings,
  KeyPositions,
  KeyCounters,
} from '@src/types/key/keys';

// 백엔드 gestureId UUID 강제와 동형 (canonical hyphenated + 32-hex simple)
const GESTURE_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

// 플러그인 표면(dmn.keys.*)이 임의 문자열을 넘길 수 있음 - 비 UUID가 드레인에
// 섞이면 같은 커밋의 사용자 편집까지 INVALID_GESTURE_ID로 통째 실패하므로
// 유입 지점에서 걸러내고 커밋은 진행
const sanitizeGestureId = (gestureId?: string): string | undefined => {
  if (!gestureId || GESTURE_ID_PATTERN.test(gestureId)) return gestureId;
  console.warn('[keysApi] Dropped non-UUID gestureId:', gestureId);
  return undefined;
};

const gestureMeta = (gestureId?: string): { gestureId: string } | undefined => {
  const safeId = sanitizeGestureId(gestureId);
  return safeId ? { gestureId: safeId } : undefined;
};

export const updateMappingsAndPositionsWithGesture = (
  mappings: KeyMappings,
  positions: KeyPositions,
  gestureId?: string,
) =>
  enqueueEditorCompatibilityWrite(
    () =>
      editorCoordinator.commitPatch(
        {
          schemaVersion: 1,
          keys: mappings,
          keyPositions: positions,
        },
        gestureMeta(gestureId),
      ),
    () => ({
      keys: structuredClone(mappings),
      positions: structuredClone(positions),
    }),
  );

export const updatePositionsWithGesture = (
  positions: KeyPositions,
  gestureId?: string,
) =>
  enqueueEditorCompatibilityWrite(
    () =>
      editorCoordinator.commitPatch(
        {
          schemaVersion: 1,
          keyPositions: positions,
        },
        gestureMeta(gestureId),
      ),
    () => structuredClone(positions),
  );

export const keysApi = {
  get: () => invoke<KeyMappings>('keys_get'),
  getCounters: () => invoke<KeyCounters>('keys_get_counters'),
  // 자사 UI 전용 경로. 플러그인 발신 keys 쓰기는 플러그인 프록시가
  // pluginWriteGateway로 별도 라우팅한다 (계약 §10)
  update: (mappings: KeyMappings) =>
    enqueueEditorCompatibilityWrite(
      () => editorCoordinator.commitPatch({ schemaVersion: 1, keys: mappings }),
      () => structuredClone(mappings),
    ),
  updateWithPositions: (mappings: KeyMappings, positions: KeyPositions) =>
    updateMappingsAndPositionsWithGesture(mappings, positions),
  getPositions: () => invoke<KeyPositions>('positions_get'),
  updatePositions: (positions: KeyPositions) =>
    updatePositionsWithGesture(positions),
  setMode: setKeyMode,
  resetAll: () =>
    runExclusiveLegacyMutation(() =>
      invoke<KeysResetAllResponse>('keys_reset_all'),
    ),
  resetMode: (mode: string) =>
    runExclusiveLegacyMutation(() =>
      invoke<KeysModeResponse>('keys_reset_mode', { mode }),
    ),
  setCounters: (counters: KeyCounters) =>
    invokeEditorWrite<KeyCounters>('keys_set_counters', { counters }),
  resetCounters: () => invokeEditorWrite<KeyCounters>('keys_reset_counters'),
  resetCountersMode: (mode: string) =>
    invokeEditorWrite<KeyCounters>('keys_reset_counters_mode', { mode }),
  resetSingleCounter: (mode: string, key: string) =>
    invokeEditorWrite<KeyCounters>('keys_reset_single_counter', { mode, key }),
  onChanged: (listener: (keys: KeyMappings) => void) =>
    subscribe<KeyMappings>('keys:changed', listener),
  onPositionsChanged: (listener: (positions: KeyPositions) => void) =>
    subscribe<KeyPositions>('positions:changed', listener),
  onModeChanged: (listener: (payload: ModeChangePayload) => void) =>
    subscribe<ModeChangePayload>('keys:mode-changed', listener),
  onKeyState: (
    listener: (payload: KeyStatePayload) => void,
  ): ReadyUnsubscribe => subscribe<KeyStatePayload>('keys:state', listener),
  // 키보드 훅 (재)시작 등으로 눌림 상태가 통째로 무효화될 때 발화
  onKeysReset: (
    listener: (payload: KeysResetPayload) => void,
  ): ReadyUnsubscribe => subscribe<KeysResetPayload>('keys:reset', listener),
  onRawInput: (listener: (payload: RawInputPayload) => void): Unsubscribe => {
    let unsubscribeFn: (() => void) | null = null;
    let cancelled = false;

    rawKeyEventBus
      .subscribe(listener)
      .then((unsub) => {
        if (cancelled) {
          unsub();
          return;
        }
        unsubscribeFn = unsub;
      })
      .catch((error) => {
        console.error('[API] Failed to subscribe to raw input:', error);
      });

    return () => {
      if (cancelled) return;
      cancelled = true;
      unsubscribeFn?.();
      unsubscribeFn = null;
    };
  },
  onCounterChanged: (listener: (payload: KeyCounterUpdate) => void) =>
    subscribe<KeyCounterUpdate>('keys:counter', listener),
  onCountersChanged: (listener: (payload: KeyCounters) => void) =>
    subscribe<KeyCounters>('keys:counters', listener),
  customTabs: {
    list: () => invoke<CustomTab[]>('custom_tabs_list'),
    create: (name: string) =>
      runExclusiveLegacyMutation(() =>
        invoke<CustomTabResult>('custom_tabs_create', { name }),
      ),
    delete: (id: string) =>
      runExclusiveLegacyMutation(() =>
        invoke<CustomTabDeleteResult>('custom_tabs_delete', { id }),
      ),
    // 내장 탭 id를 넘기면 백엔드가 unknown-tab으로 거절한다
    rename: (id: string, name: string) =>
      runExclusiveLegacyMutation(() =>
        invoke<TabMetadataResult>('custom_tabs_rename', { id, name }),
      ),
    select: (id: string) =>
      invokeEditorWrite<CustomTabDeleteResult>('custom_tabs_select', { id }),
    restore: (customTabs: CustomTab[], selectedKeyType: string) =>
      invokeEditorWrite<void>('custom_tabs_restore', {
        customTabs,
        selectedKeyType,
      }),
    onChanged: (listener: (payload: CustomTabsChangePayload) => void) =>
      subscribe<CustomTabsChangePayload>('customTabs:changed', listener),
  },
  // 순서는 내장 탭까지 포함하므로 customTabs 밖에 둔다
  tabs: {
    /**
     * 두 탭의 자리를 맞바꾼다
     *
     * 결과 배열이 아니라 연산을 보낸다. 백엔드가 최신 순서 위에 얹으므로
     * 기다리는 사이 무관한 탭이 생기거나 사라져도 거절되지 않는다.
     * 인자 순서는 의미를 갖지 않는다
     */
    swap: (a: string, b: string) =>
      runExclusiveLegacyMutation(() =>
        invoke<TabMetadataResult>('tabs_reorder', {
          op: { kind: 'swap', a, b } satisfies TabOrderOp,
        }),
      ),
  },
};
