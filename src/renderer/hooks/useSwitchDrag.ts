import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type React from 'react';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';

// 드래그 중 이동 전환을 끄는 표식. dmn- 접두사는 플러그인 마크업과의 속성 충돌 방지
const DRAG_ATTR = 'data-dmn-dragging';
const THUMB_SELECTOR = '.dmn-toggle-thumb';

// 탭과 드래그를 가르는 이동 슬롭. 분류에만 쓰고 값 판정에는 안 쓴다.
// 넘고 나면 이동 구간 전체가 그대로 살아 있어 데드존이 아니다.
//
// 이동 폭이 12px뿐이라 흔한 10px 임계는 구간 대부분을 먹고, 0으로 두면 노브를 누른 채
// 1px만 흔들려도 드래그로 잡혀 클릭을 삼킨다. 중앙선(6)보다 작아야 의도한 횡단을 놓치지
// 않고, 클릭 중 손 떨림 1~2px보다는 커야 한다. 세로 이동은 안 본다. 가로 의도만 본다
const DRAG_SLOP_PX = 3;

type DragIntent = 'undecided' | 'drag';

interface DragSession {
  pointerId: number;
  track: HTMLElement;
  thumb: HTMLElement | null;
  travel: number;
  startX: number;
  startValue: boolean;
  startOffset: number;
  offset: number;
  intent: DragIntent;
  displayed: boolean;
}

interface UseSwitchDragOptions {
  checked: boolean;
  onFlip: () => void;
  // 값이 바뀌기 직전에 직접 조작임을 알린다. 안 하면 300ms를 넘긴 드래그가
  // '외부 변경'으로 판정돼 정착 모션이 잘린다
  markPress: () => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

// 포인터 캡처는 네이티브 텍스트 선택을 막지 않는다. 노브가 실제로 움직인 뒤에만
// 잠가 단순 클릭의 선택 동작은 건드리지 않는다 (useDraggable과 같은 관례)
const lockTextSelection = (locked: boolean) => {
  document.body.style.userSelect = locked ? 'none' : '';
};

const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// 이동 폭은 토큰이 소유한다. 토큰을 못 읽는 환경에서는 실측 사각형으로 대체
const readTravel = (track: HTMLElement, thumb: HTMLElement | null) => {
  const fromToken = Number.parseFloat(
    getComputedStyle(track).getPropertyValue('--ui-toggle-travel'),
  );
  if (Number.isFinite(fromToken) && fromToken > 0) return fromToken;
  if (!thumb) return 0;
  const trackRect = track.getBoundingClientRect();
  const thumbRect = thumb.getBoundingClientRect();
  const inset = Math.max(0, trackRect.height - thumbRect.height) / 2;
  return Math.max(0, trackRect.width - thumbRect.width - inset * 2);
};

// 인라인 위치를 CSS에 돌려준다. 전환을 되살린 상태를 리플로우로 한 번 확정시켜야
// 시작값이 손끝 위치로 잡힌다. 같은 재계산에 둘을 넣으면 전환이 안 걸린다
const handBack = (session: DragSession) => {
  session.track.removeAttribute(DRAG_ATTR);
  if (!session.thumb) return;
  if (!prefersReducedMotion()) session.track.getBoundingClientRect();
  session.thumb.style.removeProperty('translate');
};

/**
 * 토글 노브를 잡고 좌우로 끌어 상태를 정하는 제스처. 데스크톱 스위치의 관례를 따른다.
 * - 분류: 이동 슬롭을 넘겨야 드래그. 못 넘기면 탭이고 뒤따르는 click이 뒤집는다
 * - 판정: 손을 뗀 순간 노브 중심이 중앙선을 넘었는지. 손가락 위치가 아니라 노브 위치다
 * - 속도와 방향은 안 쓴다
 *
 * 노브는 누른 지점 기준 상대 델타로 움직인다. 커서 절대 좌표에 매핑하면
 * 트랙 아무 데나 눌러도 노브가 커서로 점프한다.
 *
 * 짧게 누른 프레스를 이동량과 무관하게 탭으로 구제하는 시간 게이트는 안 쓴다.
 * 되돌려 취소하는 동작과 빠른 플릭이 구분되지 않는다.
 *
 * 끌었다가 원위치로 되돌리면 노브 위치가 시작값과 같아져 자연히 취소된다.
 * 별도 분기가 아니라 위치 판정의 결과다.
 *
 * 위치는 CSS가 translate로 소유하므로 드래그 중에만 인라인 translate로 덮고
 * 놓을 때 되돌려준다. transform으로 쓰면 CSS translate와 합성돼 켜짐 상태에서
 * 이동 폭만큼 앞선 자리부터 시작한다
 */
export const useSwitchDrag = ({
  checked,
  onFlip,
  markPress,
}: UseSwitchDragOptions) => {
  const sessionRef = useRef<DragSession | null>(null);
  const disarmSwallowRef = useRef<(() => void) | null>(null);
  const handBackFrameRef = useRef(0);
  const [dragValue, setDragValue] = useState<boolean | null>(null);

  // 드래그 뒤에 오는 click 한 번을 창 캡처 단계에서 삼킨다.
  // 트랙은 28px인데 이동 폭이 12px이라 노브를 끝까지 끌면 손이 트랙 밖에서 떨어진다.
  // 그러면 click이 트랙이 아니라 공통 조상에 꽂혀 컨트롤 자신의 핸들러로는 못 막고,
  // 설정 행처럼 조상이 행 버튼인 표면에서는 거기서 한 번 더 뒤집힌다.
  // 해제는 click이 오거나 다음 입력(pointerdown·keydown)이 시작될 때. 먼저 오는 쪽이다 -
  // 타이머로 풀면 click과 경합하고, 안 풀면 엉뚱한 클릭을 삼킨다. 드래그가 click 없이
  // 끝난 뒤 키보드로 누른 버튼의 합성 click에는 pointerdown이 없어 keydown도 해제 조건이다
  const armClickSwallow = useCallback(() => {
    disarmSwallowRef.current?.();
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      disarm();
    };
    const disarm = () => {
      window.removeEventListener('click', swallow, true);
      window.removeEventListener('pointerdown', disarm, true);
      window.removeEventListener('keydown', disarm, true);
      disarmSwallowRef.current = null;
    };
    window.addEventListener('click', swallow, true);
    window.addEventListener('pointerdown', disarm, true);
    window.addEventListener('keydown', disarm, true);
    disarmSwallowRef.current = disarm;
  }, []);

