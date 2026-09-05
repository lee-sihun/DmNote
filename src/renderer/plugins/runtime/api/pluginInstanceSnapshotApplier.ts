import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';
import {
  addDisplayElementInternal,
  removeDisplayElementsInternal,
  type InternalDisplayElementConfig,
} from '../displayElement/displayElementApi';
import { normalizePluginInstanceTabId } from '../displayElement/instanceLifecycle';
import { omitLayoutSettingValues } from '../settingsSections';
import type {
  PluginDefinition,
  PluginDisplayElementActionContext,
  PluginDisplayElementInternal,
  PluginMenuItem,
} from '@src/types/plugin/api';

export interface SavedInstance {
  // 영구 인스턴스 ID - backfill 전 구데이터는 없을 수 있음
  instanceId?: string;
  position: { x: number; y: number };
  settings?: Record<string, string | number | boolean>;
  measuredSize?: { width: number; height: number };
  tabId?: string;
  hidden?: boolean;
  zIndex?: number;
  // 레이어 그룹 소속 - normalize된 tabId 모드의 그룹만 유효
  groupId?: string;
}

interface PluginInstanceSnapshotBarrier {
  isRestoring: () => boolean;
  runRestoreMutation: <Result>(mutation: () => Result) => Result;
}

interface CreatePluginInstanceSnapshotApplierOptions {
  pluginId: string;
  definitionId: string;
  definition: PluginDefinition;
  defaultSettings: Record<string, string | number | boolean>;
  instanceSaveBarrier: PluginInstanceSnapshotBarrier;
  useModalSettings: boolean;
  handleElementClick: (event: Event) => unknown;
  buildCustomContextMenuItems: () => PluginMenuItem<PluginDisplayElementActionContext>[];
}

