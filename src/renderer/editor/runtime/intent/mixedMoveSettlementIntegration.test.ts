import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDITOR_OPS_VERSION } from '@src/types/editor';
import type { EditorDocumentV1, EditorOpV1 } from '@src/types/editor';

// gestureApi 내부 타입이라 테스트에서 필요한 형태만 좁게 선언한다
type GestureCommitRequest = {
  gestureId?: string;
  editorOpsVersion?: number;
  editorOps?: EditorOpV1[];
  editorChanges?: unknown;
  pluginChanges?: Array<{ pluginId: string }>;
};
type GestureCommitResult = Record<string, unknown>;

// IPC 경계만 대역으로 세우고 generator·러너·transaction·coordinator는 실제
// 배선을 그대로 태운다. 러너를 mock하는 단위 테스트가 못 잡는 배선 파손을
// 여기서 잡는다
const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  previewCancel: vi.fn(async () => {}),
  previewPublish: vi.fn(async () => {}),
  previewSubscribe: vi.fn(async () => 1),
  onCommitted: vi.fn(() =>
    Object.assign(() => {}, { ready: Promise.resolve() }),
  ),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: runtime.invoke }));

vi.mock('@api/modules/editor/previewApi', () => ({
  previewApi: {
    cancel: runtime.previewCancel,
    publish: runtime.previewPublish,
    subscribe: runtime.previewSubscribe,
  },
}));

vi.mock('@api/modules/editor/editorApi', () => ({
  editorApi: {
    get: async () => ({ revision: 0, document: makeDocument() }),
    commit: async () => {
      throw new Error('editor_commit should not be used by the mixed path');
    },
    onCommitted: runtime.onCommitted,
  },
  editorCommitRaw: async () => {
    throw new Error('editorCommitRaw should not be used by the mixed path');
  },
}));

import { createDefaultKeyPosition } from '@src/renderer/editor/model/keys';
import { ElementIntentAbort } from './elementIntent';
import { usePluginDisplayElementStore } from '@stores/plugin/usePluginDisplayElementStore';

type Runtime = {
  generateGeometryIntentOps: typeof import('./elementIntent')['generateGeometryIntentOps'];
  runMixedGestureElementIntent: typeof import('./mixedElementIntent')['runMixedGestureElementIntent'];
  stop: () => void;
};

// coordinator는 stop 후 재사용 불가라 테스트마다 모듈을 새로 적재한다
const loadRuntime = async (): Promise<Runtime> => {
  vi.resetModules();
  const [intent, mixed, coordinator] = await Promise.all([
    import('./elementIntent'),
    import('./mixedElementIntent'),
    import('../coordinator/editorStateCoordinator'),
  ]);
  await coordinator.editorCoordinator.start();
  return {
    generateGeometryIntentOps: intent.generateGeometryIntentOps,
    runMixedGestureElementIntent: mixed.runMixedGestureElementIntent,
    stop: () => coordinator.editorCoordinator.stop(),
  };
};

const KEY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PLUGIN_ID = 'plugin-a';

function makeDocument(): EditorDocumentV1 {
  return {
    schemaVersion: 1,
    keys: { '4key': ['KeyA'] },
    keyPositions: {
      '4key': [{ ...createDefaultKeyPosition(0, 0), id: KEY_ID } as never],
    },
    statPositions: {},
    graphPositions: {},
    knobPositions: {},
    spritePositions: {},
    layerGroups: {},
  };
}

const commitResult = (withOps: boolean): GestureCommitResult =>
  ({
    editorRevision: 1,
    pluginModelRevision: 1,
    authorityGeneration: 0,
    changedFields: withOps ? ['keyPositions'] : [],
    changedPluginIds: [PLUGIN_ID],
    ...(withOps
      ? {
          editorOpResults: [
            {
              status: 'applied',
              bounds: { dx: 40, dy: 25, width: 60, height: 60 },
            },
          ],
        }
      : {}),
  } as unknown as GestureCommitResult);

