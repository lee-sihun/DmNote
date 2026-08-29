import { create } from 'zustand';
import { appApi } from '@api/modules/appApi';
import type { UpdateProgressEvent } from '@src/types/plugin/api';

export type AutoUpdatePhase =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'restarting'
  | 'installed'; // 설치는 끝났지만 재시작 요청 실패 — 사용자가 직접 다시 실행

export const isAutoUpdateDismissLocked = (phase: AutoUpdatePhase) =>
  phase === 'downloading' ||
  phase === 'verifying' ||
  phase === 'installing' ||
  phase === 'restarting';

// 설치는 끝났지만 재시작 요청이 실패한 경우 — 새 버전은 다음 실행에 적용됨
export class UpdateInstalledRestartFailedError extends Error {
  readonly code = 'UPDATE_INSTALLED_RESTART_FAILED';
  readonly originalError: unknown;

  constructor(cause: unknown) {
    super(getErrorMessage(cause));
    this.name = 'UpdateInstalledRestartFailedError';
    this.originalError = cause;
  }
}

/**
 * 개발 시뮬레이터가 갈아 끼우는 자리. 실기에서 진짜 다운로드나 앱 교체 없이
 * 게이지·라벨 전이를 확인하려면 이 두 호출만 대체하면 되고, 진행 이벤트 구독과
 * 상태 변환은 실제 경로를 그대로 탄다.
 * 프로덕션 빌드에서는 setter가 아무 일도 하지 않는다
 */
interface UpdateRuntime {
  autoUpdate: (tag: string) => Promise<unknown>;
  restart: () => Promise<void>;
}

const realUpdateRuntime: UpdateRuntime = {
  autoUpdate: (tag) => appApi.autoUpdate(tag),
  restart: () => appApi.restart(),
};

let updateRuntime: UpdateRuntime = realUpdateRuntime;

export const setUpdateRuntimeForDev = (next: UpdateRuntime | null) => {
  if (!import.meta.env.DEV) return;
  updateRuntime = next ?? realUpdateRuntime;
};

/**
 * app_restart는 요청만 접수하고 즉시 성공으로 돌아온다. 실제 재시작은 모든 창이
 * 에디터 flush에 ack해야 실행되고, 취소되면(핸드셰이크 타임아웃 10초) 백엔드가
 * 로그만 남긴다. 알림 없이 "재시작 중..."에 셔머까지 흐르면 화면이 일하는 척을 하므로,
 * 타임아웃보다 넉넉히 기다린 뒤 재실행 상태로 내려 버튼을 돌려준다
 */
const RESTART_WATCHDOG_MS = 15_000;

let restartWatchdog: number | null = null;

function clearRestartWatchdog(): void {
  if (restartWatchdog === null) return;
  window.clearTimeout(restartWatchdog);
  restartWatchdog = null;
}

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
  retryRestart: () => Promise<void>;
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

