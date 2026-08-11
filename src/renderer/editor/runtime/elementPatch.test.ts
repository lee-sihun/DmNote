import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultKeyPosition } from '../model/keys';

import type { KeyPosition, KeyPositions } from '@src/types/key/keys';
import type { StatItemPosition } from '@src/types/key/statItems';

const api = vi.hoisted(() => ({
  updatePositionsWithGesture: vi.fn(
    async (_positions: KeyPositions, _gestureId?: string) => ({}),
  ),
  updateMappingsAndPositionsWithGesture: vi.fn(async () => ({})),
  statUpdate: vi.fn(async (_positions: Record<string, KeyPosition[]>) => ({})),
  graphUpdate: vi.fn(async (_positions: Record<string, KeyPosition[]>) => ({})),
  knobUpdate: vi.fn(async (_positions: Record<string, KeyPosition[]>) => ({})),
}));

vi.mock('@api/modules/keysApi', () => ({
  updatePositionsWithGesture: api.updatePositionsWithGesture,
  updateMappingsAndPositionsWithGesture:
    api.updateMappingsAndPositionsWithGesture,
}));
vi.mock('@api/modules/editorApi', () => ({
  editorApi: {
    get: vi.fn(),
    commit: vi.fn(),
    onCommitted: vi.fn(() =>
      Object.assign(() => {}, { ready: Promise.resolve() }),
    ),
  },
}));
vi.mock('@api/modules/previewApi', () => ({
  previewApi: {
    cancel: vi.fn(async () => {}),
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(async () => 1),
  },
}));

import { useKeyStore } from '@stores/data/useKeyStore';
import { useStatItemStore } from '@stores/data/useStatItemStore';
import { applyElementPatchById } from './elementPatch';
import { editGestureController } from './editGestureController';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_S = '33333333-3333-4333-8333-333333333333';
const ID_GONE = '99999999-9999-4999-8999-999999999999';

const keyAt = (id: string) => ({ ...createDefaultKeyPosition(), id });

describe('applyElementPatchById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    editGestureController.cancel();
    useKeyStore.setState({
      selectedKeyType: '4key',
      canonicalPositions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
      positions: { '4key': [keyAt(ID_A), keyAt(ID_B)] },
    });
    useStatItemStore.setState({ positions: {} });
    window.api = {
      statItems: { updatePositions: api.statUpdate },
      graphItems: { updatePositions: api.graphUpdate },
      knobItems: { updatePositions: api.knobUpdate },
    } as never;
  });

  it('재정렬 뒤에도 id가 가리키는 요소의 현재 index에 적용한다', () => {
    const [a, b] = useKeyStore.getState().canonicalPositions['4key'];
    useKeyStore.getState().setPositions({ '4key': [b, a] });

    const applied = applyElementPatchById('key', ID_A, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    const persisted = api.updatePositionsWithGesture.mock.calls[0][0];
    expect(persisted['4key'][1].inactiveImage).toBe('picked.png');
    expect(persisted['4key'][0].inactiveImage ?? '').toBe('');
    expect(
      useKeyStore.getState().canonicalPositions['4key'][1].inactiveImage,
    ).toBe('picked.png');
  });

  it('보고 있는 모드가 바뀌어도 원 모드 컬렉션에 적용한다', () => {
    const stat = {
      ...createDefaultKeyPosition(),
      id: ID_S,
      statType: 'kps',
    } as StatItemPosition;
    useStatItemStore.setState({ positions: { '4key': [stat] } });
    useKeyStore.setState({ selectedKeyType: '8key' });

    const applied = applyElementPatchById('stat', ID_S, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    const persisted = api.statUpdate.mock.calls[0][0];
    expect(persisted['4key'][0].inactiveImage).toBe('picked.png');
    expect(useStatItemStore.getState().positions['4key'][0].inactiveImage).toBe(
      'picked.png',
    );
  });

  it('요소가 삭제됐으면 아무것도 쓰지 않는다', () => {
    const applied = applyElementPatchById('key', ID_GONE, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(false);
    expect(api.updatePositionsWithGesture).not.toHaveBeenCalled();
    expect(api.statUpdate).not.toHaveBeenCalled();
  });

  it('updater가 id를 끼워 넣어도 신원은 보존된다', () => {
    const applied = applyElementPatchById(
      'key',
      ID_A,
      () => ({ id: 'hijacked', inactiveImage: 'picked.png' } as never),
    );

    expect(applied).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key'][0].id).toBe(ID_A);
  });

  it('updater가 입력 객체의 id를 직접 변조해도 신원은 보존된다', () => {
    const applied = applyElementPatchById('key', ID_A, (current) => {
      (current as { id?: string }).id = 'mutated';
      return { inactiveImage: 'picked.png' };
    });

    expect(applied).toBe(true);
    expect(useKeyStore.getState().canonicalPositions['4key'][0].id).toBe(ID_A);
    const persisted = api.updatePositionsWithGesture.mock.calls[0][0];
    expect(persisted['4key'][0].id).toBe(ID_A);
  });

  it('활성 게스처를 정산하지 않고 wire에 gestureId도 싣지 않는다', () => {
    editGestureController.preview('4key', [{ index: 0, patch: { dx: 5 } }], {
      domain: 'keyPosition',
    });
    const activeBefore = editGestureController.activeGestureId();
    expect(activeBefore).not.toBeNull();

    const applied = applyElementPatchById('key', ID_B, () => ({
      inactiveImage: 'picked.png',
    }));

    expect(applied).toBe(true);
    expect(editGestureController.activeGestureId()).toBe(activeBefore);
    expect(
      api.updatePositionsWithGesture.mock.calls.at(-1)?.[1],
    ).toBeUndefined();
  });
});
