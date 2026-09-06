import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanonicalEditorDocumentV1,
  EditorCommitRequest,
  EditorCommitResult,
} from '@src/types/editor';
import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import type { SelectionRotationFrame } from './selectionRotationGesture';

const transport = vi.hoisted(() => {
  let resolveCommit!: (result: EditorCommitResult) => void;
  return {
    get: vi.fn(),
    commit: vi.fn(
      (_request: EditorCommitRequest) =>
        new Promise<EditorCommitResult>((resolve) => {
          resolveCommit = resolve;
        }),
    ),
    onCommitted: vi.fn(() =>
      Object.assign(() => {}, { ready: Promise.resolve() }),
    ),
    resolve: (result: EditorCommitResult) => resolveCommit(result),
    subscribe: vi.fn(async () => 1),
    publish: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
  };
});

vi.mock('@api/modules/editorApi', () => ({ editorApi: transport }));
vi.mock('@api/modules/previewApi', () => ({ previewApi: transport }));

const MODE = '4key';
const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
];
const TARGETS = IDS.map((id) => ({ type: 'key' as const, id }));
const initialDocument = (): CanonicalEditorDocumentV1 => ({
  schemaVersion: 1,
  keys: { [MODE]: ['A', 'B'] },
  keyPositions: {
    [MODE]: [
      { ...createDefaultKeyPosition(0, 0), id: IDS[0], rotation: 0 },
      { ...createDefaultKeyPosition(150, 40), id: IDS[1], rotation: 30 },
    ],
  },
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: {},
  layerGroups: {},
});
const loadHarness = async () => {
  const [state, gesture, preview, geometry, session, keys, selection] =
    await Promise.all([
      import('@src/renderer/editor/runtime/editorStateCoordinator'),
      import('@src/renderer/editor/runtime/editGestureController'),
      import('@src/renderer/editor/runtime/previewOverlay'),
      import('@utils/core/selectionRotation'),
      import('./selectionRotationGesture'),
      import('@stores/data/useKeyStore'),
      import('@stores/grid/useGridSelectionStore'),
    ]);
  return {
    ...state,
    ...gesture,
    ...preview,
    ...geometry,
    ...session,
    ...keys,
    ...selection,
  };
};
type Harness = Awaited<ReturnType<typeof loadHarness>>;
let harness: Harness;

const displayedDocument = (): CanonicalEditorDocumentV1 => {
  const document = harness.captureEditorDocument();
  return {
    ...document,
    keyPositions: harness.composePreviewPositions(
      'keyPosition',
      document.keyPositions,
    ),
  };
};
const frame = (
  rotation = 0,
  bounds?: SelectionRotationFrame['bounds'],
): SelectionRotationFrame => {
  const snapshot = harness.createSelectionRotationSnapshot(
    displayedDocument(),
    TARGETS,
    MODE,
  )!;
  return {
    snapshot,
    rotation,
    bounds: bounds ?? snapshot.bounds,
    selectionKey: 'same-selection',
  };
};
const requestAt = async (count: number) => {
  await vi.waitFor(() => expect(transport.commit).toHaveBeenCalledTimes(count));
  return transport.commit.mock.calls[count - 1][0];
};

describe('선택 회전 입력 전환', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    window.__dmn_window_type = 'main';
    transport.get.mockResolvedValue({
      revision: 0,
      document: initialDocument(),
    });
    harness = await loadHarness();
    harness.useKeyStore.setState({ selectedKeyType: MODE });
    harness.useGridSelectionStore.setState({ selectedElements: TARGETS });
    await harness.editorCoordinator.start();
  });

  afterEach(() => {
    harness.editGestureController.cancel();
    harness.editorCoordinator.stop();
    harness.previewOverlay.clearAll();
    vi.restoreAllMocks();
    delete window.__dmn_window_type;
  });

  it('숫자 blur 직후 잡은 손잡이는 화면 기하를 기다렸다가 이어서 회전한다', async () => {
    const initial = frame();
    const numeric = harness.createSelectionRotationGesture(initial)!;
    expect(numeric.preview(45)).toBe(true);
    const shown = frame(45, initial.bounds);
    const shownDocument = structuredClone(displayedDocument());

    // blur와 pointerdown은 같은 이벤트에서 실행되고 커밋 큐는 다음 microtask부터 시작
    numeric.commit(45);
    const canvas = harness.createSelectionRotationGesture(shown)!;
    expect(harness.captureEditorDocument()).not.toEqual(shownDocument);
    expect(canvas.preview(60)).toBe(false);
    expect(harness.editGestureController.activeGestureId()).toBeNull();

    await requestAt(1);
    expect(harness.captureEditorDocument()).toEqual(shownDocument);
    expect(canvas.preview(60)).toBe(true);
    const expected = structuredClone(displayedDocument());
    const secondGestureId = harness.editGestureController.activeGestureId();
    canvas.commit(60);

    transport.resolve({ revision: 1, changedFields: ['keyPositions'] });
    const secondRequest = await requestAt(2);
    expect(secondRequest.gestureId).toBe(secondGestureId);
    expect(secondRequest.changes!.keyPositions).toEqual(expected.keyPositions);
    expect(
      secondRequest.changes!.keyPositions![MODE].map(
        ({ rotation }) => rotation,
      ),
    ).toEqual([60, 90]);
    transport.resolve({ revision: 2, changedFields: ['keyPositions'] });
    await vi.waitFor(() =>
      expect(harness.editorCoordinator.getState()).toMatchObject({
        revision: 2,
        phase: 'idle',
      }),
    );
    expect(harness.captureEditorDocument()).toEqual(expected);
  });

  it('화면을 그린 뒤 외부 기하가 바뀌면 오래된 틀로 새 회전을 시작하지 않는다', () => {
    const shown = frame();
    const document = structuredClone(harness.captureEditorDocument());
    document.keyPositions[MODE][0].dx += 20;
    harness.useKeyStore.setState({ canonicalPositions: document.keyPositions });
    const session = harness.createSelectionRotationGesture(shown)!;
    expect(session.preview(45)).toBe(false);
    session.commit(45);
    expect(harness.editGestureController.activeGestureId()).toBeNull();
    expect(transport.commit).not.toHaveBeenCalled();
    expect(harness.captureEditorDocument()).toEqual(document);
  });

  it('선택 변경으로 취소된 세션의 늦은 move와 up은 다시 저장하지 않는다', () => {
    const initial = structuredClone(harness.captureEditorDocument());
    const session = harness.createSelectionRotationGesture(frame())!;
    expect(session.preview(30)).toBe(true);
    harness.useGridSelectionStore.setState({ selectedElements: [TARGETS[0]] });
    expect(session.preview(60)).toBe(false);
    session.commit(60);
    expect(transport.commit).not.toHaveBeenCalled();
    expect(harness.captureEditorDocument()).toEqual(initial);
    expect(displayedDocument()).toEqual(initial);
  });
});
