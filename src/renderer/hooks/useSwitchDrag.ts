import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type React from 'react';
import { createRafLatestScheduler } from '@utils/animation/rafLatestScheduler';
import { prefersReducedMotion } from '@utils/animation/motionPreferences';

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
  // 노브가 사는 문서와 창. 분리 패널 자식 창에 그려지면 메인의 것과 다르다
  ownerDocument: Document;
  ownerWindow: Window;
  travel: number;
  startX: number;
  // 누른 순간의 값. 강등 판정 기준이라 손 밑에서 바뀌는 현재 값과 따로 둔다
  startValue: boolean;
  startOffset: number;
  offset: number;
  // 세션 동안 본 최대 이동량 절댓값. 이동 폭만큼 끌어본 적이 있는지 가른다.
  // clamp된 offset과 달리 끝에서 바깥으로 민 거리도 남는다
  maxAbsDx: number;
  intent: DragIntent;
  displayed: boolean;
  // 이 세션이 자기 창에 건 취소용 blur를 걷는다
  releaseBlur: () => void;
  // 노브 인라인 위치를 자기 창 프레임에 실어 보낸다
  scheduler: ReturnType<typeof createRafLatestScheduler<number>>;
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
const lockTextSelection = (doc: Document, locked: boolean) => {
  doc.body.style.userSelect = locked ? 'none' : '';
};

// 이동 폭은 토큰이 소유한다. 토큰을 못 읽는 환경에서는 실측 사각형으로 대체
const readTravel = (track: HTMLElement, thumb: HTMLElement | null) => {
  const view = track.ownerDocument.defaultView ?? window;
  const fromToken = Number.parseFloat(
    view.getComputedStyle(track).getPropertyValue('--ui-toggle-travel'),
  );
  if (Number.isFinite(fromToken) && fromToken > 0) return fromToken;
  if (!thumb) return 0;
  const trackRect = track.getBoundingClientRect();
  const thumbRect = thumb.getBoundingClientRect();
  const inset = Math.max(0, trackRect.height - thumbRect.height) / 2;
  return Math.max(0, trackRect.width - thumbRect.width - inset * 2);
};

