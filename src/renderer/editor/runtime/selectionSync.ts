/**
 * 창 간 선택 동기화
 * 로컬 선택 변경을 백엔드 세션에 publish하고, 원격 스냅샷을 revision 게이트로 반영
 * 반영 중 재-publish를 막아 에코 루프 차단
 */
import {
  isSyntheticElementId,
  resolveElementById,
  type NativeElementType,
} from '../model/elementIdMap';

import {
  selectionSessionApi,
  toWireElements,
  fromWireElements,
  type SelectionSessionSnapshot,
} from '@api/modules/selectionSessionApi';
import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { useKeyStore } from '@stores/data/useKeyStore';
import { stableStringify } from '@utils/core/stableStringify';

let appliedRevision = 0;
let applyingRemote = false;
let lastPublishedFingerprint = '';
let publishQueued = false;
let publishInFlight = false;
let publishScheduled = false;
const publishStateListeners = new Set<() => void>();
// 초기 스냅샷 적용 완료 신호 (분리 창의 첫 페인트 게이트용)
let initialSyncDone = false;
const initialSyncListeners = new Set<() => void>();

const markInitialSyncDone = () => {
  if (initialSyncDone) return;
  initialSyncDone = true;
  initialSyncListeners.forEach((listener) => listener());
  initialSyncListeners.clear();
};

export const onSelectionSyncReady = (listener: () => void): (() => void) => {
  if (initialSyncDone) {
    listener();
    return () => {};
  }
  initialSyncListeners.add(listener);
  return () => initialSyncListeners.delete(listener);
};

const currentFingerprint = (): string => {
  const selection = useGridSelectionStore.getState();
  const mode = useKeyStore.getState().selectedKeyType;
  return stableStringify({
    selectedElements: selection.selectedElements,
    selectedGroupIds: selection.selectedGroupIds,
    mode,
  });
};

const notifyPublishStateChanged = () => {
  publishStateListeners.forEach((listener) => listener());
  publishStateListeners.clear();
};

const waitForPublishIdle = async (): Promise<void> => {
  while (publishScheduled || publishInFlight || publishQueued) {
    await new Promise<void>((resolve) => {
      publishStateListeners.add(resolve);
    });
  }
};

const publishCurrent = async (): Promise<void> => {
  if (publishInFlight) {
    publishQueued = true;
    return;
  }
  publishInFlight = true;
  const requestFingerprint = currentFingerprint();
  try {
    const selection = useGridSelectionStore.getState();
    const mode = useKeyStore.getState().selectedKeyType;
    if (requestFingerprint === lastPublishedFingerprint) {
      return;
    }

    const result = await selectionSessionApi.publish({
      selectedElements: toWireElements(selection.selectedElements),
      selectedGroupIds: selection.selectedGroupIds,
      mode,
    });
    // 백엔드가 우리 publish에 부여한 revision까지는 항상 소화된 것으로 간주
    // (그 이하의 에코·스냅샷이 로컬을 되돌리지 못하게 게이트를 전진)
    if (result.selectionRevision > appliedRevision) {
      appliedRevision = result.selectionRevision;
    }
    // 발행 완료 기록은 로컬 상태가 요청 시점 그대로일 때만
    if (currentFingerprint() === requestFingerprint) {
      lastPublishedFingerprint = requestFingerprint;
    }
  } catch (error) {
    console.error('Failed to publish selection session', error);
  } finally {
    publishInFlight = false;
    if (publishQueued) {
      publishQueued = false;
      void publishCurrent();
    }
    notifyPublishStateChanged();
  }
};

// 창 전환 전 최신 선택이 백엔드 세션에 반영될 때까지 대기
export const flushSelectionSync = async (): Promise<boolean> => {
  // 같은 tick에 예약된 선택 publish가 시작되도록 양보
  await Promise.resolve();
  await waitForPublishIdle();

  if (currentFingerprint() !== lastPublishedFingerprint) {
    await publishCurrent();
    await waitForPublishIdle();
  }

  return currentFingerprint() === lastPublishedFingerprint;
};

