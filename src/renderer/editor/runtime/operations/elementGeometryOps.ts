import { useSpriteStore } from '@stores/data/useSpriteStore';
import { spriteResizePatch } from '@utils/sprite/resizeProjection';
import { isNativeElementId } from '../../model/elementId';
import type { NativeElementType } from '../../model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  type ElementIntentReceipt,
  type PropertyIntents,
} from '../intent/elementIntent';
import {
  commitGeneratedSemanticOps,
  commitSemanticOps,
} from './editorSemanticOps';
import { captureEditorDocument } from '../coordinator/editorStateCoordinator';
import {
  computeBatchGeometryPlan,
  type BatchGeometryOperation,
} from '../geometry/batchGeometryPlan';
import type {
  CanonicalEditorDocumentV1,
  EditorBoundsV1,
  EditorOpV1,
} from '@src/types/editor';
import {
  FIELD_BY_TYPE,
  findInRecord,
  type LooseRecord,
} from '../intent/elementDocumentModel';

// 다중 선택 정산: 대상 id들의 현재 canonical 기하(dx·dy)를 의도로 캡처해
// 슬롯 안에서 id 재해석으로 적용한다. 4컬렉션 full-record 캡처는 배타
// mutation(카운터 프리셋 삭제 등)의 IPC 창과 겹치면 직렬화 때문에 그 직후에
// 확정적으로 착지해 무관 필드 재작성을 되돌린다 - 기하만 실어 그 결합을 끊는다
export type GeometryField = 'dx' | 'dy' | 'width' | 'height';
type GeometryPatch = Partial<Record<GeometryField, number>>;

export interface BatchGeometryTarget {
  type: NativeElementType;
  id: string;
}

export interface BatchGeometryDescriptor {
  mode: string;
  targets: readonly BatchGeometryTarget[];
  operation: BatchGeometryOperation;
}

