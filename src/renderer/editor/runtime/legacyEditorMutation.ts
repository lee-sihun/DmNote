import { editorCoordinator } from './editorStateCoordinator';

interface LegacyEditorMutationCoordinator {
  start: () => Promise<unknown>;
  sync: (options?: { reapply?: boolean }) => Promise<void>;
}

interface LegacyEditorMutationOptions {
  syncAfter?: boolean;
}

export const runLegacyEditorMutationWith = async <T>(
  coordinator: LegacyEditorMutationCoordinator,
  mutation: () => Promise<T>,
  options: LegacyEditorMutationOptions = {},
): Promise<T> => {
  // committed 구독 없이 백엔드만 변경되는 상태를 차단
  await coordinator.start();
  const result = await mutation();

  if (options.syncAfter === false) return result;

  try {
    await coordinator.sync();
  } catch (error) {
    // 구독은 이미 살아 있으므로 명령 성공을 실패로 뒤집지 않음
    console.error('레거시 편집 상태 재동기화 실패', error);
  }

  return result;
};

export const runLegacyEditorMutation = <T>(
  mutation: () => Promise<T>,
  options?: LegacyEditorMutationOptions,
): Promise<T> =>
  runLegacyEditorMutationWith(editorCoordinator, mutation, options);
