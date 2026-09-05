import { isNativeElementId } from '../model/elementId';
import type { NativeElementType } from '../model/elementIdMap';
import {
  applyPropertyIntentsEagerly,
  type PropertyIntents,
} from './elementIntent';
import {
  commitGeneratedSemanticOps,
  commitSemanticOps,
} from './editorSemanticOps';
import { captureEditorDocument } from './editorStateCoordinator';
import {
  computeBatchGeometryPlan,
  type BatchGeometryOperation,
} from './batchGeometryPlan';
import type {
  CanonicalEditorDocumentV1,
  EditorBoundsV1,
  EditorOpV1,
} from '@src/types/editor';
import {
  FIELD_BY_TYPE,
  findInRecord,
  type LooseRecord,
} from './elementDocumentModel';

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
    ops: plan.bounds.flatMap(({ key, bounds }) => {
      const target = targetById.get(key);
      return target
        ? [
            {
              kind: 'setBounds' as const,
              elementType: target.type,
              id: target.id,
              bounds,
            },
          ]
        : [];
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
  const intents = new Map<
    NativeElementType,
    Map<string, Record<string, unknown>>
  >();
  const targetById = new Map(
    frozenDescriptor.targets.map((target) => [target.id, target] as const),
  );
  for (const { key, patch } of initialPlan.updates) {
    const target = targetById.get(key);
    if (!target) continue;
    const byId = intents.get(target.type) ?? new Map();
    byId.set(target.id, patch as Record<string, unknown>);
    intents.set(target.type, byId);
  }
  const receipt =
    intents.size > 0 ? applyPropertyIntentsEagerly(intents) : null;
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
      ops.push({
        kind: 'setBounds',
        elementType,
        id,
        bounds: {
          dx: patch.dx,
          dy: patch.dy,
          width: patch.width,
          height: patch.height,
        },
      });
    }
  }
  if (ops.length === 0) return Promise.resolve(false);

  const receipt = applyPropertyIntentsEagerly(intents);
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
  const receipt = applyPropertyIntentsEagerly(intents);
  let enrolled = false;

  return commitSemanticOps(
    [{ kind: 'setBounds', elementType: type, id, bounds }],
    {
      ...(gestureId ? { gestureId } : {}),
      onEnrolled: () => {
        enrolled = true;
      },
    },
  )
    .then(({ opResults }) => opResults[0]?.status !== 'targetMissing')
    .catch((error) => {
      if (!enrolled) receipt?.rollback();
      throw error;
    });
};