const readBatchGeometryElements = (
  base: CanonicalEditorDocumentV1,
  descriptor: BatchGeometryDescriptor,
) => {
  const seen = new Set<string>();
  const elements: Array<{
    key: string;
    type: NativeElementType;
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  for (const target of descriptor.targets) {
    if (!isNativeElementId(target.id) || seen.has(target.id)) return null;
    seen.add(target.id);
    const record = base[FIELD_BY_TYPE[target.type]] as unknown as LooseRecord;
    const locator = findInRecord(record, target.id);
    if (!locator || locator.mode !== descriptor.mode) return null;
    const position = record[locator.mode]?.[locator.index];
    if (
      !position ||
      typeof position.dx !== 'number' ||
      typeof position.dy !== 'number' ||
      typeof position.width !== 'number' ||
      typeof position.height !== 'number'
    ) {
      return null;
    }
    elements.push({
      key: target.id,
      type: target.type,
      id: target.id,
      x: position.dx,
      y: position.dy,
      width: position.width,
      height: position.height,
    });
  }
  return elements;
};

// bounds 정산 op - 스프라이트는 bounds와 콘텐츠 스케일을 한 몸으로 갖는
// resizeSprite, 나머지는 setBounds
export const elementBoundsOp = (
  elementType: NativeElementType,
  id: string,
  bounds: EditorBoundsV1,
): EditorOpV1 =>
  elementType === 'sprite'
    ? { kind: 'resizeSprite', id, bounds }
    : { kind: 'setBounds', elementType, id, bounds };

// 스프라이트 리사이즈 eager intent - 로컬 스토어의 현재 콘텐츠를 projection
// 으로 스케일해 bounds와 함께 싣는다. 백엔드는 최신 base에 같은 수학을
// 재적용한다 (resizeProjection 하나가 양측 계약 소유). 로컬에 없으면 eager
// 적용 대상도 없으므로 bounds만 남긴다
const spriteResizeEagerIntent = (
  id: string,
  bounds: EditorBoundsV1,
): Record<string, unknown> => {
  const record = useSpriteStore.getState().positions ?? {};
  for (const positions of Object.values(record)) {
    const current = positions?.find((position) => position.id === id);
    if (current) {
      return spriteResizePatch(current, bounds);
    }
  }
  return { ...bounds };
};

// bounds intent 맵 조립 - 이동 계열은 부분 patch, 스프라이트는 full bounds를
// 실어야 eager 적용이 콘텐츠 스케일까지 소유한다. 단일 배치와 혼합 배치가
// 같은 규칙을 쓰되 스프라이트 bounds를 찾는 키(계획 key vs op id)만 다르다
export const buildNativeBoundsIntents = <
  TTarget extends { id: string; type: NativeElementType },
>(
  updates: readonly { key: string; patch: Record<string, unknown> }[],
  targetForKey: (key: string) => TTarget | undefined,
  spriteBoundsFor: (target: TTarget, key: string) => EditorBoundsV1 | undefined,
): PropertyIntents => {
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  for (const { key, patch } of updates) {
    const target = targetForKey(key);
    if (!target) continue;
    const byId = intents.get(target.type) ?? new Map();
    const spriteBounds =
      target.type === 'sprite' ? spriteBoundsFor(target, key) : undefined;
    byId.set(
      target.id,
      (spriteBounds ? { ...spriteBounds } : patch) as Record<string, unknown>,
    );
    intents.set(target.type, byId);
  }
  return intents;
};

// bounds intent의 eager 적용 - 스프라이트 항목은 projection 결과(콘텐츠
// 포함)로 치환해 receipt가 스케일 필드까지 소유하게 한다
export const applyBoundsIntentsEagerly = (
  intents: PropertyIntents,
): ElementIntentReceipt | null => {
  let eagerIntents = intents;
  const spriteIntents = intents.get('sprite');
  if (spriteIntents && spriteIntents.size > 0) {
    const projectedById = new Map<string, Record<string, unknown>>();
    for (const [id, patch] of spriteIntents) {
      const bounds = patch as unknown as EditorBoundsV1;
      projectedById.set(id, spriteResizeEagerIntent(id, bounds));
    }
    const next = new Map(intents);
    next.set('sprite', projectedById);
    eagerIntents = next;
  }
  return applyPropertyIntentsEagerly(eagerIntents);
};

const planBatchGeometry = (
  base: CanonicalEditorDocumentV1,
  descriptor: BatchGeometryDescriptor,
) => {
  const elements = readBatchGeometryElements(base, descriptor);
  if (!elements) return null;
  const plan = computeBatchGeometryPlan(elements, descriptor.operation);
  if (!plan) return null;
  const targetById = new Map(
    elements.map((element) => [element.id, element] as const),
  );
  return {
    ...plan,
    // 스프라이트는 배치에서도 resizeSprite - 치수가 변하는 연산(resize)은
    // 콘텐츠가 함께 스케일되고, 이동 계열은 배율 1이라 setBounds와 동일
    ops: plan.bounds.flatMap(({ key, bounds }) => {
      const target = targetById.get(key);
      return target ? [elementBoundsOp(target.type, target.id, bounds)] : [];
    }),
  };
};

export const commitBatchGeometryByIds = (
  descriptor: BatchGeometryDescriptor,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  const frozenDescriptor = structuredClone(descriptor);
  const initialPlan = planBatchGeometry(
    captureEditorDocument(),
    frozenDescriptor,
  );
  if (!initialPlan || initialPlan.updates.length === 0) {
    return Promise.resolve(false);
  }
  const targetById = new Map(
    frozenDescriptor.targets.map((target) => [target.id, target] as const),
  );
  const fullBoundsByKey = new Map(
    initialPlan.bounds.map(({ key, bounds }) => [key, bounds] as const),
  );
  const intents = buildNativeBoundsIntents(
    initialPlan.updates,
    (key) => targetById.get(key),
    (_target, key) => fullBoundsByKey.get(key),
  );
  const receipt = intents.size > 0 ? applyBoundsIntentsEagerly(intents) : null;
  let enrolled = false;
  return commitGeneratedSemanticOps(
    (base) => planBatchGeometry(base, frozenDescriptor)?.ops ?? null,
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      ...(options.preflight ? { preflight: options.preflight } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => {
      if (!outcome) {
        if (!enrolled) receipt?.rollback();
        return false;
      }
      return outcome.opResults.every(
        ({ status }) => status !== 'targetMissing',
      );
    })
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const commitElementGeometryById = (
  type: NativeElementType,
  id: string,
  patch: GeometryPatch,
  options: { gestureId?: string; preflight?: () => void } = {},
): Promise<boolean> => {
  const entries = Object.entries(patch) as Array<[GeometryField, number]>;
  if (
    !isNativeElementId(id) ||
    entries.length === 0 ||
    entries.some(
      ([field, value]) =>
        !['dx', 'dy', 'width', 'height'].includes(field) ||
        !Number.isFinite(value) ||
        ((field === 'width' || field === 'height') && value <= 0),
    )
  ) {
    return Promise.resolve(false);
  }

  const frozenPatch = Object.fromEntries(entries) as GeometryPatch;
  const intents: PropertyIntents = new Map([
    [type, new Map([[id, frozenPatch as Record<string, unknown>]])],
  ]);
  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;

  return commitGeneratedSemanticOps(
    (base) => {
      const record = base[FIELD_BY_TYPE[type]] as unknown as LooseRecord;
      const locator = findInRecord(record, id);
      if (!locator) return null;
      const position = record[locator.mode]?.[locator.index];
      if (!position) return null;
      const bounds: EditorBoundsV1 = {
        dx: position.dx as number,
        dy: position.dy as number,
        width: position.width as number,
        height: position.height as number,
        ...frozenPatch,
      };
      return [{ kind: 'setBounds', elementType: type, id, bounds }];
    },
    {
      ...(options.gestureId ? { gestureId: options.gestureId } : {}),
      ...(options.preflight ? { preflight: options.preflight } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then((outcome) => {
      if (!outcome) {
        if (!enrolled) receipt?.rollback();
        return false;
      }
      return outcome.opResults[0]?.status !== 'targetMissing';
    })
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

// 리사이즈 완료 전용: 시작 시 동결한 대상 id들에 최종 bounds를 하나의
// intent로 - eager와 wire, receipt를 같은 의도가 소유한다. 대상 소실은
// targetLost로 eager 복원, 오류는 전파
export const commitElementBoundsById = (
  intents: PropertyIntents,
  gestureId?: string,
): Promise<boolean> => {
  const ops: EditorOpV1[] = [];
  const boundsKeys = new Set(['dx', 'dy', 'width', 'height']);
  const seenIds = new Set<string>();
  for (const [elementType, byId] of intents) {
    for (const [id, patch] of byId) {
      if (
        !isNativeElementId(id) ||
        seenIds.has(id) ||
        Object.keys(patch).some((key) => !boundsKeys.has(key)) ||
        typeof patch.dx !== 'number' ||
        typeof patch.dy !== 'number' ||
        typeof patch.width !== 'number' ||
        typeof patch.height !== 'number' ||
        !Number.isFinite(patch.dx) ||
        !Number.isFinite(patch.dy) ||
        !Number.isFinite(patch.width) ||
        !Number.isFinite(patch.height) ||
        patch.width <= 0 ||
        patch.height <= 0
      ) {
        return Promise.resolve(false);
      }
      seenIds.add(id);
      ops.push(
        elementBoundsOp(elementType, id, {
          dx: patch.dx,
          dy: patch.dy,
          width: patch.width,
          height: patch.height,
        }),
      );
    }
  }
  if (ops.length === 0) return Promise.resolve(false);

  const receipt = applyBoundsIntentsEagerly(intents);
  let enrolled = false;
  return commitSemanticOps(ops, {
    ...(gestureId ? { gestureId } : {}),
    onEnrolled: () => {
      enrolled = true;
    },
  })
    .then(({ opResults }) =>
      opResults.some(({ status }) => status !== 'targetMissing'),
    )
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};

export const commitSingleElementBoundsById = (
  type: NativeElementType,
  id: string,
  bounds: EditorBoundsV1,
  gestureId?: string,
): Promise<boolean> => {
  if (
    !isNativeElementId(id) ||
    !Number.isFinite(bounds.dx) ||
    !Number.isFinite(bounds.dy) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return Promise.resolve(false);
  }
  const intents: PropertyIntents = new Map([
    [type, new Map([[id, { ...bounds }]])],
  ]);
  const receipt = applyBoundsIntentsEagerly(intents);
  let enrolled = false;

  return commitSemanticOps([elementBoundsOp(type, id, bounds)], {
    ...(gestureId ? { gestureId } : {}),
    onEnrolled: () => {
      enrolled = true;
    },
  })
    .then(({ opResults }) => opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};