describe('혼합 이동 정산 배선 통합', () => {
  beforeEach(async () => {
    runtime.invoke.mockReset();
    runtime.invoke.mockImplementation(
      async (command: string, args?: { request?: GestureCommitRequest }) => {
        if (command === 'commit_gesture') {
          return commitResult(Boolean(args?.request?.editorOps));
        }
        if (command === 'editor_get') {
          return { revision: 0, document: makeDocument() };
        }
        return undefined;
      },
    );
    usePluginDisplayElementStore.setState({
      elements: [
        {
          id: 'element',
          fullId: `${PLUGIN_ID}:element`,
          pluginId: PLUGIN_ID,
          definitionId: PLUGIN_ID,
          html: '<div />',
          position: { x: 30, y: 40 },
          tabId: '4key',
        } as never,
      ],
    });
  });

  afterEach(() => {
    active?.stop();
    active = null;
    vi.restoreAllMocks();
  });

  let active: Runtime | null = null;

  it('혼합 이동은 commit_gesture로 editorOps를 실어 보낸다', async () => {
    const intents = new Map([
      ['key' as const, new Map([[KEY_ID, { dx: 40, dy: 25 }]])],
    ]);

    active = await loadRuntime();
    const { generateGeometryIntentOps, runMixedGestureElementIntent } = active;

    await runMixedGestureElementIntent({
      gestureId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      initialPluginIds: [PLUGIN_ID],
      pluginScope: () => [PLUGIN_ID],
      receipt: null,
      generate: ({ base }) => ({
        kind: 'ops',
        ops: generateGeometryIntentOps(base, intents),
      }),
      skipContext: 'mixed selection settlement',
    });

    const gestureCalls = runtime.invoke.mock.calls.filter(
      (call) => call[0] === 'commit_gesture',
    );
    expect(gestureCalls).toHaveLength(1);

    const request = (gestureCalls[0][1] as { request: GestureCommitRequest })
      .request;
    // 자사 전용 op wire가 gesture 커맨드로 나간다
    expect(request.editorOpsVersion).toBe(EDITOR_OPS_VERSION);
    expect(request.editorOps).toEqual([
      {
        kind: 'setBounds',
        elementType: 'key',
        id: KEY_ID,
        // 이동 의도는 dx·dy, 크기는 base 값
        bounds: { dx: 40, dy: 25, width: 60, height: 60 },
      },
    ]);
    // legacy full-record 필드는 실리지 않는다
    expect(request.editorChanges).toBeUndefined();
    // 같은 transaction에 plugin 변경이 함께 실린다
    expect(request.pluginChanges?.map((change) => change.pluginId)).toEqual([
      PLUGIN_ID,
    ]);
    expect(request.gestureId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  });

  it('base에 대상이 없으면 중단으로 끝나고 editor op을 보내지 않는다', async () => {
    const intents = new Map([
      [
        'key' as const,
        new Map([['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { dx: 9, dy: 9 }]]),
      ],
    ]);
    const rollback = vi.fn();

    active = await loadRuntime();
    const { generateGeometryIntentOps, runMixedGestureElementIntent } = active;

    const result = await runMixedGestureElementIntent({
      gestureId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      initialPluginIds: [PLUGIN_ID],
      pluginScope: () => [PLUGIN_ID],
      receipt: { rollback },
      generate: ({ base }) => {
        // 프로덕션 경로와 동일하게 전량 소실은 중단으로 처리한다
        const ops = generateGeometryIntentOps(base, intents);
        if (ops.length === 0) throw new ElementIntentAbort('mixed settlement');
        return { kind: 'ops', ops };
      },
      skipContext: 'mixed selection settlement',
    });

    // 중단은 오류가 아니라 무커밋 - receipt 복원이 러너 소유
    expect(result).toEqual({ committed: false, satisfied: false });
    expect(rollback).toHaveBeenCalledTimes(1);
    const opsCalls = runtime.invoke.mock.calls.filter(
      (call) =>
        call[0] === 'commit_gesture' &&
        (call[1] as { request?: GestureCommitRequest }).request?.editorOps,
    );
    expect(opsCalls).toHaveLength(0);
  });
});
