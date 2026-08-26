import type { AutoUpdatePhase } from '@stores/useUpdateStore';

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

interface ResolveAutoUpdateActionLabelParams {
  autoUpdateEnabled: boolean;
  isAutoUpdating: boolean;
  phase: AutoUpdatePhase;
  progress: number | null;
  t: Translate;
}

// 업데이트 모달 기본 버튼 라벨 — 진행 단계가 있으면 단계 표시, 없으면 기존 라벨
export const resolveAutoUpdateActionLabel = ({
  autoUpdateEnabled,
  isAutoUpdating,
  phase,
  progress,
  t,
}: ResolveAutoUpdateActionLabelParams): string => {
  if (!autoUpdateEnabled) {
    return t('update.goToRelease');
  }

  switch (phase) {
    case 'downloading':
      return progress === null
        ? t('update.phaseDownloadingNoProgress')
        : t('update.phaseDownloading', { percent: progress });
    case 'verifying':
      return t('update.phaseVerifying');
    case 'installing':
      return t('update.phaseInstalling');
    case 'restarting':
      return t('update.phaseRestarting');
    case 'idle':
    default:
      return isAutoUpdating ? t('update.autoUpdating') : t('update.autoUpdate');
  }
};
