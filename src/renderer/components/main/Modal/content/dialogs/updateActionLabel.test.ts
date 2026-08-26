import { describe, expect, it } from 'vitest';
import { resolveAutoUpdateActionLabel } from './updateActionLabel';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('resolveAutoUpdateActionLabel', () => {
  it('자동 업데이트 비활성화면 릴리즈 페이지 라벨', () => {
    expect(
      resolveAutoUpdateActionLabel({
        autoUpdateEnabled: false,
        isAutoUpdating: false,
        phase: 'downloading',
        progress: 50,
        t,
      }),
    ).toBe('update.goToRelease');
  });

  it('idle: 진행 중 여부로 기존 라벨 선택', () => {
    const base = {
      autoUpdateEnabled: true,
      phase: 'idle' as const,
      progress: null,
      t,
    };
    expect(
      resolveAutoUpdateActionLabel({ ...base, isAutoUpdating: false }),
    ).toBe('update.autoUpdate');
    expect(
      resolveAutoUpdateActionLabel({ ...base, isAutoUpdating: true }),
    ).toBe('update.autoUpdating');
  });

  it('downloading: 진행률이 있으면 percent 보간, 없으면 무진행 라벨', () => {
    const base = {
      autoUpdateEnabled: true,
      isAutoUpdating: true,
      phase: 'downloading' as const,
      t,
    };
    expect(resolveAutoUpdateActionLabel({ ...base, progress: 42 })).toBe(
      'update.phaseDownloading:{"percent":42}',
    );
    expect(resolveAutoUpdateActionLabel({ ...base, progress: null })).toBe(
      'update.phaseDownloadingNoProgress',
    );
  });

  it('verifying / installing / restarting 단계 라벨', () => {
    const base = {
      autoUpdateEnabled: true,
      isAutoUpdating: true,
      progress: null,
      t,
    };
    expect(resolveAutoUpdateActionLabel({ ...base, phase: 'verifying' })).toBe(
      'update.phaseVerifying',
    );
    expect(resolveAutoUpdateActionLabel({ ...base, phase: 'installing' })).toBe(
      'update.phaseInstalling',
    );
    expect(
      resolveAutoUpdateActionLabel({
        ...base,
        isAutoUpdating: false,
        phase: 'restarting',
      }),
    ).toBe('update.phaseRestarting');
    expect(
      resolveAutoUpdateActionLabel({
        ...base,
        phase: 'installed',
      }),
    ).toBe('update.phaseInstalled');
  });
});
