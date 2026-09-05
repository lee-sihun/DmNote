/**
 * 플러그인 기하 게스처 × 실물 세션 큐 통합 계약
 * - preview 동안은 staged라 저장 예약이 억제되고, 종료 시 release가 정확히 한 번,
 *   세션과 같은 gestureId로 나간다 (defineElement의 release 리스너가 그 한 번을 저장)
 * - 종료 뒤 편집 문맥·barrier가 남지 않는다
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridSelectionStore } from '@stores/grid/useGridSelectionStore';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  hasActivePluginInstancesEditContext,
  isPluginInstancesGestureStaged,
  registerPluginInstancesEditSessionFlush,
  registerPluginInstancesStagedRelease,
  touchPluginInstancesEditSession,
} from '@plugins/runtime/displayElement/instancesCommitQueue';
import { drainEditorWrites } from '@src/renderer/editor/runtime/lifecycle/editorWriteBarrier';
import type { PluginDisplayElementInternal } from '@src/types/plugin/api';

import { createPluginGeometryGestureController } from './usePluginGeometryGesture';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@utils/plugin/bridgeMessages', () => ({
  sendBridgeMessageBestEffort: vi.fn(),
}));

const PLUGIN_ID = 'plugin-int';
const FULL_ID = 'plugin-int:element';

const pluginElement = (): PluginDisplayElementInternal => ({
  id: 'element',
  fullId: FULL_ID,
  pluginId: PLUGIN_ID,
  definitionId: PLUGIN_ID,
  html: '<div />',
  position: { x: 30, y: 40 },
  estimatedSize: { width: 200, height: 150 },
  tabId: '4key',
});

const target = { fullId: FULL_ID, pluginId: PLUGIN_ID };

describe('usePluginGeometryGesture 세션 큐 통합', () => {
  // defineElement의 스토어 구독을 흉내 - staged면 저장 예약을 건너뛴다
  let scheduledSaves: string[];
  let releases: string[];
  let flushes: number;
  const cleanups: Array<() => void> = [];

  beforeEach(() => {
    scheduledSaves = [];
    releases = [];
    flushes = 0;
    usePluginDisplayElementStore.setState({ elements: [pluginElement()] });
    useGridSelectionStore
      .getState()
      .setSelectedElements([{ type: 'plugin', id: FULL_ID }]);
    cleanups.push(
      usePluginDisplayElementStore.subscribe(() => {
        const gestureId = touchPluginInstancesEditSession(PLUGIN_ID);
        if (isPluginInstancesGestureStaged(PLUGIN_ID)) return;
        scheduledSaves.push(gestureId);
      }),
      registerPluginInstancesStagedRelease(PLUGIN_ID, (gestureId) => {
        releases.push(gestureId);
      }),
      registerPluginInstancesEditSessionFlush(PLUGIN_ID, () => {
        flushes += 1;
      }),
    );
  });

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it('preview 중에는 저장 예약이 없고 commit에 release가 한 번 같은 gestureId로 나간다', async () => {
    const gesture = createPluginGeometryGestureController();

    gesture.preview(target, 'x', 35);
    gesture.preview(target, 'x', 41);
    gesture.preview(target, 'width', 120);

    expect(isPluginInstancesGestureStaged(PLUGIN_ID)).toBe(true);
    expect(scheduledSaves).toEqual([]);
    expect(releases).toEqual([]);

    gesture.commit(target, 'width', 130);

    expect(releases).toHaveLength(1);
    expect(scheduledSaves).toEqual([]);
    expect(isPluginInstancesGestureStaged(PLUGIN_ID)).toBe(false);
    expect(hasActivePluginInstancesEditContext(PLUGIN_ID)).toBe(false);
    // 세션이 닫힌 뒤 touch는 같은 id를 계승한다 - release 저장이 세션 gestureId로 간다
    expect(touchPluginInstancesEditSession(PLUGIN_ID, releases[0])).toBe(
      releases[0],
    );
    // begin이 선행 예약분을, end가 잔여분을 flush한다 (staged라 실제 예약분은 없음)
    expect(flushes).toBe(2);
    await expect(drainEditorWrites()).resolves.toBe(true);
  });

  it('cancel도 release 한 번으로 barrier를 정산하고 스냅샷을 복원한다', async () => {
    const gesture = createPluginGeometryGestureController();

    gesture.preview(target, 'y', 77);
    gesture.cancel();

    expect(releases).toHaveLength(1);
    expect(scheduledSaves).toEqual([]);
    expect(hasActivePluginInstancesEditContext(PLUGIN_ID)).toBe(false);
    const element = usePluginDisplayElementStore
      .getState()
      .elements.find((candidate) => candidate.fullId === FULL_ID);
    expect(element?.position).toEqual({ x: 30, y: 40 });
    expect(element?.measuredSize).toBeUndefined();
    await expect(drainEditorWrites()).resolves.toBe(true);
  });
});
