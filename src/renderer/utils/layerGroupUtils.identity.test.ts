import { describe, expect, it } from 'vitest';

import type { CanonicalEditorDocumentV1 } from '@src/types/editor';
import { applyZIndexToLayerOrder } from './layerGroupUtils';

const ID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const keyPositions = (): CanonicalEditorDocumentV1['keyPositions'] =>
  ({
    '4key': [
      { id: ID_B, zIndex: 0 },
      { id: ID_A, zIndex: 1 },
    ],
  } as unknown as CanonicalEditorDocumentV1['keyPositions']);

describe('applyZIndexToLayerOrder stable identity', () => {
  it('stale locator index 대신 현재 ID 위치에 zIndex를 적용한다', () => {
    const result = applyZIndexToLayerOrder(
      [
        { type: 'key', id: ID_A, index: 0, zIndex: 1 },
        { type: 'key', id: ID_B, index: 1, zIndex: 0 },
      ],
      '4key',
      keyPositions(),
      {},
      {},
      {},
    );

    expect(result.keyPositions['4key']).toMatchObject([
      { id: ID_B, zIndex: 0 },
      { id: ID_A, zIndex: 1 },
    ]);
  });
});
