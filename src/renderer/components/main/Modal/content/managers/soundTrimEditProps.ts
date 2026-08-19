import type { SoundTrimEditItem } from '@api/modules/remoteSheetApi';

/**
 * 편집 대상 사운드를 SoundTrimModal의 편집 props로 편다.
 * 대상이 없으면 새로 만들기 모드
 */
export const soundTrimEditProps = (item: SoundTrimEditItem | null) => ({
  editingSoundPath: item?.soundPath ?? null,
  editingTrimStartRatio: item?.trimStartRatio,
  editingTrimEndRatio: item?.trimEndRatio,
  editingDisplayName: item?.displayName,
});
