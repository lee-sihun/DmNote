import { useEffect, useRef } from 'react';
import type {
  RemoteSheetResult,
  RemoteSheetSpec,
} from '@api/modules/remoteSheetApi';
import { openRemoteSheet } from '@stores/grid/useRemoteSheetStore';
import { isPanelWindow } from '@utils/windowType';

type RemoteSheetKind = RemoteSheetSpec['kind'];

type SavedResult<K extends RemoteSheetKind> = Extract<
  RemoteSheetResult,
  { status: 'saved'; kind: K }
>;

interface RemoteSheetOpener<K extends RemoteSheetKind> {
  /** 분리 패널 창인지 - 아니면 호출부가 자기 창에 시트를 띄운다 */
  isPanel: boolean;
  open: (spec: Extract<RemoteSheetSpec, { kind: K }>) => Promise<void>;
}

/**
 * 분리 패널 창은 시트가 들어갈 폭이 없어 메인 창에 대신 띄운다.
 * 결과는 돌아온 시점의 최신 onSaved로 적용한다 - 시트가 떠 있는 동안 대상이 바뀔 수 있다.
 * 저장 외의 결과(취소·실패)와 다른 종류의 결과는 조용히 버린다
 */
export const useRemoteSheetOpener = <K extends RemoteSheetKind>(
  kind: K,
  onSaved?: (result: SavedResult<K>) => void,
): RemoteSheetOpener<K> => {
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });

  const open = (spec: Extract<RemoteSheetSpec, { kind: K }>) =>
    openRemoteSheet(spec).then((result) => {
      if (result.status !== 'saved' || result.kind !== kind) return;
      onSavedRef.current?.(result as SavedResult<K>);
    });

  return { isPanel: isPanelWindow(), open };
};