export const useUpdateStore = create<UpdateState>((set, get) => {
  const armRestartWatchdog = () => {
    clearRestartWatchdog();
    restartWatchdog = window.setTimeout(() => {
      restartWatchdog = null;
      if (get().autoUpdatePhase !== 'restarting') return;
      // 재시작이 조용히 취소됐다. 다시 시도할 수 있게 버튼을 연다
      set({ autoUpdatePhase: 'installed' });
    }, RESTART_WATCHDOG_MS);
  };

  return {
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
        // 누르는 즉시 0%. idle로 두면 첫 진행 이벤트가 올 때까지 라벨이
        // "업데이트 중..."을 거쳐 두 번 바뀌고, 게이지도 출발선이 없다
        autoUpdatePhase: 'downloading',
        autoUpdateProgress: 0,
        error: null,
      });

      // 성공적으로 재시작된 다음 실행에서 릴리즈 노트 모달을 1회 노출
      setPostUpdateNoticeVersion(normalizedTag);

      // 백엔드 진행 단계 반영, 성공·실패 경로에서 각각 해제한다.
      // 해제는 비동기라 완료 직후 도착한 늦은 이벤트가 restarting을 덮지 않도록 settled로 차단
      let settled = false;
      const unsubscribe = appApi.onUpdateProgress(
        (event: UpdateProgressEvent) => {
          if (settled) return;
          set({
            autoUpdatePhase: event.phase,
            // 다운로드 중 null은 '서버가 크기를 안 알려줬다'는 뜻이다. 직전 값으로 메우면
            // 눌렀을 때 심어둔 0이 끝까지 남아 멈춘 화면이 되므로 그대로 두고
            // 진행률 없는 라벨로 넘긴다
            autoUpdateProgress:
              event.phase === 'downloading' ? event.percent : null,
          });
        },
      );

      try {
        // listen 등록이 끝나기 전에 백엔드가 첫 이벤트를 보내면 그 단계를 놓친다.
        // 등록 실패는 진행률만 잃는 것이라 업데이트 자체는 계속 진행한다
        await unsubscribe.ready.catch(() => undefined);
        await updateRuntime.autoUpdate(normalizedTag);
      } catch (e) {
        settled = true;
        unsubscribe();
        clearPendingPostUpdateReleaseNotice();
        const message = getErrorMessage(e);
        set({
          isAutoUpdating: false,
          autoUpdatePhase: 'idle',
          autoUpdateProgress: null,
          error: message,
        });
        throw e;
      }

      settled = true;
      unsubscribe();
      // 설치 완료 → 재시작 요청. isAutoUpdating은 유지해 재클릭(중복 설치)을 막고,
      // 재시작이 취소되면 dismissUpdate로 초기화
      set({
        autoUpdatePhase: 'restarting',
        autoUpdateProgress: null,
      });

      try {
        await updateRuntime.restart();
        armRestartWatchdog();
      } catch (e) {
        // 새 버전은 이미 디스크에 있음 - 릴리즈 노트 예약은 유지하고 재시작만 실패로 알림
        // isAutoUpdating을 유지해 중복 설치를 막고, 모달을 닫으면(dismissUpdate) 초기화
        set({
          autoUpdatePhase: 'installed',
          autoUpdateProgress: null,
        });
        throw new UpdateInstalledRestartFailedError(e);
      }
    },

    // 설치는 끝났는데 재시작만 실패한 상태에서 다시 요청한다.
    // 설치를 반복하지 않고 재시작만 다시 부르므로 재시도 자체가 안전하다
    retryRestart: async () => {
      if (get().autoUpdatePhase !== 'installed') return;

      set({ autoUpdatePhase: 'restarting' });
      try {
        await updateRuntime.restart();
        armRestartWatchdog();
      } catch (e) {
        set({ autoUpdatePhase: 'installed' });
        throw new UpdateInstalledRestartFailedError(e);
      }
    },

    dismissUpdate: () => {
      // 다운로드부터 재시작 요청까지 중간에 멈출 방법이 없다. 여기서 진행 상태를 지우면
      // 재진입 가드가 풀려 설치가 두 번 돌거나, 재시작 실패를 감지할 watchdog을 잃는다
      const { autoUpdatePhase } = get();
      if (isAutoUpdateDismissLocked(autoUpdatePhase)) {
        return;
      }

      clearRestartWatchdog();
      set({
        dismissed: true,
        updateAvailable: false,
        isLatestVersion: false,
        // 재시작 대기 상태에서 닫으면 다시 시도할 수 있게 초기화
        isAutoUpdating: false,
        autoUpdatePhase: 'idle',
        autoUpdateProgress: null,
      });
    },

    skipVersion: () => {
      const { updateInfo } = get();
      if (updateInfo) {
        setSkippedVersion(updateInfo.latestVersion);
      }
      set({ dismissed: true, updateAvailable: false, isLatestVersion: false });
    },
  };
});

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
    retryRestart: store.retryRestart,
  };
}
