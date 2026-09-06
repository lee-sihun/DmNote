import { stableStringify } from '@utils/core/stableStringify';
import { SEMANTIC_POSITION_FIELDS } from '../projection/semanticOpsProjection';
import {
  EDITOR_FIELDS,
  EDITOR_SCHEMA_VERSION,
  assertCanonicalEditorDocument,
  assertEditorDocument,
  assertEditorPatch,
} from '@src/types/editor';

import type {
  CanonicalEditorDocumentV1,
  EditorDocumentV1,
  EditorElementTypeV1,
  EditorEventPatchV1,
  EditorField,
  EditorLegacyPatchV1,
  EditorOpV1,
  EditorPatchV1,
} from '@src/types/editor';

export const clone = <T>(value: T): T => structuredClone(value);

export const fieldsOverlap = (
  first: readonly EditorField[],
  second: readonly EditorField[],
): EditorField[] => {
  const secondSet = new Set(second);
  return first.filter((field) => secondSet.has(field));
};

export const unresolvedLocalFields = (
  localFields: readonly EditorField[],
  pendingLocal: CanonicalEditorDocumentV1,
  canonical: CanonicalEditorDocumentV1,
): EditorField[] =>
  localFields.filter(
    (field) =>
      stableStringify(pendingLocal[field]) !==
      stableStringify(canonical[field]),
  );

// wire 버전은 전송 경로가 결정한다. 호출부 패치의 schemaVersion은 문서 적용
// 과정에서 소비되어 여기까지 오지 않으므로, 자사 전송 지점만 v2를 명시한다
export const patchForFields = (
  document: EditorDocumentV1,
  fields: readonly EditorField[],
  schemaVersion: EditorPatchV1['schemaVersion'] = EDITOR_SCHEMA_VERSION,
): EditorPatchV1 => {
  const patch: EditorPatchV1 = { schemaVersion };
  fields.forEach((field) => {
    Object.assign(patch, { [field]: clone(document[field]) });
  });
  return patch;
};

// 위치 필드에서 id로 요소 항목 탐색
const findPositionEntryById = (
  document: CanonicalEditorDocumentV1,
  elementType: EditorElementTypeV1,
  id: string,
): Record<string, unknown> | null => {
  const record = document[SEMANTIC_POSITION_FIELDS[elementType]] as Record<
    string,
    Array<Record<string, unknown> & { id: string }>
  >;
  for (const positions of Object.values(record)) {
    const match = positions.find((position) => position.id === id);
    if (match) return match;
  }
  return null;
};

// CAS 판정을 건너뛰는 op 표식
const FROZEN_OP_CAS_EXEMPT = Symbol('frozenOpCasExempt');

// 동결 op가 낙관 재적용에서 되쓰는 대상 조각. setBounds는 기하 필드만,
// patchElement는 대상 항목, setKeySlot은 결합 인덱스의 슬롯. 값 되돌림
// 위험이 없는 구조 op(삽입·삭제·정렬 등)는 CAS 비대상으로 항상 재적용
const frozenOpCasUnit = (
  document: CanonicalEditorDocumentV1,
  op: EditorOpV1,
): unknown => {
  if (op.kind === 'setBounds') {
    const entry = findPositionEntryById(document, op.elementType, op.id);
    if (!entry) return null;
    return {
      dx: entry.dx,
      dy: entry.dy,
      width: entry.width,
      height: entry.height,
    };
  }
  if (op.kind === 'resizeSprite') {
    const entry = findPositionEntryById(document, 'sprite', op.id);
    if (!entry) return null;
    // resize가 소유하는 조각 전체 - bounds와 스케일 대상 콘텐츠
    return {
      dx: entry.dx,
      dy: entry.dy,
      width: entry.width,
      height: entry.height,
      idleTransform: entry.idleTransform,
      poses: entry.poses,
    };
  }
  if (op.kind === 'patchElement') {
    return findPositionEntryById(document, op.elementType, op.id);
  }
  if (op.kind === 'setKeySlot') {
    for (const [mode, positions] of Object.entries(document.keyPositions)) {
      const index = positions.findIndex((position) => position.id === op.id);
      if (index < 0) continue;
      return document.keys[mode]?.[index] ?? null;
    }
    return null;
  }
  return FROZEN_OP_CAS_EXEMPT;
};

