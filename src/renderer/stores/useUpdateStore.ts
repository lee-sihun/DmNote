import { create } from 'zustand';
import { appApi } from '@api/modules/appApi';
import type { UpdateProgressEvent } from '@src/types/plugin/api';

export type AutoUpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'restarting';

const GITHUB_REPO = 'DmNote-App/DmNote';
const STORAGE_KEY = 'dmnote:skipped-version';
const CACHE_KEY = 'dmnote:update-check-cache';
const POST_UPDATE_NOTICE_KEY = 'dmnote:post-update-release-notice-version';
const CACHE_MS = 5 * 60 * 1000; // 5분 캐시
const CURRENT_VERSION = __APP_VERSION__;

interface GithubRelease {
  tag_name: string;
  html_url: string;
  name: string;
  body: string;
  published_at: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
}

interface UpdateState {
  updateAvailable: boolean;
  isLatestVersion: boolean;
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isAutoUpdating: boolean;
  autoUpdatePhase: AutoUpdatePhase;
  autoUpdateProgress: number | null; // 다운로드 % (알 수 없으면 null)
  error: string | null;
  dismissed: boolean;
  cacheUntil: number | null;
  lastCheckHadUpdate: boolean; // 마지막 체크 결과 (캐시용)
  checkForUpdates: (manual?: boolean) => Promise<void>;
  runAutoUpdate: (targetTag: string) => Promise<void>;
  dismissUpdate: () => void;
  skipVersion: () => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return 'Unknown error';
}

function compareVersions(current: string, latest: string): number {
  const normalize = (v: string) => v.replace(/^v/i, '');
  const currentParts = normalize(current).split('.').map(Number);
  const latestParts = normalize(latest).split('.').map(Number);

  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const a = currentParts[i] || 0;
    const b = latestParts[i] || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

function getSkippedVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setSkippedVersion(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch (e) {
    console.warn('Failed to save skipped version', e);
  }
}

function clearSkippedVersion(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear skipped version', e);
  }
}

