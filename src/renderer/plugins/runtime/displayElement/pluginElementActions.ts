/**
 * 플러그인 요소 mutation 진입점 - 로컬 store(단일 authority)에 직접 적용
 */

import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';
import {
  flushPluginInstancesEditSession,
  rotatePluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import type { NativeElementType } from '@src/renderer/editor/model/elementIdMap';

// 네이티브 레이어 기하 한 축 패치 - 프로퍼티 패널의 위치·크기 입력이 쓰는 모양
export interface NativeLayerBoundsTarget {
  elementType: NativeElementType;
  id: string;
  patch:
    | { dx: number; dy?: never; width?: never; height?: never }
    | { dx?: never; dy: number; width?: never; height?: never }
    | { dx?: never; dy?: never; width: number; height?: never }
    | { dx?: never; dy?: never; width?: never; height: number };
  gestureId?: string;
}

const rotateTargetPluginSessions = (
  fullIds: string[],
  gestureId?: string,
): Set<string> => {
  const targetIds = new Set(fullIds);
  const pluginIds = new Set(
    usePluginDisplayElementStore
      .getState()
      .elements.filter((element) => targetIds.has(element.fullId))
      .map((element) => element.pluginId),
  );
  pluginIds.forEach((pluginId) => {
    if (gestureId) {
      rotatePluginInstancesEditSession(pluginId, gestureId);
    } else {
      rotatePluginInstancesEditSession(pluginId);
    }
  });
  return pluginIds;
};

type PositionPatch = Partial<PluginDisplayElementInternal['position']>;
type MeasuredSizePatch = Partial<
  NonNullable<PluginDisplayElementInternal['measuredSize']>
>;

export type PluginElementUpdatePatch = Omit<
  Partial<PluginDisplayElementInternal>,
  'position' | 'measuredSize' | 'settings'
> & {
  position?: PositionPatch;
  measuredSize?: MeasuredSizePatch;
  settings?: Record<string, unknown>;
};

export const mergePluginElementUpdatePatches = (
  base: PluginElementUpdatePatch,
  next: PluginElementUpdatePatch,
): PluginElementUpdatePatch => ({
  ...base,
  ...next,
  ...(base.position || next.position
    ? { position: { ...base.position, ...next.position } }
    : {}),
  ...(base.measuredSize || next.measuredSize
    ? { measuredSize: { ...base.measuredSize, ...next.measuredSize } }
    : {}),
  ...(base.settings || next.settings
    ? { settings: { ...base.settings, ...next.settings } }
    : {}),
});

export const materializePluginElementUpdate = (
  element: PluginDisplayElementInternal,
  patch: PluginElementUpdatePatch,
): Partial<PluginDisplayElementInternal> => {
  const { position, measuredSize, settings, ...rest } = patch;
  return {
    ...rest,
    ...(position ? { position: { ...element.position, ...position } } : {}),
    ...(measuredSize
      ? {
          measuredSize: {
            width:
              measuredSize.width ??
              element.measuredSize?.width ??
              element.estimatedSize?.width ??
              200,
            height:
              measuredSize.height ??
              element.measuredSize?.height ??
              element.estimatedSize?.height ??
              150,
          },
        }
      : {}),
    ...(settings ? { settings: { ...element.settings, ...settings } } : {}),
  };
};

/** 가시성 일괄 변경 */
export const setPluginElementsHidden = (
  targets: Array<{ fullId: string; hidden: boolean }>,
): Promise<boolean> => {
  if (targets.length === 0) return Promise.resolve(true);
  // 공유 gestureId - 플러그인별 커밋이 히스토리 한 엔트리로 병합
  const pluginIds = rotateTargetPluginSessions(
    targets.map(({ fullId }) => fullId),
    crypto.randomUUID(),
  );
  const store = usePluginDisplayElementStore.getState();
  targets.forEach(({ fullId, hidden }) => {
    store.updateElement(fullId, { hidden });
  });
  // 가시성 토글은 discrete 편집 - debounce 대기 없이 즉시 커밋
  pluginIds.forEach((pluginId) => flushPluginInstancesEditSession(pluginId));
  return Promise.resolve(true);
};

/** 요소 삭제 */
export const deletePluginElements = (
  fullIds: string[],
  gestureId?: string,
): void => {
  if (fullIds.length === 0) return;
  const store = usePluginDisplayElementStore.getState();
  const targetIds = new Set(fullIds);
  rotateTargetPluginSessions(fullIds, gestureId);
  const remaining = store.elements.filter(
    (element) => !targetIds.has(element.fullId),
  );
  store.setElements(remaining);
};

/** 단일 요소 patch (위치·크기·인스턴스 settings 등) */
export const updatePluginElement = (
  fullId: string,
  patch: PluginElementUpdatePatch,
): void => {
  const store = usePluginDisplayElementStore.getState();
  const element = store.elements.find(
    (candidate) => candidate.fullId === fullId,
  );
  if (!element) return;
  store.updateElement(fullId, materializePluginElementUpdate(element, patch));
};

export interface PluginElementGeometrySnapshot {
  position: { x: number; y: number };
  measuredSize?: { width: number; height: number };
}

/** 게스처 시작 시점의 위치·크기 스냅샷 */
export const capturePluginElementGeometry = (
  fullId: string,
): PluginElementGeometrySnapshot | null => {
  const element = usePluginDisplayElementStore
    .getState()
    .elements.find((candidate) => candidate.fullId === fullId);
  if (!element) return null;
  return {
    position: { ...element.position },
    measuredSize: element.measuredSize
      ? { ...element.measuredSize }
      : undefined,
  };
};

const sameSize = (
  a: { width: number; height: number } | undefined,
  b: { width: number; height: number } | undefined,
): boolean =>
  a === b || (!!a && !!b && a.width === b.width && a.height === b.height);

// measuredSize가 없던 요소는 undefined로 되돌린다 - updatePluginElement의
// materialize 폴백이 만든 크기를 남기면 canonical과 달라져 취소가 저장으로 변한다
// (되돌린 뒤 PluginElement가 재측정해 실측 크기를 저장할 수는 있다 - 마운트 측정과
// 같은 값이라 사용자 편집이 아닌 실측 반영이다).
// 값이 같으면 건드리지 않는다 - 새 객체 정체만 바뀌어도 요소 측정 effect가 다시 돈다
export const restorePluginElementGeometry = (
  fullId: string,
  snapshot: PluginElementGeometrySnapshot,
): void => {
  const store = usePluginDisplayElementStore.getState();
  const element = store.elements.find(
    (candidate) => candidate.fullId === fullId,
  );
  if (!element) return;
  const samePosition =
    element.position.x === snapshot.position.x &&
    element.position.y === snapshot.position.y;
  if (samePosition && sameSize(element.measuredSize, snapshot.measuredSize)) {
    return;
  }
  store.updateElement(fullId, {
    position: { ...snapshot.position },
    measuredSize: snapshot.measuredSize
      ? { ...snapshot.measuredSize }
      : undefined,
  });
};

/** z-order 일괄 지정 */
export const setPluginElementZIndexes = (
  entries: Array<{ fullId: string; zIndex: number }>,
): void => {
  if (entries.length === 0) return;
  // 공유 gestureId - 플러그인별 커밋이 히스토리 한 엔트리로 병합
  rotateTargetPluginSessions(
    entries.map(({ fullId }) => fullId),
    crypto.randomUUID(),
  );
  const store = usePluginDisplayElementStore.getState();
  entries.forEach(({ fullId, zIndex }) => {
    store.updateElement(fullId, { zIndex });
  });
};