// 동결 op 재적용 소유 판정: 동결 시점 base와 현재 스토어의 대상 조각이
// 같을 때만 재적용. 다르면 슬롯 대기 중의 2차 편집이 소유한 값이라 보존
export const canReapplyFrozenOp = (
  op: EditorOpV1,
  base: CanonicalEditorDocumentV1,
  current: CanonicalEditorDocumentV1,
): boolean => {
  const baseUnit = frozenOpCasUnit(base, op);
  if (baseUnit === FROZEN_OP_CAS_EXEMPT) return true;
  const currentUnit = frozenOpCasUnit(current, op);
  return stableStringify(currentUnit) === stableStringify(baseUnit);
};

// patch 재적용은 필드 통째 교체라 필드 단위 CAS: 현재 스토어 필드가 동결
// 시점 base와 같을 때만(소유 증명) 동결 필드를 되쓴다. 다르면 슬롯 대기
// 중의 2차 편집이 소유한 필드라 보존. wire 커밋 내용에는 영향 없음
export const frozenPatchOwnedFields = (
  changes: EditorPatchV1,
  base: CanonicalEditorDocumentV1,
  current: CanonicalEditorDocumentV1,
): EditorPatchV1 => {
  const owned: EditorPatchV1 = { schemaVersion: changes.schemaVersion };
  EDITOR_FIELDS.forEach((field) => {
    if (changes[field] === undefined) return;
    if (stableStringify(current[field]) !== stableStringify(base[field])) {
      return;
    }
    Object.assign(owned, { [field]: changes[field] });
  });
  return owned;
};

export function getChangedEditorFields(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
  // 플러그인 격리 커밋의 next는 poseId 미발급 상태일 수 있어 방향을 받는다
  nextSpriteMode: 'canonical' | 'input' = 'canonical',
): EditorField[] {
  assertEditorDocument(base, 'base editor document');
  assertEditorDocument(next, 'next editor document', nextSpriteMode);

  return EDITOR_FIELDS.filter(
    (field) => stableStringify(base[field]) !== stableStringify(next[field]),
  );
}

// 버전 인자 없이 patchForFields를 부르므로 항상 v1이다. 이벤트 patch 타입과
// 맞도록 반환도 이벤트 patch로 좁힌다
export function createEditorPatch(
  base: EditorDocumentV1,
  next: EditorDocumentV1,
): EditorEventPatchV1 {
  return patchForFields(
    next,
    getChangedEditorFields(base, next),
  ) as EditorEventPatchV1;
}

export function applyEditorPatch(
  base: CanonicalEditorDocumentV1,
  patch: EditorPatchV1,
): CanonicalEditorDocumentV1 {
  assertCanonicalEditorDocument(base, 'base editor document');
  assertEditorPatch(patch);

  const next = clone(base);
  EDITOR_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      Object.assign(next, { [field]: clone(patch[field]) });
    }
  });
  assertCanonicalEditorDocument(next, 'patched editor document');
  return next;
}

export const applyIsolatedPluginPatch = (
  base: CanonicalEditorDocumentV1,
  patch: EditorPatchV1 | EditorLegacyPatchV1,
): EditorDocumentV1 => {
  assertCanonicalEditorDocument(base, 'isolated plugin base document');
  // 플러그인 patch는 input 방향 - poseId 생략(백엔드 발급)을 허용한다
  assertEditorPatch(patch, 'editor patch', 'input');
  const next: EditorDocumentV1 = clone(base);
  EDITOR_FIELDS.forEach((field) => {
    if (patch[field] !== undefined) {
      Object.assign(next, { [field]: clone(patch[field]) });
    }
  });
  assertEditorDocument(next, 'isolated plugin target document', 'input');
  return next;
};

export const rebaseEditorDocument = (
  canonical: CanonicalEditorDocumentV1,
  pendingLocal: CanonicalEditorDocumentV1,
  localFields: readonly EditorField[],
): CanonicalEditorDocumentV1 =>
  applyEditorPatch(canonical, patchForFields(pendingLocal, localFields));