  const checkedRef = useRef(checked);
  const onFlipRef = useRef(onFlip);
  const markPressRef = useRef(markPress);
  useLayoutEffect(() => {
    checkedRef.current = checked;
    onFlipRef.current = onFlip;
    markPressRef.current = markPress;
  }, [checked, onFlip, markPress]);

  const schedulerRef = useRef<ReturnType<
    typeof createRafLatestScheduler<number>
  > | null>(null);

  const endSession = useCallback(
    (commit: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      // 소유권을 먼저 내려놓아 커밋이 부르는 blur·캡처 상실로 재진입하지 못하게 한다
      sessionRef.current = null;
      schedulerRef.current?.cancel();
      if (session.track.hasPointerCapture?.(session.pointerId)) {
        session.track.releasePointerCapture(session.pointerId);
      }

      // 슬롭을 못 넘겼으면 탭이다. 뒤따르는 click이 뒤집게 두고 아무것도 삼키지 않는다
      if (session.intent === 'undecided') {
        setDragValue(null);
        handBack(session);
        return;
      }

      lockTextSelection(false);
      // 취소로 끝난 제스처는 click이 따라오지 않는다
      if (commit) armClickSwallow();
      // 노브 중심이 중앙선을 넘었는지만 본다. 원위치로 돌아왔으면 시작값과 같아져 취소된다
      const target = commit
        ? session.offset >= session.travel / 2
        : session.startValue;

      // 표시값을 목표로 먼저 고정한다. 이 렌더가 끝나야 CSS의 정착 지점이 목표가 되고,
      // 그때 인라인을 걷어야 노브가 손끝에서 목표까지 한 번에 간다
      setDragValue(target);
      if (commit && target !== checkedRef.current) {
        markPressRef.current();
        onFlipRef.current();
      }
      cancelAnimationFrame(handBackFrameRef.current);
      handBackFrameRef.current = requestAnimationFrame(() => {
        handBackFrameRef.current = 0;
        setDragValue(null);
        handBack(session);
      });
    },
    [armClickSwallow],
  );

  useEffect(() => {
    const scheduler = createRafLatestScheduler<number>((offset) => {
      const thumb = sessionRef.current?.thumb;
      if (thumb) thumb.style.translate = `${offset}px 0`;
    });
    schedulerRef.current = scheduler;
    const cancel = () => endSession(false);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('blur', cancel);
      scheduler.cancel();
      schedulerRef.current = null;
      cancelAnimationFrame(handBackFrameRef.current);
      disarmSwallowRef.current?.();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        handBack(session);
        if (session.intent === 'drag') lockTextSelection(false);
      }
    };
  }, [endSession]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || sessionRef.current) return;
    const track = event.currentTarget;
    const thumb = track.querySelector<HTMLElement>(THUMB_SELECTOR);
    const travel = readTravel(track, thumb);
    // 이동 폭을 모르면(레이아웃 전·숨김) 드래그 판정이 성립하지 않는다. 탭으로 둔다 -
    // 여기서 세션을 잡으면 슬롭만 넘겨도 click까지 삼켜 토글이 통째로 먹통이 된다
    if (travel <= 0) return;
    track.setPointerCapture?.(event.pointerId);
    sessionRef.current = {
      pointerId: event.pointerId,
      track,
      thumb,
      travel,
      startX: event.clientX,
      startValue: checkedRef.current,
      startOffset: checkedRef.current ? travel : 0,
      offset: checkedRef.current ? travel : 0,
      intent: 'undecided',
      displayed: checkedRef.current,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.startX;
    if (session.intent === 'undecided') {
      if (Math.abs(dx) < DRAG_SLOP_PX) return;
      session.intent = 'drag';
      // 표식은 여기서 붙인다. 누르자마자 붙이면 단순 클릭에도 전환 규칙이 갈려
      // 기존 누름 감각을 건드린다
      session.track.setAttribute(DRAG_ATTR, '');
      lockTextSelection(true);
    }
    session.offset = clamp(session.startOffset + dx, 0, session.travel);
    schedulerRef.current?.push(session.offset);
    const next = session.offset >= session.travel / 2;
    if (next === session.displayed) return;
    session.displayed = next;
    setDragValue(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sessionRef.current?.pointerId !== event.pointerId) return;
    endSession(true);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sessionRef.current?.pointerId !== event.pointerId) return;
    endSession(false);
  };

  // 명시 해제 뒤에는 세션이 이미 없어 no-op. 창이 캡처를 뺏어간 경우만 취소로 걸린다
  const onLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (sessionRef.current?.pointerId !== event.pointerId) return;
    endSession(false);
  };

  return {
    dragValue,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
    },
  };
};
