import { editGestureController } from './editGestureController';
import { settleFocusedEditor } from './focusedEditorSettlement';

export const flushFocusedEditorForLifecycle = (): Promise<boolean> =>
  settleFocusedEditor(() => editGestureController.commitPendingAsync());
