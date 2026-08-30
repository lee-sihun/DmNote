/**
 * 탭 이름 변경·삭제 창구
 *
 * 팝업 행과 바 칩이 같은 모달을 쓴다. 모달을 팝업 안에 두면 팝업이 닫히는 순간
 * 같이 언마운트되므로 툴바 쪽에서 소유한다. 바 칩은 팝업이 닫힌 채로도 눌린다
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from '@contexts/useTranslation';
import { useKeyStore } from '@stores/data/useKeyStore';
import { keysApi } from '@api/modules/keysApi';
import Alert from '../Modal/content/dialogs/Alert.jsx';
import TabNameModal from '../Modal/content/editors/TabNameModal';
import { TabActionsContext, type TabTarget } from './tabActionsContext';
import type { CustomTab } from '@src/types/key/keys';

interface DeleteCustomTabRequest {
  id: string;
  deletingTabs: Set<string>;
  previousTabs: CustomTab[];
  setCustomTabs: (tabs: CustomTab[]) => void;
  isCurrent: () => boolean;
  isSelectionCurrent: () => boolean;
}

const settleCustomTabDelete = async ({
  id,
  deletingTabs,
  previousTabs,
  setCustomTabs,
  isCurrent,
  isSelectionCurrent,
}: DeleteCustomTabRequest) => {
  try {
    const result = await keysApi.customTabs.delete(id);
    if (!result?.success) {
      console.warn('Failed to delete custom tab', result?.error);
      if (isCurrent()) setCustomTabs(previousTabs);
    } else if (isCurrent() && isSelectionCurrent()) {
      // 백엔드도 customTabs:changed로 선택을 실어 보내지만 best effort라
      // 못 받는 경우를 위해 남긴다
      useKeyStore.getState().commitSelectedKeyType(result.selected);
    }
  } catch (error) {
    if (isCurrent()) setCustomTabs(previousTabs);
    console.error('Failed to delete custom tab', error);
  } finally {
    deletingTabs.delete(id);
  }
};

export const TabActionsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { t } = useTranslation();
  const customTabs = useKeyStore((state) => state.customTabs) ?? [];
  const setCustomTabs = useKeyStore((state) => state.setCustomTabs);
  const [renameTarget, setRenameTarget] = useState<TabTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TabTarget | null>(null);
  const deletingTabsRef = useRef(new Set<string>());
  const renameSeqRef = useRef(0);

  const handleRename = async (name: string) => {
    const target = renameTarget;
    if (!target) return;
    const seq = ++renameSeqRef.current;
    // 응답 스냅샷은 커밋 시점 값이다. 기다리는 사이 다른 창의 프리셋이나 undo가
    // 도착하면 세대가 올라 이 스냅샷은 채택되지 않는다
    const generation = useKeyStore.getState().tabMetadataGeneration;
    const response = await keysApi.customTabs.rename(target.id, name);
    if (response?.error) return { error: response.error };
    // 연속 요청에서 뒤늦게 온 응답이 더 최신 상태를 덮지 않게 한다
    if (seq === renameSeqRef.current && response?.result) {
      useKeyStore.getState().setTabMetadata(response.result, generation);
    }
  };

  // 탭 삭제는 의도적으로 Undo 경계를 만들지 않음 — 확인창이 방어선 (1.2.x부터)
  // 다른 편집의 Undo 스냅샷에는 탭이 포함돼 결합 복원됨 (1.6.0부터) — 기록 누락 버그로 오판 금지
  const handleDelete = async (id: string) => {
    if (deletingTabsRef.current.has(id)) return;
    deletingTabsRef.current.add(id);
    const previousTabs = useKeyStore.getState().customTabs;
    // 기다리는 사이 프리셋이나 다른 창의 undo가 들어오면 previousTabs도 result도
    // 이미 과거다. 세대가 그대로일 때만 정산한다
    const generation = useKeyStore.getState().tabMetadataGeneration;
    // 선택은 세대가 따로다. keys:mode-changed가 순서는 안 건드리고 선택만 바꾼다
    const selectionGeneration = useKeyStore.getState().selectionGeneration;
    const isCurrent = () =>
      useKeyStore.getState().tabMetadataGeneration === generation;
    const isSelectionCurrent = () =>
      useKeyStore.getState().selectionGeneration === selectionGeneration;
    setCustomTabs(previousTabs.filter((tab) => tab.id !== id));
    await settleCustomTabDelete({
      id,
      deletingTabs: deletingTabsRef.current,
      previousTabs,
      setCustomTabs,
      isCurrent,
      isSelectionCurrent,
    });
  };

  const contextValue = useMemo(
    () => ({
      requestRename: setRenameTarget,
      requestDelete: setDeleteTarget,
    }),
    [setDeleteTarget, setRenameTarget],
  );

  return (
    <TabActionsContext.Provider value={contextValue}>
      {children}

      <TabNameModal
        isOpen={renameTarget !== null}
        mode="rename"
        initialName={renameTarget?.name ?? ''}
        onClose={() => setRenameTarget(null)}
        onSubmit={handleRename}
        existingNames={customTabs
          .filter((tab) => tab.id !== renameTarget?.id)
          .map((tab) => tab.name)}
      />

      <Alert
        isOpen={deleteTarget !== null}
        type="confirm"
        message={t('tabs.deleteConfirm', { name: deleteTarget?.name || '' })}
        confirmText={t('tabs.delete')}
        cancelText={t('common.cancel')}
        showCancel
        onConfirm={async () => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          // 확인창이 열린 사이 목록이 교체될 수 있음 (프리셋 로드 등)
          // id·이름이 모두 현재 목록과 일치할 때만 삭제
          const current = customTabs.find((tab) => tab.id === target.id);
          if (current && current.name === target.name) {
            await handleDelete(target.id);
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </TabActionsContext.Provider>
  );
};
