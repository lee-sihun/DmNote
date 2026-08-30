import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CanonicalReactiveSpritePosition,
  EditorCommitRequest,
  EditorCommitResult,
  EditorCommittedV1,
  EditorDocumentV1,
} from '@src/types/editor';

const SPRITE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// IPC 경계만 대역으로 세우고 itemsApi·coordinator·스토어 배선은 실제 그대로.
// 패널 커밋이 동결 소유권 검사에 걸려 낙관 적용을 건너뛰던 회귀를 잡는다
const runtime = vi.hoisted(() => {
  let resolveCommit!: (result: EditorCommitResult) => void;
  const commit = vi.fn(
    (_request: EditorCommitRequest) =>
      new Promise<EditorCommitResult>((resolve) => {
        resolveCommit = resolve;
      }),
  );
  const get = vi.fn();
  // committed 이벤트를 테스트가 직접 쏠 수 있게 리스너를 캡처한다
  let committedListener: ((event: EditorCommittedV1) => void) | null = null;
  const onCommitted = vi.fn((listener: (event: EditorCommittedV1) => void) => {
    committedListener = listener;
    return Object.assign(() => {}, { ready: Promise.resolve() });
  });
  const subscribe = vi.fn(async () => 1);
  const cancel = vi.fn(async () => {});

  return {
    cancel,
    commit,
    get,
    onCommitted,
    emitCommitted: (event: EditorCommittedV1) => committedListener?.(event),
    resolveCommit: (result: EditorCommitResult) => resolveCommit(result),
    subscribe,
  };
});

vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: runtime.get,
    commit: runtime.commit,
    onCommitted: runtime.onCommitted,
  },
}));

vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    cancel: runtime.cancel,
    subscribe: runtime.subscribe,
  },
}));

// coordinator 싱글턴은 stop이 종결이라 케이스마다 모듈 그래프를 새로 얹는다
const loadHarness = async () => {
  const [itemsApi, spriteStore, wireShape, coordinator] = await Promise.all([
    import('@api/modules/itemsApi'),
    import('@stores/data/useSpriteStore'),
    import('@utils/sprite/spriteWireShape'),
    import('./editorStateCoordinator'),
  ]);
  return {
    spriteItemsApi: itemsApi.spriteItemsApi,
    useSpriteStore: spriteStore.useSpriteStore,
    toSpriteWireShape: wireShape.toSpriteWireShape,
    editorCoordinator: coordinator.editorCoordinator,
  };
};
type Harness = Awaited<ReturnType<typeof loadHarness>>;
let harness: Harness | null = null;

// 백엔드 실물 wire 형태: layerName·groupId는 None이면 직렬화에서 생략된다
const spriteFixture = (): CanonicalReactiveSpritePosition => ({
  id: SPRITE_ID,
  dx: 0,
  dy: 0,
  width: 200,
  height: 150,
  hidden: false,
  zIndex: null,
  className: null,
  useInlineStyles: null,
  baseImage: null,
  imageFit: null,
  imageRect: { x: 0, y: 0, width: 100, height: 100 },
  pivot: { x: 0.5, y: 0.5 },
  idleTransform: { x: 0, y: 0, rotation: 0, scale: 1 },
  poses: [],
  activation: 'whileHeld',
  transitionMs: 90,
  transitionEasing: 'cubic-bezier(0.4, 0, 0.2, 1)',
});

// 프론트 생성 리터럴 형태: 두 필드를 명시 null로 채운다
const frontendCreationFixture = (): CanonicalReactiveSpritePosition => ({
  ...spriteFixture(),
  layerName: null,
  groupId: null,
});

const makeDocument = (): EditorDocumentV1 => ({
  schemaVersion: 1,
  keys: {},
  keyPositions: {},
  statPositions: {},
  graphPositions: {},
  knobPositions: {},
  spritePositions: { '4key': [spriteFixture()] },
  layerGroups: {},
});