// 포인터 위치를 세션에 접어 넣는다. 뗄 때 좌표가 마지막 이동보다 앞서 오는 경우가 있어
// 손을 떼는 순간에도 한 번 더 반영해야 빠른 플릭이 짧게 잡히지 않는다
const foldPointer = (session: DragSession, clientX: number) => {
  const dx = clientX - session.startX;
  session.maxAbsDx = Math.max(session.maxAbsDx, Math.abs(dx));
  return dx;
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
 * - 강등: 이동 폭만큼 끌어본 적 없는 제스처가 값 그대로 끝나면 탭으로 되돌린다.
 *   이동 폭이 12px뿐이라 슬롭(3)과 이동 폭(12) 사이가 클릭 중 손 떨림 범위와 겹친다 -
 *   여기서 "값 그대로 + click 삼킴"으로 끝내면 눌렀는데 아무 반응이 없는 구간이 생긴다.
 *   한 번이라도 이동 폭만큼 끌었으면 의도한 드래그다. 이동 폭을 채우고 되돌아온 취소도,
 *   이미 그쪽 끝이라 노브가 안 움직인 무동작(켜진 걸 켜는 쪽으로)도 드래그로 남는다
 * - 속도와 방향은 안 쓴다
 *
 * 리스너·rAF·선택 잠금·스타일 계산은 노브가 사는 창 기준이다. 토글이 분리 패널
 * 자식 창 문서에 그려질 수 있어서다. 전역 window는 폴백으로만 쓴다.
 *
 * 노브는 누른 지점 기준 상대 델타로 움직인다. 커서 절대 좌표에 매핑하면
 * 트랙 아무 데나 눌러도 노브가 커서로 점프한다.
 *
 * 짧게 누른 프레스를 이동량과 무관하게 탭으로 구제하는 시간 게이트는 안 쓴다.
 * 되돌려 취소하는 동작과 빠른 플릭이 구분되지 않는다.
 *
 * 되돌려 취소하는 길은 노브를 이동 폭만큼 끌고 난 뒤에 열린다. 그 아래에서 시작점으로
 * 돌아온 제스처는 흔들린 클릭으로 본다. 이동 폭이 12px뿐이라 짧게 나갔다 온 왕복은
 * 손 떨림과 구분되지 않고, 애매하면 탭이 이긴다.
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
  // 정산 프레임은 예약한 창과 함께 들고 있어야 그 창에서 취소된다
  const handBackFrameRef = useRef<{ win: Window; id: number } | null>(null);
  // 다음 프레임에 CSS로 돌려줄 세션. 그 프레임 안에 새 드래그가 시작되면 먼저 정산해야
  // 뒤늦게 도는 handBack이 새 세션의 표식과 인라인 위치를 걷어가지 않는다
  const pendingHandBackRef = useRef<DragSession | null>(null);
  const [dragValue, setDragValue] = useState<boolean | null>(null);

  const cancelHandBackFrame = useCallback(() => {
    const frame = handBackFrameRef.current;
    if (!frame) return;
    handBackFrameRef.current = null;
    frame.win.cancelAnimationFrame(frame.id);
  }, []);

  // 드래그 뒤에 오는 click 한 번을 창 캡처 단계에서 삼킨다.
  // 트랙은 28px인데 이동 폭이 12px이라 노브를 끝까지 끌면 손이 트랙 밖에서 떨어진다.
  // 그러면 click이 트랙이 아니라 공통 조상에 꽂혀 컨트롤 자신의 핸들러로는 못 막고,
  // 설정 행처럼 조상이 행 버튼인 표면에서는 거기서 한 번 더 뒤집힌다.
  // 무장은 노브가 사는 창에 건다. 메인에 걸면 자식 창에서 뜬 click을 못 잡는다.
  // 해제는 click이 오거나 다음 입력(pointerdown·keydown)이 시작될 때. 먼저 오는 쪽이다 -
  // 타이머로 풀면 click과 경합하고, 안 풀면 엉뚱한 클릭을 삼킨다. 드래그가 click 없이
  // 끝난 뒤 키보드로 누른 버튼의 합성 click에는 pointerdown이 없어 keydown도 해제 조건이다
  const armClickSwallow = useCallback((win: Window) => {
    disarmSwallowRef.current?.();
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      disarm();
    };
    // 무장한 그 창에서 걷는다. 해제가 엉뚱한 창을 보지 않는다
    const disarm = () => {
      win.removeEventListener('click', swallow, true);
      win.removeEventListener('pointerdown', disarm, true);
      win.removeEventListener('keydown', disarm, true);
      disarmSwallowRef.current = null;
    };
    win.addEventListener('click', swallow, true);
    win.addEventListener('pointerdown', disarm, true);
    win.addEventListener('keydown', disarm, true);
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

  const endSession = useCallback(
    (commit: boolean) => {
      const session = sessionRef.current;
      if (!session) return;
      // 소유권을 먼저 내려놓아 커밋이 부르는 blur·캡처 상실로 재진입하지 못하게 한다
      sessionRef.current = null;
      session.releaseBlur();
      session.scheduler.cancel();
      if (session.track.hasPointerCapture?.(session.pointerId)) {
        session.track.releasePointerCapture(session.pointerId);
      }

      // 슬롭을 못 넘겼으면 탭이다. 뒤따르는 click이 뒤집게 두고 아무것도 삼키지 않는다
      if (session.intent === 'undecided') {
        setDragValue(null);
        handBack(session);
        return;
      }

      lockTextSelection(session.ownerDocument, false);
      // 노브 중심이 중앙선을 넘었는지만 본다. 원위치로 돌아왔으면 시작값과 같아져 취소된다.
      // 취소는 지금 값으로 돌려준다 - 끄는 사이 외부에서 바뀌었을 수 있다
      const target = commit
        ? session.offset >= session.travel / 2
        : checkedRef.current;

      // 이동 폭만큼 끌어본 적 없이 값까지 그대로면 흔들린 클릭이다 - 탭으로 되돌린다.
      // 노브를 제자리로 돌려주고 click은 삼키지 않아 평소처럼 뒤집히게 둔다.
      // 기준은 세션 시작값이다 - 끄는 사이 외부에서 값이 바뀌면 현재 값과는 우연히
      // 같아질 수 있고, 그걸 흔들림으로 보면 뒤따르는 click이 남의 변경을 되돌린다.
      // 세로는 보지 않는다 - 세로로 트랙을 벗어나 뗀 click은 조상에 꽂히며, 그건 평범한 클릭이
      // 트랙 밖에서 끝났을 때와 같은 결과다(설정 행은 행 버튼이 받아 뒤집고, 맨 트랙은 무반응)
      if (
        commit &&
        target === session.startValue &&
        session.maxAbsDx < session.travel
      ) {
        setDragValue(null);
        handBack(session);
        return;
      }
      // 취소로 끝난 제스처는 click이 따라오지 않는다
      if (commit) armClickSwallow(session.ownerWindow);

      // 표시값을 목표로 먼저 고정한다. 이 렌더가 끝나야 CSS의 정착 지점이 목표가 되고,
      // 그때 인라인을 걷어야 노브가 손끝에서 목표까지 한 번에 간다
      setDragValue(target);
      if (commit && target !== checkedRef.current) {
        markPressRef.current();
        onFlipRef.current();
      }
      cancelHandBackFrame();
      pendingHandBackRef.current = session;
      // 정산 프레임은 지금 노브가 사는 창에 건다. 세션 도중 호스트가 옮겨지면
      // 떠나온 창은 숨겨져 프레임이 멈춘다
      const frameWindow =
        session.track.ownerDocument.defaultView ?? session.ownerWindow;
      handBackFrameRef.current = {
        win: frameWindow,
        id: frameWindow.requestAnimationFrame(() => {
          handBackFrameRef.current = null;
          pendingHandBackRef.current = null;
          setDragValue(null);
          handBack(session);
        }),
      };
    },
    [armClickSwallow, cancelHandBackFrame],
  );

  // 아직 프레임을 기다리는 이전 세션의 정산을 지금 끝낸다
  const flushPendingHandBack = () => {
    const pending = pendingHandBackRef.current;
    if (!pending) return;
    cancelHandBackFrame();
    pendingHandBackRef.current = null;
    setDragValue(null);
    handBack(pending);
  };

  // 언마운트 정리. 남은 세션이 자기 창에 걸어둔 리스너·프레임·선택 잠금까지 걷는다
  useEffect(
    () => () => {
      cancelHandBackFrame();
      const pending = pendingHandBackRef.current;
      pendingHandBackRef.current = null;
      if (pending) handBack(pending);
      disarmSwallowRef.current?.();
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) {
        session.releaseBlur();
        session.scheduler.cancel();
        handBack(session);
        if (session.intent === 'drag') {
          lockTextSelection(session.ownerDocument, false);
        }
      }
    },
    [cancelHandBackFrame],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary || sessionRef.current) return;
    const track = event.currentTarget;
    const thumb = track.querySelector<HTMLElement>(THUMB_SELECTOR);
    const travel = readTravel(track, thumb);
    // 이동 폭을 모르면(레이아웃 전·숨김) 드래그 판정이 성립하지 않는다. 탭으로 둔다 -
    // 여기서 세션을 잡으면 슬롭만 넘겨도 click까지 삼켜 토글이 통째로 먹통이 된다
    if (travel <= 0) return;
    flushPendingHandBack();
    track.setPointerCapture?.(event.pointerId);
    const ownerDocument = track.ownerDocument;
    const ownerWindow = ownerDocument.defaultView ?? window;
    // 자식 창에 그려진 토글은 자기 창의 blur만 취소 사유다. 메인 창 blur는 자식이
    // 포커스를 가져갈 때도 뜬다
    const cancelOnBlur = () => endSession(false);
    ownerWindow.addEventListener('blur', cancelOnBlur);
    sessionRef.current = {
      pointerId: event.pointerId,
      track,
      thumb,
      ownerDocument,
      ownerWindow,
      travel,
      startX: event.clientX,
      startValue: checkedRef.current,
      startOffset: checkedRef.current ? travel : 0,
      offset: checkedRef.current ? travel : 0,
      maxAbsDx: 0,
      intent: 'undecided',
      displayed: checkedRef.current,
      releaseBlur: () => ownerWindow.removeEventListener('blur', cancelOnBlur),
      scheduler: createRafLatestScheduler<number>(
        (offset) => {
          const node = sessionRef.current?.thumb;
          if (node) node.style.translate = `${offset}px 0`;
        },
        'frame',
        ownerWindow,
      ),
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = foldPointer(session, event.clientX);
    if (session.intent === 'undecided') {
      if (Math.abs(dx) < DRAG_SLOP_PX) return;
      session.intent = 'drag';
      // 표식은 여기서 붙인다. 누르자마자 붙이면 단순 클릭에도 전환 규칙이 갈려
      // 기존 누름 감각을 건드린다
      session.track.setAttribute(DRAG_ATTR, '');
      lockTextSelection(session.ownerDocument, true);
    }
    session.offset = clamp(session.startOffset + dx, 0, session.travel);
    session.scheduler.push(session.offset);
    const next = session.offset >= session.travel / 2;
    if (next === session.displayed) return;
    session.displayed = next;
    setDragValue(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = foldPointer(session, event.clientX);
    // 표시값은 건드리지 않는다. 어차피 바로 목표로 확정된다
    if (session.intent === 'drag') {
      session.offset = clamp(session.startOffset + dx, 0, session.travel);
    }
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
