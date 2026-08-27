import { useEffect, useState } from 'react';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import {
  beginPluginInstancesEditSession,
  endPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import {
  beginMixedGestureTransaction,
  cancelUncommittedMixedGestureTransaction,
} from '@plugins/runtime/displayElement/gestureTransaction';
import {
  capturePluginElementGeometry,
  restorePluginElementGeometry,
  updatePluginElement,
  type PluginElementGeometrySnapshot,
  type PluginElementUpdatePatch,
} from '@plugins/runtime/displayElement/pluginElementActions';

export type PluginGeometryField = 'x' | 'y' | 'width' | 'height';

export interface PluginGeometryTarget {
  fullId: string;
  pluginId: string;
}

interface PluginGeometrySession {
  fullId: string;
  pluginId: string;
  gestureId: string;
  token: string;
  snapshot: PluginElementGeometrySnapshot;
}

const geometryPatch = (
  field: PluginGeometryField,
  value: number,
): PluginElementUpdatePatch => {
  switch (field) {
    case 'x':
      return { position: { x: value } };
    case 'y':
      return { position: { y: value } };
    case 'width':
      return { measuredSize: { width: value } };
    case 'height':
      return { measuredSize: { height: value } };
  }
};

const isSelectedPluginElement = (fullId: string): boolean =>
  useGridSelectionStore
    .getState()
    .selectedElements.some(
      (element) => element.type === 'plugin' && element.id === fullId,
    );

// 속성 패널 숫자 입력(X/Y/W/H)의 플러그인 요소 게스처. 값의 원본이 프론트
// 스토어라 preview_broker를 타지 않고, 캔버스 드래그(Grid)와 같은 세션을
// 쓴다 - staged 동안은 스토어만 바뀌고 저장은 세션 경계에서 한 번,
// 히스토리는 gestureId로 한 항목
export const createPluginGeometryGestureController = () => {
  let session: PluginGeometrySession | null = null;

  const endSession = () => {
    if (!session) return;
    const { pluginId, token, gestureId } = session;
    session = null;
    endPluginInstancesEditSession(pluginId, token);
    // 종료 경로가 혼합 커밋을 타지 않으므로 staged를 여기서 정산해야
    // release 저장이 나가고 barrier가 영구 대기하지 않는다
    cancelUncommittedMixedGestureTransaction(gestureId);
  };

  const cancel = () => {
    if (!session) return;
    const { fullId, snapshot } = session;
    // 복원이 세션 종료보다 먼저여야 release 저장이 원본과 같은 상태를
    // 실어 백엔드 no-op 판정(changed: false)으로 끝난다
    restorePluginElementGeometry(fullId, snapshot);
    endSession();
  };

  const ensureSession = (target: PluginGeometryTarget): boolean => {
    if (session?.fullId === target.fullId) return true;
    if (session) cancel();
    // 선택이 바뀐 뒤 도착한 지각 preview(언마운트 직전 after-paint 발행)는
    // 새 세션을 열지 않는다
    if (!isSelectedPluginElement(target.fullId)) return false;
    const snapshot = capturePluginElementGeometry(target.fullId);
    if (!snapshot) return false;
    const gestureId = crypto.randomUUID();
    const token = beginPluginInstancesEditSession(target.pluginId, gestureId);
    beginMixedGestureTransaction(gestureId, [target.pluginId]);
    session = {
      fullId: target.fullId,
      pluginId: target.pluginId,
      gestureId,
      token,
      snapshot,
    };
    return true;
  };

  const preview = (
    target: PluginGeometryTarget,
    field: PluginGeometryField,
    value: number,
  ) => {
    if (!ensureSession(target)) return;
    updatePluginElement(target.fullId, geometryPatch(field, value));
  };

  // preview 없이 온 확정(짧은 타이핑 후 blur)도 같은 세션 경계로 저장한다
  const commit = (
    target: PluginGeometryTarget,
    field: PluginGeometryField,
    value: number,
  ) => {
    if (!ensureSession(target)) return;
    updatePluginElement(target.fullId, geometryPatch(field, value));
    endSession();
  };

  return { preview, commit, cancel };
};

export const usePluginGeometryGesture = (
  target: PluginGeometryTarget | null,
) => {
  const [controller] = useState(createPluginGeometryGestureController);
  const fullId = target?.fullId ?? null;

  // 대상 전환·언마운트는 취소 경계 - 옛 대상의 미확정 값을 남기지 않는다
  useEffect(() => () => controller.cancel(), [controller, fullId]);

  return {
    preview: (field: PluginGeometryField, value: number) => {
      if (target) controller.preview(target, field, value);
    },
    commit: (field: PluginGeometryField, value: number) => {
      if (target) controller.commit(target, field, value);
    },
    cancel: controller.cancel,
  };
};
