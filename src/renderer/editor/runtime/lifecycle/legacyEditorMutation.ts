import { editGestureController } from '../gesture/editGestureController';
import { enqueueEditorCompatibilityOperation } from './editorCompatibilityQueue';
import { editorCoordinator } from '../coordinator/editorStateCoordinator';

export const runLegacyEditorMutation = async <T>(
  mutation: () => Promise<T>,
): Promise<T> => {
  // committed 구독 없이 백엔드만 변경되는 상태를 차단
  await editorCoordinator.start();
  return mutation();
};

// 백엔드가 편집 문서를 직접 바꾸는 legacy 커맨드(프리셋 로드, 리셋, 커스텀 탭,
// 카운터 애니메이션 사용처 재작성, 사운드 삭제) 전용. 호환 큐와 coordinator
// 직렬 tail을 모두 점유해, 먼저 캡처하고 대기 중이던 full-record 커밋이
// mutation 결과(재발급 ID 포함)를 되돌리는 순서를 차단한다.
//
// 활성 게스처는 compat 슬롯을 얻기 전에 정산한다. ID 의도는 요소 소실에는
// 수렴하지만, 요소가 유지된 채 참조 필드만 재작성되는 mutation(카운터
// 프리셋 삭제의 fallback 재작성, 사운드 삭제)에서는 정산이 mutation 뒤로
// 밀리면 삭제된 참조를 되살린다 - 정산을 먼저 큐에 앉혀 순서를 고정한다
export const runExclusiveLegacyMutation = async <T>(
  mutation: () => Promise<T>,
): Promise<T> => {
  // 정산 대상을 시점 세션으로 한정 - 정산 대기 중 사용자가 시작한 새 게스처
  // B는 실패한 A와 무관한 최신 편집이므로 건드리면 안 된다
  const settlingGestureId = editGestureController.activeGestureId();
  const settled = await editGestureController.commitPendingAsync();
  if (
    !settled &&
    settlingGestureId !== null &&
    editGestureController.activeGestureId() === settlingGestureId
  ) {
    // 정산 실패로 되살아난 그 게스처만 폐기한다. 살려둔 채 진행하면 mutation이
    // 재작성한 참조 위에 옛 patch가 blur·flush 재시도로 재적용되어 삭제된
    // 참조가 부활한다 - 지금의 사용자 의도는 mutation 쪽이다
    editGestureController.cancel();
  }
  return enqueueEditorCompatibilityOperation(() =>
    editorCoordinator.runExclusiveLegacyMutation(mutation),
  );
};
