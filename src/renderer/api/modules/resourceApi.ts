import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';
import { runLegacyEditorMutation } from '@src/renderer/editor/runtime/legacyEditorMutation';

export const fontApi = {
  load: () =>
    invoke<import('@src/types/plugin/api').FontLoadResult>('font_load'),
};

export const imageApi = {
  load: () =>
    runLegacyEditorMutation(
      () =>
        invoke<import('@src/types/plugin/api').ImageLoadResult>('image_load'),
      { syncAfter: false },
    ),
};

export const soundApi = {
  load: () =>
    invoke<import('@src/types/plugin/api').SoundLoadResult>('sound_load'),
  list: () =>
    invoke<import('@src/types/plugin/api').SoundListItem[]>('sound_list'),
  rename: (soundPath: string, displayName: string) =>
    invoke<import('@src/types/plugin/api').SoundRenameResult>('sound_rename', {
      soundPath,
      displayName,
    }),
  remove: (soundPath: string) =>
    runLegacyEditorMutation(() =>
      invoke<import('@src/types/plugin/api').SoundDeleteResult>(
        'sound_delete',
        {
          soundPath,
        },
      ),
    ),
  setHidden: (soundPath: string, hidden: boolean) =>
    invoke<import('@src/types/plugin/api').SoundSetHiddenResult>(
      'sound_set_hidden',
      { soundPath, hidden },
    ),
  // deprecated — setHidden의 역논리 별칭 (enabled = !hidden)
  setEnabled: (soundPath: string, enabled: boolean) =>
    invoke<import('@src/types/plugin/api').SoundSetEnabledResult>(
      'sound_set_enabled',
      { soundPath, enabled },
    ),
  saveProcessedWav: (
    wavBase64: string,
    fileName?: string,
    originalBase64?: string,
    originalExtension?: string,
    trimStartRatio?: number,
    trimEndRatio?: number,
  ) =>
    invoke<import('@src/types/plugin/api').SoundSaveProcessedWavResult>(
      'sound_save_processed_wav',
      {
        request: {
          wavBase64,
          fileName,
          originalBase64,
          originalExtension,
          trimStartRatio,
          trimEndRatio,
        },
      },
    ),
  loadOriginal: (soundPath: string) =>
    invoke<import('@src/types/plugin/api').SoundLoadOriginalResult>(
      'sound_load_original',
      { soundPath },
    ),
  updateProcessedWav: (
    soundPath: string,
    wavBase64: string,
    trimStartRatio?: number,
    trimEndRatio?: number,
    displayName?: string,
  ) =>
    invoke<import('@src/types/plugin/api').SoundUpdateProcessedWavResult>(
      'sound_update_processed_wav',
      {
        request: {
          soundPath,
          wavBase64,
          trimStartRatio,
          trimEndRatio,
          displayName,
        },
      },
    ),
  setLatencyLogging: (enabled: boolean) =>
    invoke('key_sound_set_latency_logging', { enabled }).then(() => undefined),
};

// 키음 출력 백엔드 (기본 장치 / ASIO)
export type KeySoundOutputBackend =
  | { kind: 'defaultDevice' }
  | { kind: 'asio'; driverName: string; bufferSize?: number | null };

export type KeySoundOutputErrorCode =
  | 'asioUnavailableBuild'
  | 'asioDeviceNotFound'
  | 'asioOpenFailed'
  | 'defaultOpenFailed';

export interface KeySoundOutputDevices {
  defaultDevice: boolean;
  asio: string[];
}

export interface KeySoundOutputState {
  requested: KeySoundOutputBackend;
  effective: KeySoundOutputBackend;
  error: string | null;
  errorCode: KeySoundOutputErrorCode | null;
  asioAvailable: boolean;
}

export const keySoundOutputApi = {
  listDevices: () =>
    invoke<KeySoundOutputDevices>('key_sound_list_output_devices'),
  getState: () => invoke<KeySoundOutputState>('key_sound_get_output_state'),
  setBackend: (backend: KeySoundOutputBackend) =>
    invoke<KeySoundOutputState>('key_sound_set_output_backend', { backend }),
};

export const counterAnimationApi = {
  list: () =>
    invoke<import('@src/types/plugin/api').CounterAnimationListResponse>(
      'counter_animation_list',
    ),
  create: (
    request: import('@src/types/plugin/api').CounterAnimationCreateRequest,
  ) =>
    invoke<import('@src/types/plugin/api').CounterAnimationUpsertResponse>(
      'counter_animation_create',
      { request },
    ),
  update: (
    request: import('@src/types/plugin/api').CounterAnimationUpdateRequest,
  ) =>
    runLegacyEditorMutation(() =>
      invoke<import('@src/types/plugin/api').CounterAnimationUpsertResponse>(
        'counter_animation_update',
        { request },
      ),
    ),
  remove: (id: string) =>
    runLegacyEditorMutation(() =>
      invoke<import('@src/types/plugin/api').CounterAnimationDeleteResponse>(
        'counter_animation_delete',
        { id },
      ),
    ),
  onChanged: (
    listener: (
      payload: import('@src/types/plugin/api').CounterAnimationListResponse,
    ) => void,
  ) =>
    subscribe<import('@src/types/plugin/api').CounterAnimationListResponse>(
      'counterAnimation:changed',
      listener,
    ),
};
