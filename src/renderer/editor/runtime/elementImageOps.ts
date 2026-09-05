import type { NativeElementType } from '../model/elementIdMap';
import type {
  ImageMode,
  ImageTransformLeafPatch,
} from '@src/types/key/imageLayer';
import {
  patchElementPropertyById,
  patchElementPropertyByTargets,
} from './elementPropertyCore';

export const patchInactiveImageById = (
  type: NativeElementType,
  id: string,
  inactiveImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'inactiveImage', value: inactiveImage },
    options,
  );

export const patchInactiveImageByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  inactiveImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'inactiveImage', value: inactiveImage },
    options,
  );

export const patchActiveImageById = (
  type: 'key' | 'knob',
  id: string,
  activeImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'activeImage', value: activeImage },
    options,
  );

export const patchActiveImageByTargets = (
  targets: readonly { elementType: 'key' | 'knob'; id: string }[],
  activeImage: string,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'activeImage', value: activeImage },
    options,
  );

export const patchIdleTransparentById = (
  type: NativeElementType,
  id: string,
  idleTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'idleTransparent', value: idleTransparent },
    options,
  );

export const patchIdleTransparentByTargets = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  idleTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'idleTransparent', value: idleTransparent },
    options,
  );

export const patchActiveTransparentById = (
  type: 'key' | 'knob',
  id: string,
  activeTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'activeTransparent', value: activeTransparent },
    options,
  );

export const patchActiveTransparentByTargets = (
  targets: readonly { elementType: 'key' | 'knob'; id: string }[],
  activeTransparent: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyByTargets(
    targets,
    { property: 'activeTransparent', value: activeTransparent },
    options,
  );

type ImageFit = 'cover' | 'contain' | 'fill' | 'none';

export const patchIdleImageFitById = (
  type: NativeElementType,
  id: string,
  idleImageFit: ImageFit,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'idleImageFit', value: idleImageFit },
    options,
  );

export const patchActiveImageFitById = (
  type: 'key' | 'knob',
  id: string,
  activeImageFit: ImageFit,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'activeImageFit', value: activeImageFit },
    options,
  );

export const patchImageModeById = (
  id: string,
  imageMode: ImageMode,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'key',
    id,
    { property: 'imageMode', value: imageMode },
    options,
  );

// null이면 해당 상태의 변환을 identity로 되돌린다
export const patchImageTransformById = (
  id: string,
  state: 'idle' | 'active',
  patch: ImageTransformLeafPatch | null,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    'key',
    id,
    state === 'idle'
      ? { property: 'idleImageTransform', value: patch }
      : { property: 'activeImageTransform', value: patch },
    options,
  );