function getCacheUntil(): number | null {
  try {
    const stored = localStorage.getItem(CACHE_KEY);
    if (stored) {
      const time = parseInt(stored, 10);
      if (time > Date.now()) {
        return time;
      }
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // ignore
  }
  return null;
}

function setCacheUntil(time: number): void {
  try {
    localStorage.setItem(CACHE_KEY, String(time));
  } catch {
    // ignore
  }
}

function normalizeVersionString(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function setPostUpdateNoticeVersion(version: string): void {
  try {
    localStorage.setItem(
      POST_UPDATE_NOTICE_KEY,
      normalizeVersionString(version),
    );
  } catch (e) {
    console.warn('Failed to save post-update notice version', e);
  }
}

export function clearPendingPostUpdateReleaseNotice(): void {
  try {
    localStorage.removeItem(POST_UPDATE_NOTICE_KEY);
  } catch (e) {
    console.warn('Failed to clear post-update notice version', e);
  }
}

export function hasPendingPostUpdateReleaseNotice(
  currentVersion: string = CURRENT_VERSION,
): boolean {
  try {
    const pending = localStorage.getItem(POST_UPDATE_NOTICE_KEY);
    if (!pending) return false;
    return (
      normalizeVersionString(pending) === normalizeVersionString(currentVersion)
    );
  } catch {
    return false;
  }
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  updateAvailable: false,
  isLatestVersion: false,
  updateInfo: null,
  isChecking: false,
  isAutoUpdating: false,
  autoUpdatePhase: 'idle',
  autoUpdateProgress: null,
  error: null,
  dismissed: false,
  cacheUntil: getCacheUntil(),
  lastCheckHadUpdate: false,

  checkForUpdates: async (manual = false) => {
    const state = get();

    // 이미 체크 중이면 무시
    if (state.isChecking) return;

    // 캐시가 유효하고 캐시된 결과가 있으면 API 호출 없이 캐시 사용
    const now = Date.now();
    if (state.cacheUntil && state.cacheUntil > now && state.updateInfo) {
      // 캐시된 결과로 모달 표시 (수동 체크일 때만)
      if (manual) {
        const skippedVersion = getSkippedVersion();
        const hasUpdate = state.lastCheckHadUpdate;

        // 스킵한 버전이 아니거나 업데이트가 없으면 모달 표시
        if (hasUpdate && skippedVersion !== state.updateInfo.latestVersion) {
          set({
            updateAvailable: true,
            isLatestVersion: false,
            dismissed: false,
          });
        } else if (hasUpdate) {
          // 스킵한 버전이지만 수동 체크이므로 모달 표시
          set({
            updateAvailable: true,
            isLatestVersion: false,
            dismissed: false,
          });
        } else {
          set({
            updateAvailable: false,
            isLatestVersion: true,
            dismissed: false,
          });
        }
      }
      return;
    }

    set({
      isChecking: true,
      error: null,
      dismissed: false,
      isLatestVersion: false,
    });

    try {
      const response = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
        {
          headers: {
            Accept: 'application/vnd.github.v3+json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const release: GithubRelease = await response.json();
      const latestVersion = release.tag_name;
      const skippedVersion = getSkippedVersion();

      // 캐시 설정 (성공적으로 체크 완료 시)
      const cacheTime = now + CACHE_MS;
      setCacheUntil(cacheTime);

      // 버전 비교
      const hasUpdate = compareVersions(CURRENT_VERSION, latestVersion) < 0;

      const updateInfo: UpdateInfo = {
        currentVersion: CURRENT_VERSION,
        latestVersion,
        releaseUrl: release.html_url,
        releaseName: release.name || latestVersion,
        releaseNotes: release.body || '',
        publishedAt: release.published_at,
      };

      // 건너뛴 버전이면 무시 (자동 체크일 때만, 실제 업데이트가 있을 때만)
      if (!manual && hasUpdate && skippedVersion === latestVersion) {
        set({
          updateAvailable: false,
          updateInfo,
          isChecking: false,
          cacheUntil: cacheTime,
          lastCheckHadUpdate: hasUpdate,
        });
        return;
      }

      if (hasUpdate) {
        set({
          updateInfo,
          updateAvailable: true,
          isLatestVersion: false,
          isChecking: false,
          cacheUntil: cacheTime,
          lastCheckHadUpdate: true,
        });
      } else {
        // 최신 버전 모달은 수동 체크일 때만 표시
        set({
          updateAvailable: false,
          isLatestVersion: manual, // 수동 체크일 때만 true
          updateInfo,
          isChecking: false,
          cacheUntil: cacheTime,
          lastCheckHadUpdate: false,
        });
        // 현재 버전이 최신이거나 더 높으면 건너뛰기 정보 초기화
        clearSkippedVersion();
      }
    } catch (e) {
      const message = getErrorMessage(e);
      set({ error: message, isChecking: false });
      console.error('Update check failed:', e);
    }
  },

  runAutoUpdate: async (targetTag: string) => {
    const state = get();
    if (state.isAutoUpdating) return;

    const normalizedTag = targetTag?.trim();
    if (!normalizedTag) {
      throw new Error('Invalid target version');
    }

    set({
      isAutoUpdating: true,
      autoUpdatePhase: 'idle',
      autoUpdateProgress: null,
      error: null,
    });

    // 성공적으로 재시작된 다음 실행에서 릴리즈 노트 모달을 1회 노출
    setPostUpdateNoticeVersion(normalizedTag);

    // 백엔드 진행 단계 반영 — 성공/실패 모두 finally에서 해제
    const unsubscribe = appApi.onUpdateProgress(
      (event: UpdateProgressEvent) => {
        set({
          autoUpdatePhase: event.phase,
          autoUpdateProgress:
            event.phase === 'downloading' ? event.percent : null,
        });
      },
    );

    try {
      await appApi.autoUpdate(normalizedTag);
      // 재시작 요청까지 보낸 상태 — 프로세스가 곧 종료됨
      set({
        isAutoUpdating: false,
        autoUpdatePhase: 'restarting',
        autoUpdateProgress: null,
      });
    } catch (e) {
      clearPendingPostUpdateReleaseNotice();
      const message = getErrorMessage(e);
      set({
        isAutoUpdating: false,
        autoUpdatePhase: 'idle',
        autoUpdateProgress: null,
        error: message,
      });
      throw e;
    } finally {
      unsubscribe();
    }
  },

  dismissUpdate: () => {
    set({ dismissed: true, updateAvailable: false, isLatestVersion: false });
  },

  skipVersion: () => {
    const { updateInfo } = get();
    if (updateInfo) {
      setSkippedVersion(updateInfo.latestVersion);
    }
    set({ dismissed: true, updateAvailable: false, isLatestVersion: false });
  },
}));

// 훅 래퍼 (기존 코드 호환성)
export function useUpdateCheck() {
  const store = useUpdateStore();

  return {
    updateAvailable: store.updateAvailable && !store.dismissed,
    isLatestVersion: store.isLatestVersion && !store.dismissed,
    updateInfo: store.updateInfo,
    isChecking: store.isChecking,
    isAutoUpdating: store.isAutoUpdating,
    autoUpdatePhase: store.autoUpdatePhase,
    autoUpdateProgress: store.autoUpdateProgress,
    error: store.error,
    dismissUpdate: store.dismissUpdate,
    skipVersion: store.skipVersion,
    checkForUpdates: store.checkForUpdates,
    runAutoUpdate: store.runAutoUpdate,
  };
}
