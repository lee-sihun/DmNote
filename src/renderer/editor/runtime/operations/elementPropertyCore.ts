import { isNativeElementId } from '../../model/elementId';
import type { NativeElementType } from '../../model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  type ElementIntentReceipt,
  type PropertyIntents,
} from '../intent/elementIntent';
import { commitSemanticOps } from './editorSemanticOps';
import { captureEditorDocument } from '../coordinator/editorStateCoordinator';
import type { EditorElementPropertyPatchV1 } from '@src/types/editor';
import {
  applyImageTransformLeaf,
  type ImageTransform,
} from '@src/types/key/imageLayer';
import { implicitElementFontBold } from '@utils/core/fontWeights';

const POSITION_FIELD_BY_TYPE: Record<NativeElementType, string> = {
  key: 'keyPositions',
  stat: 'statPositions',
  graph: 'graphPositions',
  knob: 'knobPositions',
};

// 현재 문서의 요소 레코드 (없으면 null)
const findCurrentPosition = (
  document: Record<string, unknown> | null | undefined,
  elementType: NativeElementType,
  id: string,
): (Record<string, unknown> & { id: string }) | null => {
  const record = document?.[POSITION_FIELD_BY_TYPE[elementType]];
  if (!record || typeof record !== 'object') return null;
  return (
    Object.values(record as Record<string, unknown>)
      .flat()
      .find(
        (position): position is Record<string, unknown> & { id: string } =>
          typeof position === 'object' &&
          position !== null &&
          (position as { id?: unknown }).id === id,
      ) ?? null
  );
};

// 단건 property의 즉시 반영 투영. 도킹·분리, 단건·다건 네 경로가 같은 걸 쓴다
const elementPropertyIntents = (
  targets: readonly { elementType: NativeElementType; id: string }[],
  patch: EditorElementPropertyPatchV1,
): PropertyIntents => {
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  // 굵기 변경은 백엔드와 같은 암묵 Bold 고정을, 이미지 변환 leaf는 현재 변환에
  // 적용한 결과를 투영한다 (둘 다 현재 위치가 필요)
  const isImageTransformPatch =
    patch.property === 'idleImageTransform' ||
    patch.property === 'activeImageTransform';
  const document =
    patch.property === 'fontWeight' || isImageTransformPatch
      ? (captureEditorDocument() as unknown as Record<string, unknown> | null)
      : null;
  for (const { elementType, id } of targets) {
    // nullable leaf의 null은 위치 조각에서 undefined로, 나머지는 1:1 투영
    const byId = intents.get(elementType) ?? new Map();
    const intent: Record<string, unknown> = {
      [patch.property]: patch.value ?? undefined,
    };
    if (patch.property === 'fontWeight') {
      const current = findCurrentPosition(document, elementType, id);
      if (current && current.fontBold == null) {
        intent.fontBold = implicitElementFontBold(current.fontWeight);
      }
    } else if (isImageTransformPatch && patch.value !== null) {
      const current = findCurrentPosition(document, elementType, id);
      intent[patch.property] = applyImageTransformLeaf(
        current?.[patch.property] as ImageTransform | undefined,
        patch.value,
      );
    }
    byId.set(id, intent);
    intents.set(elementType, byId);
  }
  return intents;
};

// 빈 목록·비 native id·중복 id는 커밋 대상이 아니다
const hasCommittableTargets = (targets: readonly { id: string }[]): boolean =>
  targets.length > 0 &&
  targets.every(({ id }) => isNativeElementId(id)) &&
  new Set(targets.map(({ id }) => id)).size === targets.length;

const applyElementPropertyEagerly = (
  type: NativeElementType,
  id: string,
  patch: EditorElementPropertyPatchV1,
): ElementIntentReceipt | null =>
  applyPropertyIntentsEagerly(
    elementPropertyIntents([{ elementType: type, id }], patch),
  );

export const patchElementPropertyById = (
  type: NativeElementType,
  id: string,
  patch: EditorElementPropertyPatchV1,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  if (!isNativeElementId(id)) return Promise.resolve(false);
  const receipt = applyElementPropertyEagerly(type, id, patch);
  let enrolled = false;
  return commitSemanticOps(
    [{ kind: 'patchElement', elementType: type, id, patch }],
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => outcome.opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

interface ElementPropertyTarget {
  elementType: NativeElementType;
  id: string;
}

export interface PropertyCommitOptions {
  gestureId?: string;
  preflight?: () => void;
}

// 공용 다건 경로: 빈 목록·비 native id·중복 id를 거르고 같은 property patch를
// 전 대상에 eager+wire로 커밋한다. 속성별 기계적 래퍼는 전부 여기로 위임하고
// value 타입은 판별 유니온 patch가 컴파일 타임에 강제한다
export const patchElementPropertyByTargets = (
  targets: readonly ElementPropertyTarget[],
  patch: EditorElementPropertyPatchV1,
  options: PropertyCommitOptions = {},
): Promise<boolean> => {
  if (!hasCommittableTargets(targets)) return Promise.resolve(false);
  const receipt = applyPropertyIntentsEagerly(
    elementPropertyIntents(targets, patch),
  );
  let enrolled = false;
  return commitSemanticOps(
    targets.map(({ elementType, id }) => ({
      kind: 'patchElement' as const,
      elementType,
      id,
      patch,
    })),
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      preflight: options.preflight,
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) =>
      outcome.opResults.some((result) => result.status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const idTargets = (
  elementType: NativeElementType,
  ids: readonly string[],
): ElementPropertyTarget[] => ids.map((id) => ({ elementType, id }));

export const patchElementHiddenById = (
  type: NativeElementType,
  id: string,
  hidden: boolean,
  options: { preflight?: () => void } = {},
): Promise<boolean> =>
  patchElementPropertyById(
    type,
    id,
    { property: 'hidden', value: hidden },
    options,
  );
