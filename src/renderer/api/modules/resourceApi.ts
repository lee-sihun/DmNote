import { invoke } from '@tauri-apps/api/core';
import { subscribe } from './shared';

export const fontApi = {
  load: () => invoke<import('@src/types/api').FontLoadResult>('font_load'),
};

export const imageApi = {
  load: () => invoke<import('@src/types/api').ImageLoadResult>('image_load'),
};

export const soundApi = {
  load: () => invoke<import('@src/types/api').SoundLoadResult>('sound_load'),
  list: () => invoke<import('@src/types/api').SoundListItem[]>('sound_list'),
  setEnabled: (soundPath: string, enabled: boolean) =>
    invoke<import('@src/types/api').SoundSetEnabledResult>(
      'sound_set_enabled',
      { soundPath, enabled },
    ),
  remove: (soundPath: string) =>
    invoke<import('@src/types/api').SoundDeleteResult>('sound_delete', {
      soundPath,
    }),
  saveProcessedWav: (
    wavBase64: string,
    fileName?: string,
    originalBase64?: string,
    originalExtension?: string,
    trimStartRatio?: number,
    trimEndRatio?: number,
  ) =>
    invoke<import('@src/types/api').SoundSaveProcessedWavResult>(
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
    invoke<import('@src/types/api').SoundLoadOriginalResult>(
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
    invoke<import('@src/types/api').SoundUpdateProcessedWavResult>(
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
    invoke('key_sound_set_latency_logging', { enabled }).then(
      () => undefined,
    ),
};

export const counterAnimationApi = {
  list: () =>
    invoke<import('@src/types/api').CounterAnimationListResponse>(
      'counter_animation_list',
    ),
  create: (request: import('@src/types/api').CounterAnimationCreateRequest) =>
    invoke<import('@src/types/api').CounterAnimationUpsertResponse>(
      'counter_animation_create',
      { request },
    ),
  update: (request: import('@src/types/api').CounterAnimationUpdateRequest) =>
    invoke<import('@src/types/api').CounterAnimationUpsertResponse>(
      'counter_animation_update',
      { request },
    ),
  remove: (id: string) =>
    invoke<import('@src/types/api').CounterAnimationDeleteResponse>(
      'counter_animation_delete',
      { id },
    ),
  onChanged: (
    listener: (
      payload: import('@src/types/api').CounterAnimationListResponse,
    ) => void,
  ) =>
    subscribe<import('@src/types/api').CounterAnimationListResponse>(
      'counterAnimation:changed',
      listener,
    ),
};
