import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { soundApi } from '@api/modules/resources/resourceApi';
import type { SoundListItem } from '@src/types/plugin/api';

interface SoundPickerLibraryRuntimeOptions {
  t: (key: string) => string;
  renameValue: string;
  isOpenRef: MutableRefObject<boolean>;
  loadRequestRef: MutableRefObject<number>;
  pendingSoundActionsRef: MutableRefObject<Set<string>>;
  setSounds: Dispatch<SetStateAction<SoundListItem[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLoadError: Dispatch<SetStateAction<string>>;
  setRenamingPath: Dispatch<SetStateAction<string | null>>;
  getSoundListCache: () => SoundListItem[] | null;
  setSoundListCache: (sounds: SoundListItem[]) => void;
}

export const useSoundPickerLibraryRuntime = ({
  t,
  renameValue,
  isOpenRef,
  loadRequestRef,
  pendingSoundActionsRef,
  setSounds,
  setIsLoading,
  setLoadError,
  setRenamingPath,
  getSoundListCache,
  setSoundListCache,
}: SoundPickerLibraryRuntimeOptions) => {
  const loadSounds = async () => {
    const requestId = ++loadRequestRef.current;
    const cachedSounds = getSoundListCache();
    if (cachedSounds) {
      setSounds(cachedSounds);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setLoadError('');
    try {
      const nextSounds = await window.api.sound.list();
      if (requestId !== loadRequestRef.current) return;
      setSoundListCache(nextSounds);
      if (!isOpenRef.current) return;
      setSounds(nextSounds);
    } catch (error) {
      if (requestId !== loadRequestRef.current || !isOpenRef.current) return;
      console.error('Failed to load sound list', error);
      setLoadError(t('soundPicker.loadFailed') || '사운드 목록 로드 실패');
    } finally {
      if (requestId === loadRequestRef.current && isOpenRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleDelete = async (item: SoundListItem) => {
    if (pendingSoundActionsRef.current.has(item.soundPath)) return;
    pendingSoundActionsRef.current.add(item.soundPath);

    try {
      const confirmed = await window.api.ui.dialog.confirm(
        t('soundPicker.deleteConfirm') ||
          '사운드를 삭제하시겠습니까? 파일이 삭제되고 이 사운드를 사용하는 모든 요소에서 해제됩니다.',
        {
          confirmText: t('contextMenu.delete') || '삭제',
          cancelText: t('common.cancel') || '취소',
          danger: true,
        },
      );
      if (!confirmed) return;

      loadRequestRef.current += 1;
      setSounds((current) => {
        const next = current.filter(
          (candidate) => candidate.soundPath !== item.soundPath,
        );
        setSoundListCache(next);
        return next;
      });
      await soundApi.remove(item.soundPath);
      // 백엔드가 참조 해제와 canonical 동기화를 소유
      // 응답 대기 중 새로 선택한 사운드를 예전 선택으로 재판단해 지우지 않는다
      await loadSounds();
    } catch (error) {
      console.error('Failed to delete sound', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.deleteFailed') || '사운드 삭제 실패');
    } finally {
      pendingSoundActionsRef.current.delete(item.soundPath);
    }
  };

  const commitRename = async (item: SoundListItem) => {
    const trimmed = renameValue.trim();
    setRenamingPath(null);
    if (!trimmed || trimmed === (item.displayName || item.fileName)) return;
    if (pendingSoundActionsRef.current.has(item.soundPath)) return;
    pendingSoundActionsRef.current.add(item.soundPath);
    try {
      loadRequestRef.current += 1;
      setSounds((current) => {
        const next = current.map((candidate) =>
          candidate.soundPath === item.soundPath
            ? { ...candidate, displayName: trimmed }
            : candidate,
        );
        setSoundListCache(next);
        return next;
      });
      await soundApi.rename(item.soundPath, trimmed);
      await loadSounds();
    } catch (error) {
      console.error('Failed to rename sound', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.renameFailed') || '사운드 이름 변경 실패');
    } finally {
      pendingSoundActionsRef.current.delete(item.soundPath);
    }
  };

  const handleToggleHidden = async (item: SoundListItem) => {
    if (pendingSoundActionsRef.current.has(item.soundPath)) return;
    pendingSoundActionsRef.current.add(item.soundPath);
    try {
      const nextHidden = !item.hidden;
      loadRequestRef.current += 1;
      setSounds((current) => {
        const next = current.map((candidate) =>
          candidate.soundPath === item.soundPath
            ? { ...candidate, hidden: nextHidden }
            : candidate,
        );
        setSoundListCache(next);
        return next;
      });
      await soundApi.setHidden(item.soundPath, nextHidden);
      await loadSounds();
    } catch (error) {
      console.error('Failed to toggle sound hidden', error);
      // loadSounds가 loadError를 초기화하므로 reload 후에 실패 메시지 설정
      await loadSounds();
      setLoadError(t('soundPicker.hideFailed') || '사운드 숨김 변경 실패');
    } finally {
      pendingSoundActionsRef.current.delete(item.soundPath);
    }
  };

  return {
    loadSounds,
    handleDelete,
    commitRename,
    handleToggleHidden,
  };
};
