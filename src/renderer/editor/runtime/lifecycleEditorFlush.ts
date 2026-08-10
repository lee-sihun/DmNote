import { editGestureController } from './editGestureController';
import { settleFocusedEditor } from './focusedEditorSettlement';

// 편집 경계에서 포커스된 입력을 지금 대상에 확정한다.
//
// 정산 순서는 settleFocusedEditor가 소유하고, 여기서는 표준 gesture 커밋만 묶는다.
// 호출부가 각자 조립하면 커밋 대상이 갈릴 때 순서가 어긋난다
export const flushFocusedEditor = (): Promise<boolean> =>
  settleFocusedEditor(() => editGestureController.commitPendingAsync());