describe('스프라이트 필드 패치 낙관 적용 통합', () => {
  beforeEach(async () => {
    vi.resetModules();
    runtime.commit.mockClear();
    runtime.get.mockReset();
    runtime.get.mockResolvedValue({ revision: 0, document: makeDocument() });
    harness = await loadHarness();
  });

  afterEach(() => {
    harness?.editorCoordinator.stop();
    harness = null;
  });

  it('patchPosition 커밋은 응답 착지 전에 canonical 스토어에 반영된다', async () => {
    const { spriteItemsApi, useSpriteStore } = harness!;

    const write = spriteItemsApi.patchPosition('4key', SPRITE_ID, {
      baseImage: 'hand.png',
    });

    await vi.waitFor(() => expect(runtime.commit).toHaveBeenCalledOnce());
    // 낙관 로컬 적용: 백엔드 응답 전에 이미 canonical이 갱신된다
    expect(useSpriteStore.getState().positions['4key'][0]).toMatchObject({
      id: SPRITE_ID,
      baseImage: 'hand.png',
    });

    // wire에는 최신 base 기반 전체 레코드가 실리고 두 키는 부재를 유지한다
    const request = runtime.commit.mock.calls[0][0];
    const wireRecord = request.changes?.spritePositions?.['4key']?.[0];
    expect(wireRecord).toMatchObject({
      id: SPRITE_ID,
      baseImage: 'hand.png',
    });
    expect('layerName' in wireRecord!).toBe(false);
    expect('groupId' in wireRecord!).toBe(false);

    runtime.resolveCommit({ revision: 1, changedFields: ['spritePositions'] });
    await expect(write).resolves.toBe('committed');
    expect(useSpriteStore.getState().positions['4key'][0].baseImage).toBe(
      'hand.png',
    );
  });

  it('세션 생성 스프라이트도 정규화를 거치면 낙관 적용이 성립한다', async () => {
    const { spriteItemsApi, useSpriteStore, toSpriteWireShape } = harness!;
    const { editorCoordinator } = harness!;

    // ack는 백엔드 실물 wire 형태(두 키 부재), 스토어는 프론트 생성 경로
    // 형태(명시 null 리터럴이 wire 정규화를 거친 결과)로 시드한다.
    // 정규화가 빠지면 스토어와 ack가 갈라져 소유권 검사가 적용을 스킵한다
    await editorCoordinator.start();
    useSpriteStore.setState({
      positions: { '4key': [toSpriteWireShape(frontendCreationFixture())] },
    });

    const write = spriteItemsApi.patchPosition('4key', SPRITE_ID, {
      baseImage: 'hand.png',
    });

    await vi.waitFor(() => expect(runtime.commit).toHaveBeenCalledOnce());
    const optimistic = useSpriteStore.getState().positions['4key'][0];
    expect(optimistic).toMatchObject({ id: SPRITE_ID, baseImage: 'hand.png' });
    expect('layerName' in optimistic).toBe(false);
    expect('groupId' in optimistic).toBe(false);

    runtime.resolveCommit({ revision: 1, changedFields: ['spritePositions'] });
    await expect(write).resolves.toBe('committed');
  });

  it('역순 클릭 트리거 커밋 뒤에도 후속 편집의 낙관 적용이 유지된다', async () => {
    const { spriteItemsApi, useSpriteStore, editorCoordinator } = harness!;
    const A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const clickOrderPose = {
      poseId: 'pose-1',
      triggers: [B_ID, A_ID],
      matchMode: 'exact' as const,
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
      imageOverride: null,
    };

    await editorCoordinator.start();

    // 클릭 순서(B 먼저) 그대로 자세를 커밋한다
    const first = spriteItemsApi.patchPosition('4key', SPRITE_ID, {
      poses: [clickOrderPose],
    });
    await vi.waitFor(() => expect(runtime.commit).toHaveBeenCalledOnce());

    // wire와 낙관 스토어 모두 백엔드 정규화(정렬)와 같은 형태여야 한다
    const request = runtime.commit.mock.calls[0][0];
    const wirePose = request.changes?.spritePositions?.['4key']?.[0].poses[0];
    expect(wirePose?.triggers).toEqual([A_ID, B_ID]);
    expect(
      useSpriteStore.getState().positions['4key'][0].poses[0].triggers,
    ).toEqual([A_ID, B_ID]);

    // 백엔드 실물 순서: committed 이벤트가 응답보다 먼저 도착한다
    const ackRecord = {
      ...spriteFixture(),
      poses: [{ ...clickOrderPose, triggers: [A_ID, B_ID] }],
    };
    runtime.emitCommitted({
      schemaVersion: 1,
      revision: 1,
      mutationId: request.mutationId,
      changedFields: ['spritePositions'],
      patch: { schemaVersion: 1, spritePositions: { '4key': [ackRecord] } },
    });
    runtime.resolveCommit({ revision: 1, changedFields: ['spritePositions'] });
    await expect(first).resolves.toBe('committed');

    // ack와 로컬이 갈렸다면 이 편집의 소유권 검사가 실패해 낙관 반영이 사라진다
    const second = spriteItemsApi.patchPosition('4key', SPRITE_ID, {
      baseImage: 'hand.png',
    });
    await vi.waitFor(() => expect(runtime.commit).toHaveBeenCalledTimes(2));
    expect(useSpriteStore.getState().positions['4key'][0].baseImage).toBe(
      'hand.png',
    );

    runtime.resolveCommit({ revision: 2, changedFields: ['spritePositions'] });
    await expect(second).resolves.toBe('committed');
    expect(useSpriteStore.getState().positions['4key'][0].baseImage).toBe(
      'hand.png',
    );
  });

  it('대상 소실이면 무커밋으로 targetMissing을 반환한다', async () => {
    const { spriteItemsApi, useSpriteStore } = harness!;

    const write = spriteItemsApi.patchPosition('4key', 'missing-sprite-id', {
      baseImage: 'hand.png',
    });

    await expect(write).resolves.toBe('targetMissing');
    expect(runtime.commit).not.toHaveBeenCalled();
    expect(useSpriteStore.getState().positions['4key'][0].baseImage).toBeNull();
  });
});
