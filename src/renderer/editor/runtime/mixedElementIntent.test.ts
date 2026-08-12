import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  commitMixed: vi.fn(),
  reportSkipped: vi.fn(),
}));

vi.mock('@plugins/runtime/displayElement/gestureTransaction', () => ({
  commitMixedGestureTransaction: mocks.commitMixed,
}));

vi.mock('./elementIntent', () => ({
  reportElementOpSkipped: mocks.reportSkipped,
}));

import { runMixedElementIntent } from './mixedElementIntent';

import type { EditorDocumentV1, EditorPatchV1 } from '@src/types/editor';

type Generate = (base: EditorDocumentV1) => EditorPatchV1 | null;
type Meta = { onEnrolled?: () => void };

const baseOptions = (rollback: () => void, generate: Generate) => ({
  gestureId: 'gesture-1',
  pluginIds: ['plugin-a'],
  applyEager: () => ({ rollback }),
  generate,
  skipContext: 'test settlement',
});

describe('runMixedElementIntent receipt 소유권', () => {
  beforeEach(() => {
    mocks.commitMixed.mockReset();
    mocks.reportSkipped.mockClear();
  });

  it('generatedNull은 성공해도 receipt를 복원하고 skip을 관측한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
      },
    );

    await runMixedElementIntent(baseOptions(rollback, () => null));

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mocks.reportSkipped).toHaveBeenCalledWith('test settlement');
  });

  it('expectNull은 복원하되 skip 관측을 생략한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
      },
    );

    await runMixedElementIntent({
      ...baseOptions(rollback, () => null),
      expectNull: true,
    });

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(mocks.reportSkipped).not.toHaveBeenCalled();
  });

  it('편입 전 실패는 receipt를 복원하고 원 오류를 전파한다', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockRejectedValue(new Error('drain failed'));

    await expect(
      runMixedElementIntent(
        baseOptions(rollback, () => ({ schemaVersion: 1 })),
      ),
    ).rejects.toThrow('drain failed');

    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('편입 후 실패는 gesture 실패 경로가 소유한다 - 복원 금지', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
        throw new Error('transaction failed');
      },
    );

    await expect(
      runMixedElementIntent(
        baseOptions(rollback, () => ({ schemaVersion: 1 })),
      ),
    ).rejects.toThrow('transaction failed');

    expect(rollback).not.toHaveBeenCalled();
  });

  it('generatedNull 후 plugin 실패도 receipt를 복원한다 - null 판정 우선', async () => {
    const rollback = vi.fn();
    mocks.commitMixed.mockImplementation(
      async (
        _gestureId: string,
        generate: Generate,
        _ids: unknown,
        meta: Meta,
      ) => {
        generate({} as EditorDocumentV1);
        meta.onEnrolled?.();
        throw new Error('plugin commit failed');
      },
    );

    await expect(
      runMixedElementIntent(baseOptions(rollback, () => null)),
    ).rejects.toThrow('plugin commit failed');

    expect(rollback).toHaveBeenCalledTimes(1);
  });
});
