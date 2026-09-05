import { describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';

import {
  applyEditorPatch,
  createEditorCoordinator,
  getChangedEditorFields,
} from '../coordinator/editorCoordinator';
import { generatePropertyIntentPatch } from './elementIntent';

import type {
  EditorCommitRequest,
  EditorCommitResult,
  CanonicalEditorDocumentV1,
  EditorGetResult,
} from '@src/types/editor';
import type {
  EditorCoordinatorTransport,
  EditorReadyUnsubscribe,
} from '../coordinator/editorCoordinator';

const ID_K = '11111111-1111-4111-8111-111111111111';

const makeDocument = (): CanonicalEditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { '4key': ['A'] },
  keyPositions: { '4key': [{ ...createDefaultKeyPosition(), id: ID_K }] },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  layerGroups: {},
});

class FakeTransport implements EditorCoordinatorTransport {
  canonical: { revision: number; document: CanonicalEditorDocumentV1 };
  readonly commitMock =
    vi.fn<(request: EditorCommitRequest) => Promise<EditorCommitResult>>();

  constructor(document: CanonicalEditorDocumentV1) {
    this.canonical = { revision: 0, document: structuredClone(document) };
    this.commitMock.mockImplementation(async (request) => {
      if (!request.changes) {
        throw new Error('mixed commit harness accepts patch requests only');
      }
      const before = this.canonical.document;
      const next = applyEditorPatch(before, request.changes);
      const changedFields = getChangedEditorFields(before, next);
      if (changedFields.length > 0) this.canonical.revision += 1;
      this.canonical.document = next;
      return { revision: this.canonical.revision, changedFields };
    });
  }

  get(): Promise<EditorGetResult> {
    return Promise.resolve(structuredClone(this.canonical));
  }

  commit(request: EditorCommitRequest): Promise<EditorCommitResult> {
    return this.commitMock(request);
  }

  onCommitted(): EditorReadyUnsubscribe {
    return Object.assign(() => {}, { ready: Promise.resolve() });
  }
}

const createHarness = () => {
  const transport = new FakeTransport(makeDocument());
  let local = makeDocument();
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
  return { coordinator, transport };
};

describe('mixed commit in-slot regeneration', () => {
  it('슬롯 generator 재생성은 대기 중 정산된 격리 커밋을 되돌리지 않는다', async () => {
    const harness = createHarness();
    await harness.coordinator.start();

    // 격리 플러그인 쓰기가 큐에 먼저 - noteWidth=111 정산
    const isolated = harness.coordinator.commitIsolatedPluginPatch(
      {
        schemaVersion: 1,
        keyPositions: {
          '4key': [{ ...createDefaultKeyPosition(), id: ID_K, noteWidth: 111 }],
        },
      },
      { multiKey: false },
    );
    // 혼합 게스처 커밋이 뒤에 - 시작 동결 의도(id별 width=120)를 슬롯
    // 최신 base에 재적용하는 generator 전달
    const gesture = harness.coordinator.commitGesture(
      (base) =>
        generatePropertyIntentPatch(
          base,
          new Map([['key', new Map([[ID_K, { width: 120 }]])]]),
        ),
      'gesture-mixed',
      async (context) =>
        harness.transport.commit({
          baseRevision: context.editorBaseRevision,
          mutationId: context.mutationId,
          changes: context.editorChanges!,
        }),
    );

    await isolated;
    await gesture;

    const finalPosition =
      harness.transport.canonical.document.keyPositions['4key'][0];
    // 두 변경 모두 생존해야 한다
    expect(finalPosition.width).toBe(120);
    expect(finalPosition.noteWidth).toBe(111);
  });

  it('generator null은 editor 변경 없이 transaction callback을 실행한다', async () => {
    const harness = createHarness();
    await harness.coordinator.start();

    const commitCallback = vi.fn(async (context: { editorChanges?: unknown }) =>
      harness.transport.commit({
        baseRevision: 0,
        mutationId: 'm-plugin-only',
        changes: { schemaVersion: 1 as const },
        ...(context.editorChanges ? {} : {}),
      }),
    );
    let enrolled = false;
    await harness.coordinator.commitGesture(
      () => null,
      'gesture-null',
      commitCallback,
      {
        onEnrolled: () => {
          enrolled = true;
        },
      },
    );

    expect(commitCallback).toHaveBeenCalledTimes(1);
    expect(commitCallback.mock.calls[0][0].editorChanges).toBeUndefined();
    expect(enrolled).toBe(true);
    // 문서는 변하지 않는다
    expect(
      harness.transport.canonical.document.keyPositions['4key'][0].noteWidth,
    ).toBeUndefined();
  });
});
