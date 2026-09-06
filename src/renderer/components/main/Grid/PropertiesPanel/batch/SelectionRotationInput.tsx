import { useLayoutEffect, useRef } from 'react';
import { useSelectionRotationFrame } from '@hooks/Grid/useSelectionRotationFrame';
import { createSelectionRotationGesture } from '../../handles/selectionRotationGesture';
import type { CanvasRotationSession } from '../../handles/CanvasRotateHandle';
import RotationInputRow from '../RotationInputRow';

interface SelectionRotationInputProps {
  label: string;
}

const SelectionRotationInput = ({ label }: SelectionRotationInputProps) => {
  const frame = useSelectionRotationFrame();
  const sessionRef = useRef<CanvasRotationSession | null>(null);
  const mountedRef = useRef(false);
  const cancel = () => {
    sessionRef.current?.cancel();
    sessionRef.current = null;
  };
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      // 자식 숫자 입력의 언마운트 정산이 새 프리뷰 세션을 만들지 못하게 한다
      mountedRef.current = false;
      sessionRef.current?.cancel();
      sessionRef.current = null;
    };
  }, [frame?.selectionKey]);

  if (!frame) return null;
  const preview = (value: number) => {
    if (!mountedRef.current) return false;
    if (!sessionRef.current) {
      sessionRef.current = createSelectionRotationGesture(frame);
    }
    const applied = sessionRef.current?.preview(value) ?? false;
    // 실패한 세션은 버려 다음 입력이 최신 틀로 다시 시작하게 한다
    if (!applied) cancel();
    return applied;
  };
  return (
    <RotationInputRow
      label={label}
      value={frame.rotation}
      onPreview={preview}
      onChange={(value) => {
        if (!preview(value)) return;
        sessionRef.current?.commit(value);
        sessionRef.current = null;
      }}
      onCancel={cancel}
    />
  );
};

export default SelectionRotationInput;