export const createPluginInstanceSnapshotApplier = ({
  pluginId,
  definitionId: defId,
  definition,
  defaultSettings,
  instanceSaveBarrier,
  useModalSettings,
  handleElementClick,
  buildCustomContextMenuItems,
}: CreatePluginInstanceSnapshotApplierOptions) => {
  // 저장 스냅샷을 화면 요소에 diff 적용 - 초기 복원과 undo 재결합이 공유.
  // 생존 fullId는 canonical 소유 필드만 갱신하므로 핸들·모달·선택이 유지됨
  return (savedInstances: SavedInstance[], readiness: 'ready' | 'failed') => {
    instanceSaveBarrier.runRestoreMutation(() => {
      if (readiness === 'failed') {
        console.warn(
          `[Plugin ${pluginId}] Bootstrap timed out; restoring all instances`,
        );
      }

      const maxInstances = definition.maxInstances;
      let instancesToRestore = savedInstances;

      if (maxInstances && maxInstances > 0) {
        // 캡은 탭별 수용 카운터로 원배열 순서를 보존하며 적용.
        // 탭별 재그룹은 canonical 순서를 깨 undo 직후 echo 저장이
        // 실변경 커밋이 되고 redo 스택을 소거한다
        const acceptedByTab = new Map<string, number>();
        instancesToRestore = savedInstances.filter((instance) => {
          const tabId = normalizePluginInstanceTabId(instance.tabId);
          const accepted = acceptedByTab.get(tabId) ?? 0;
          if (accepted >= maxInstances) return false;
          acceptedByTab.set(tabId, accepted + 1);
          return true;
        });
      }

      // backfill 전 무ID 항목은 diff 신원이 없음 - 그 스냅샷만 전량 재주입 폴백
      const canDiff = instancesToRestore.every(
        (instance) =>
          typeof instance.instanceId === 'string' &&
          instance.instanceId.length > 0,
      );

      // 기대 fullId 집합 - 폴백은 빈 집합이라 소멸 단계가 전량 제거
      const expectedFullIds = new Set(
        canDiff
          ? instancesToRestore.map(
              (instance) => `${pluginId}::${instance.instanceId}`,
            )
          : [],
      );

      // 소멸: 이 definition 요소 중 기대 밖 fullId 제거.
      // 초기 복원 창(barrier 복원 완료 전)에서는 스킵 - define 직후 추가된
      // 요소(barrier가 flush 대기 중인 편집)를 지우면 flush 커밋에서 조용히
      // 소실된다. 복원 완료 후 reapply와 실패 복원은 canonical이 진실이라
      // 소멸 유지
      const preserveRestoreWindowAdds =
        readiness === 'ready' && instanceSaveBarrier.isRestoring();
      if (!preserveRestoreWindowAdds) {
        const staleFullIds = usePluginDisplayElementStore
          .getState()
          .elements.filter(
            (element) =>
              element.definitionId === defId &&
              !expectedFullIds.has(element.fullId),
          )
          .map((element) => element.fullId);
        if (staleFullIds.length > 0) {
          removeDisplayElementsInternal(staleFullIds);
        }
      }

      const survivingFullIds = new Set(
        usePluginDisplayElementStore
          .getState()
          .elements.filter((element) => element.definitionId === defId)
          .map((element) => element.fullId),
      );

      instancesToRestore.forEach((instance) => {
        const fullId = canDiff ? `${pluginId}::${instance.instanceId}` : null;
        // canonical 소유 7필드 (PERSISTED_FIELDS와 동일 범위)
        const persistedFields = {
          position: instance.position,
          settings: omitLayoutSettingValues(
            definition.settings,
            instance.settings || { ...defaultSettings },
          ) as Record<string, string | number | boolean>,
          measuredSize: instance.measuredSize,
          tabId: normalizePluginInstanceTabId(instance.tabId),
          hidden: instance.hidden ?? false,
          zIndex: instance.zIndex,
          groupId: instance.groupId,
        };

        if (fullId && survivingFullIds.has(fullId)) {
          // 생존: 소유 필드만 갱신 - html·state·핸들러는 렌더러 소유라 불변
          usePluginDisplayElementStore
            .getState()
            .updateElement(fullId, persistedFields);
          return;
        }

        // 비동기 복원 중 플러그인 컨텍스트 재설정
        window.__dmn_current_plugin_id = pluginId;

        // 신규: 저장된 영구 ID로 재주입 (무ID는 새 UUID 발급)
        addDisplayElementInternal({
          html: '<!-- plugin-element -->',
          instanceId: instance.instanceId,
          draggable: true,
          definitionId: defId,
          state: definition.previewState || {},
          onClick: useModalSettings ? handleElementClick : undefined,
          contextMenu: {
            enableDelete: true,
            deleteLabel: definition.contextMenu?.delete || '삭제',
            customItems: buildCustomContextMenuItems(),
          },
          ...persistedFields,
        } as unknown as InternalDisplayElementConfig);
      });

      // buildSavedPluginInstances가 순서 민감 - def 블록을 스냅샷 순서로 재배열
      if (canDiff) {
        const state = usePluginDisplayElementStore.getState();
        const byFullId = new Map(
          state.elements
            .filter((element) => element.definitionId === defId)
            .map((element) => [element.fullId, element]),
        );
        const ordered = instancesToRestore
          .map((instance) =>
            byFullId.get(`${pluginId}::${instance.instanceId}`),
          )
          .filter(
            (element): element is PluginDisplayElementInternal =>
              element !== undefined,
          );
        let cursor = 0;
        let orderChanged = false;
        const reordered = state.elements.map((element) => {
          if (element.definitionId !== defId) return element;
          // 복원 창에서 소멸을 스킵한 기대 밖 요소는 제자리 유지
          if (!expectedFullIds.has(element.fullId)) return element;
          const replacement = ordered[cursor] ?? element;
          cursor += 1;
          if (replacement !== element) orderChanged = true;
          return replacement;
        });
        if (orderChanged) {
          state.setElements(reordered);
        }
      }
    });
  };
};
