import type {
  EditorGraphRuntimePropertyPatchV1,
  EditorKnobRuntimePropertyPatchV1,
} from '@src/types/editor';
import {
  idTargets,
  patchElementPropertyById,
  patchElementPropertyByTargets,
  type PropertyCommitOptions,
} from './elementPropertyCore';

export const patchGraphTypesByIds = (
  ids: readonly string[],
  graphType: 'line' | 'bar',
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('graph', ids),
    { property: 'graphType', value: graphType },
    options,
  );

export const patchGraphColorsByIds = (
  ids: readonly string[],
  graphColor: string,
  options: PropertyCommitOptions = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('graph', ids),
    { property: 'graphColor', value: graphColor },
    options,
  );

export const patchGraphPropertiesByIds = (
  ids: readonly string[],
  patch: EditorGraphRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(idTargets('graph', ids), patch, options);

export const patchKnobAxisIdById = (
  id: string,
  axisId: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'knob',
    id,
    { property: 'axisId', value: axisId },
    options,
  );

export const patchKnobPropertiesByIds = (
  ids: readonly string[],
  patch: EditorKnobRuntimePropertyPatchV1,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(idTargets('knob', ids), patch, options);

export const patchSoundPathById = (
  id: string,
  soundPath: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'key',
    id,
    { property: 'soundPath', value: soundPath },
    options,
  );

export const patchSoundEnabledById = (
  id: string,
  soundEnabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'key',
    id,
    { property: 'soundEnabled', value: soundEnabled },
    options,
  );

export const patchSoundEnabledByIds = (
  ids: readonly string[],
  soundEnabled: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('key', ids),
    { property: 'soundEnabled', value: soundEnabled },
    options,
  );

const validSoundVolume = (soundVolume: number): boolean =>
  Number.isFinite(soundVolume) && soundVolume >= 0 && soundVolume <= 200;

export const patchSoundVolumeById = (
  id: string,
  soundVolume: number,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  validSoundVolume(soundVolume)
    ? patchElementPropertyById(
        'key',
        id,
        { property: 'soundVolume', value: soundVolume },
        options,
      )
    : Promise.resolve(false);

export const patchSoundVolumeByIds = (
  ids: readonly string[],
  soundVolume: number,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  validSoundVolume(soundVolume)
    ? patchElementPropertyByTargets(
        idTargets('key', ids),
        { property: 'soundVolume', value: soundVolume },
        options,
      )
    : Promise.resolve(false);

export const patchSoundPathByIds = (
  ids: readonly string[],
  soundPath: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    idTargets('key', ids),
    { property: 'soundPath', value: soundPath },
    options,
  );
