import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type React from 'react';
import { beginDragCursor, endDragCursor } from '@utils/core/dragCursor';

export interface ScrubDragOptions {
  enabled: boolean;
  /** 드래그 시작값. null이면 이번 누름은 시작하지 않는다 (수식 초안 등) */
  resolveBase: () => number | null;
  /** 1px당 변화량. Shift는 10배 */
  step: number;
  /** 누적 변위로 만든 원시값을 표시 규칙(반올림·클램프)에 맞춘다 */
  quantize: (raw: number) => number;
  /** 값이 실제로 바뀔 때만 - 화면 갱신과 프리뷰 발행 */
  onMove: (next: number) => void;
  /** 손을 뗄 때 1회. 값이 한 번도 안 바뀌었으면 호출되지 않는다 */
  onCommit: (value: number) => void;
  /** Escape·포인터 취소·캡처 유실·언마운트 */
  onCancel: () => void;
}

export interface ScrubDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: (e: React.PointerEvent<HTMLElement>) => void;
  onClick: (e: React.MouseEvent<HTMLElement>) => void;
}

interface ScrubSession {
  pointerId: number;
  element: HTMLElement;
  base: number;
  lastX: number;
  raw: number;
  last: number;
  moved: boolean;
  /** 드래그 중 바꾼 커서·선택 금지를 되돌린다 */
  restoreDocument: () => void;
}

const SHIFT_MULTIPLIER = 10;

// 라벨을 좌우로 끌어 값을 바꾸는 게스처. 값은 매 이동마다 onMove로만 흐르고
// 저장은 손을 뗄 때 onCommit 한 번이다. 종료는 한 경로로 모은다 - up은 확정,
// 그 외(Escape·취소·캡처 유실·언마운트)는 전부 취소라 확정이 두 번 나갈 길이 없다
export const useScrubDrag = ({
  enabled,
  resolveBase,
  step,
  quantize,
  onMove,
  onCommit,
  onCancel,
}: ScrubDragOptions): {
  active: boolean;
  handlers: ScrubDragHandlers;
  /** 바깥 경계(입력 blur 등)에서 부르는 취소. 값을 되돌려 onCancel이 나갔으면 true */
  cancel: () => boolean;
} => {
  const sessionRef = useRef<ScrubSession | null>(null);
  const [active, setActive] = useState(false);
  // 콜백은 렌더마다 새로 만들어지므로 최신 것을 ref로 본다
  const callbacksRef = useRef({
    resolveBase,
    step,
    quantize,
    onMove,
    onCommit,
    onCancel,
  });
  useLayoutEffect(() => {
    callbacksRef.current = {
      resolveBase,
      step,
      quantize,
      onMove,
      onCancel,
      onCommit,
    };
  });

  // ref와 setState만 닫아 두므로 정체가 고정이다. 언마운트 정리가 렌더마다 돌면 안 된다.
  // 반환은 호출부에 값 변화를 알렸는지 - 이동 없는 세션은 조용히 닫힌다
  const finish = useCallback((mode: 'commit' | 'cancel'): boolean => {
    const session = sessionRef.current;
    if (!session) return false;
    sessionRef.current = null;
    setActive(false);
    session.restoreDocument();
    if (session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    if (!session.moved) return false;
    // 뒤따르는 click이 라벨 활성화로 이어지지 않게 표시
    session.element.dataset.scrubbed = '1';
    if (mode === 'commit') callbacksRef.current.onCommit(session.last);
    else callbacksRef.current.onCancel();
    return true;
  }, []);

  // Escape는 창 단위로 듣는다. 캡처 중에는 포커스가 다른 곳에 있어도 취소돼야 한다
  useEffect(() => {
    if (!active) return;
    const session = sessionRef.current;
    if (!session) return;
    const win = session.element.ownerDocument.defaultView ?? window;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish('cancel');
    };
    const handleBlur = () => finish('cancel');
    win.addEventListener('keydown', handleKeyDown, true);
    win.addEventListener('blur', handleBlur);
    return () => {
      win.removeEventListener('keydown', handleKeyDown, true);
      win.removeEventListener('blur', handleBlur);
    };
  }, [active, finish]);

  // 언마운트 중 드래그는 취소로 닫는다
  useEffect(
    () => () => {
      finish('cancel');
    },
    [finish],
  );

  const handlers: ScrubDragHandlers = {
    onPointerDown: (e) => {
      if (!enabled || sessionRef.current) return;
      if (e.button !== 0) return;
      // 라벨 mousedown 기본 동작(포커스 이동·글자 선택)을 막는다.
      // 클릭 활성화는 따로 살아 있어 이동 없는 클릭은 여전히 입력에 포커스가 간다
      e.preventDefault();
      const base = callbacksRef.current.resolveBase();
      if (base === null) return;
      const element = e.currentTarget;
      const doc = element.ownerDocument;
      const body = doc.body;
      const prevSelect = body.style.userSelect;
      // 캡처 중에도 커서는 포인터 아래 요소가 정하므로 문서 전체를 덮는다.
      // 폼(cursor-text)·입력 위를 지나도 놓을 때까지 좌우 화살표가 유지된다
      beginDragCursor('ew-resize', doc);
      body.style.userSelect = 'none';
      element.setPointerCapture(e.pointerId);
      sessionRef.current = {
        pointerId: e.pointerId,
        element,
        base,
        lastX: e.clientX,
        raw: base,
        last: base,
        moved: false,
        restoreDocument: () => {
          endDragCursor(doc);
          body.style.userSelect = prevSelect;
        },
      };
      setActive(true);
    },
    onPointerMove: (e) => {
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      const { step: unit, quantize: q, onMove: move } = callbacksRef.current;
      const dx = e.clientX - session.lastX;
      session.lastX = e.clientX;
      if (dx === 0) return;
      // 누적 변위에 현재 배율을 곱한다. 드래그 중 Shift를 바꿔도 값이 튀지 않는다
      session.raw += dx * (e.shiftKey ? unit * SHIFT_MULTIPLIER : unit);
      const next = q(session.raw);
      if (next === session.last) return;
      session.last = next;
      session.moved = true;
      move(next);
    },
    onPointerUp: (e) => {
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      finish('commit');
    },
    onPointerCancel: (e) => {
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      finish('cancel');
    },
    onLostPointerCapture: (e) => {
      // up·cancel이 먼저 닫았으면 세션이 이미 없다. 남아 있다면 외부 요인으로 잃은 것
      const session = sessionRef.current;
      if (!session || e.pointerId !== session.pointerId) return;
      finish('cancel');
    },
    onClick: (e) => {
      // 끌고 난 뒤의 click은 라벨 활성화(입력 포커스)로 이어지면 안 된다.
      // 세션은 up에서 이미 닫혔으므로 이동 여부는 데이터 속성으로 남긴다
      if (e.currentTarget.dataset.scrubbed === '1') {
        delete e.currentTarget.dataset.scrubbed;
        e.preventDefault();
      }
    },
  };

  const cancel = useCallback(() => finish('cancel'), [finish]);

  return { active, handlers, cancel };
};
