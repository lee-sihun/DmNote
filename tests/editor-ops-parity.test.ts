import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EDITOR_OPS_VERSION } from '../src/types/editor';
import {
  createEditorCoordinator,
  getChangedEditorFields,
} from '../src/renderer/editor/runtime/editorCoordinator';

import type {
  CanonicalEditorDocumentV1,
  EditorCommitRequest,
  EditorCommitResult,
  EditorGetResult,
  EditorOpResultV1,
  EditorOpV1,
} from '../src/types/editor';
import type { EditorCoordinatorTransport } from '../src/renderer/editor/runtime/editorCoordinator';

// Rust 테스트(src-tauri/src/state/editor_ops_parity.rs)와 같은 fixture를
// 공유해 "같은 op 시퀀스 -> 같은 문서" 결과 동등성을 양 구현에 고정한다.
// 여기서는 낙관 적용기(applySemanticOps)를 공개 표면인
// commitSemanticOpsInternal로 구동해 소비한다
const FIXTURE_PATH = join(__dirname, 'fixtures', 'editor-ops-parity.json');

interface OpsParityCase {
  name: string;
  comment?: string;
  initialDocument: CanonicalEditorDocumentV1;
  ops: EditorOpV1[];
  expectedDocument: CanonicalEditorDocumentV1;
}

interface OpsParityFixture {
  version: number;
  comment?: string;
  cases: OpsParityCase[];
}

const fixture = (): OpsParityFixture =>
  JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as OpsParityFixture;

// EditorOpV1 전체 kind 목록 - satisfies 검사가 유니온 변경을 컴파일 오류로
// 잡으므로 신규 op 추가 시 이 목록과 fixture 케이스를 함께 늘려야 한다
const ALL_OP_KINDS = {
  setBounds: true,
  resizeSprite: true,
  deleteElement: true,
  insertFrozenElements: true,
  reorderElements: true,
  setElementGroups: true,
  renameLayerGroup: true,
  patchElement: true,
  setKeySlot: true,
} satisfies Record<EditorOpV1['kind'], true>;

// 낙관 적용이 끝난 로컬 문서를 그대로 승인하는 echo 백엔드. 커밋 결과가
// 프론트 projection과 항상 일치하므로 outcome.document는 순수한
// applySemanticOps(base, ops) 산출물이 된다
const createParityHarness = (initial: CanonicalEditorDocumentV1) => {
  let local = structuredClone(initial);
  const canonical = { revision: 0, document: structuredClone(initial) };

  const transport: EditorCoordinatorTransport = {
    get(): Promise<EditorGetResult> {
      return Promise.resolve(structuredClone(canonical));
    },
    commit(request: EditorCommitRequest): Promise<EditorCommitResult> {
      const next = structuredClone(local);
      const changedFields = getChangedEditorFields(canonical.document, next);
      if (changedFields.length > 0) canonical.revision += 1;
      canonical.document = next;
      const status: EditorOpResultV1['status'] =
        changedFields.length > 0 ? 'applied' : 'noChange';
      return Promise.resolve({
        revision: canonical.revision,
        changedFields,
        opResults: (request.ops ?? []).map(
          (op): EditorOpResultV1 =>
            op.kind === 'setBounds' || op.kind === 'resizeSprite'
              ? { status, bounds: op.bounds }
              : { status },
        ),
      });
    },
    onCommitted() {
      return Object.assign(() => undefined, { ready: Promise.resolve() });
    },
  };

  let mutationSequence = 0;
  const coordinator = createEditorCoordinator({
    transport,
    readDocument: () => structuredClone(local),
    applyDocument: (document) => {
      local = structuredClone(document);
    },
    createMutationId: () =>
      `00000000-0000-4000-8000-${String(++mutationSequence).padStart(12, '0')}`,
    focusTarget: null,
    visibilityTarget: null,
  });

  return { coordinator, getLocal: () => structuredClone(local) };
};

describe('editor ops result parity', () => {
  it('fixture 버전은 ops wire 버전과 일치한다', () => {
    expect(fixture().version).toBe(EDITOR_OPS_VERSION);
    expect(fixture().cases.length).toBeGreaterThan(0);
  });

  it('fixture 케이스가 모든 op kind를 빠짐없이 사용한다', () => {
    const seenKinds = new Set(
      fixture().cases.flatMap((parityCase) =>
        parityCase.ops.map((op) => op.kind),
      ),
    );
    expect([...seenKinds].sort()).toEqual(Object.keys(ALL_OP_KINDS).sort());
  });

  for (const parityCase of fixture().cases) {
    it(`${parityCase.name}: 같은 op 시퀀스가 같은 문서를 만든다`, async () => {
      const harness = createParityHarness(parityCase.initialDocument);
      const outcome = await harness.coordinator.commitSemanticOpsInternal(
        parityCase.ops,
      );
      // 승인 반영 문서와 낙관 적용된 스토어 문서 모두 공유 기대와 일치
      expect(outcome.document).toEqual(parityCase.expectedDocument);
      expect(harness.getLocal()).toEqual(parityCase.expectedDocument);
    });
  }
});