const applyRemote = (snapshot: SelectionSessionSnapshot): void => {
  // 로컬 발행이 정산되기 전에는 로컬 낙관 상태가 authority
  // (자기 중간 스냅샷의 에코가 최신 로컬 선택을 덮는 것 방지)
  if (publishScheduled || publishInFlight || publishQueued) return;
  if (snapshot.selectionRevision <= appliedRevision) return;
  appliedRevision = snapshot.selectionRevision;

  // wire index는 발신 창 스냅샷 기준 - 이 창의 배열과 어긋날 수 있다.
  // 안정 id는 현재 문서에서 재해석하고 삭제된 id는 버린다. 합성 id
  // (구형 무ID 요소의 `${type}-${index}`)만 기존 표현을 유지한다
  const NATIVE_SELECTION_TYPES: ReadonlySet<string> = new Set([
    'key',
    'stat',
    'graph',
    'knob',
  ]);

  const currentMode = useKeyStore.getState().selectedKeyType;
  const remoteElements = fromWireElements(snapshot.selectedElements).flatMap(
    (element) => {
      if (!NATIVE_SELECTION_TYPES.has(element.type)) return [element];
      const locator = resolveElementById(
        element.type as NativeElementType,
        element.id,
      );
      if (locator) {
        if (locator.mode !== currentMode) return [];
        return [{ ...element, index: locator.index }];
      }
      return isSyntheticElementId(element.id) ? [element] : [];
    },
  );
  const fingerprint = stableStringify({
    selectedElements: remoteElements,
    selectedGroupIds: snapshot.selectedGroupIds,
    mode: snapshot.mode,
  });
  // 자기 publish 에코 또는 이미 동일 상태면 무시
  if (fingerprint === currentFingerprint()) {
    lastPublishedFingerprint = fingerprint;
    return;
  }

  applyingRemote = true;
  try {
    const keyState = useKeyStore.getState();
    if (snapshot.mode && snapshot.mode !== keyState.selectedKeyType) {
      // 모드는 백엔드 authority(keys_set_mode) 경유 값이 이벤트로 이미 흐르므로
      // 여기서는 선택만 반영하고 모드 불일치 스냅샷은 선택 해제로 처리
      useGridSelectionStore.getState().clearSelection();
      lastPublishedFingerprint = '';
      return;
    }
    useGridSelectionStore.setState({
      selectedElements: remoteElements,
      selectedGroupIds: snapshot.selectedGroupIds,
    });
    lastPublishedFingerprint = fingerprint;
  } finally {
    applyingRemote = false;
  }
};

/** bootstrap이 authoritative 상태(selectedKeyType) 적용 후 호출 */
export const initSelectionSync = (): (() => void) => {
  let disposed = false;

  // subscribe-then-read: listener 준비 후 최신 스냅샷 조회 (유실 창 제거)
  // 조회와 이벤트의 순서 역전은 applyRemote의 revision 게이트가 처리
  const unsubscribeChanged = selectionSessionApi.onChanged(applyRemote);
  void (async () => {
    try {
      await unsubscribeChanged.ready;
    } catch (error) {
      console.error('Failed to subscribe selection session', error);
      markInitialSyncDone();
      return;
    }
    if (disposed) return;
    try {
      applyRemote(await selectionSessionApi.get());
    } catch (error) {
      console.error('Failed to load selection session', error);
    } finally {
      markInitialSyncDone();
    }
  })();

  // 로컬 선택 변경 publish (원격 반영 중 제외)
  let lastSelectionRef = useGridSelectionStore.getState().selectedElements;
  let lastGroupsRef = useGridSelectionStore.getState().selectedGroupIds;
  const unsubscribeStore = useGridSelectionStore.subscribe((state) => {
    if (applyingRemote) {
      lastSelectionRef = state.selectedElements;
      lastGroupsRef = state.selectedGroupIds;
      return;
    }
    if (
      state.selectedElements === lastSelectionRef &&
      state.selectedGroupIds === lastGroupsRef
    ) {
      return;
    }
    lastSelectionRef = state.selectedElements;
    lastGroupsRef = state.selectedGroupIds;
    // 같은 tick의 연속 setState(clear→select)를 최종 상태 1회로 coalesce
    // - 중간 빈 선택이 백엔드로 왕복하지 않게 함
    if (publishScheduled) return;
    publishScheduled = true;
    queueMicrotask(() => {
      publishScheduled = false;
      notifyPublishStateChanged();
      void publishCurrent();
    });
  });

  return () => {
    disposed = true;
    unsubscribeChanged();
    unsubscribeStore();
  };
};

/** authoritative 모드 변경 시 창 로컬 선택 무효화 + 동기 상태 리셋 */
export const resetSelectionForModeChange = (): void => {
  lastPublishedFingerprint = '';
  const selection = useGridSelectionStore.getState();
  if (
    selection.selectedElements.length > 0 ||
    selection.selectedGroupIds.length > 0
  ) {
    // clearSelection이 store 변경을 만들면 구독이 빈 선택을 publish
    selection.clearSelection();
  }
};
