/**
 * 탭 드래그 세션
 * 툴바 바와 팝업 목록이 같은 세션을 공유한다. 어느 쪽에서 집든 어느 쪽에 놓든
 * 결과는 tabs_reorder 한 번이다
 *
 * 자리를 바꾸는 길은 교체 하나뿐이다. 끼워넣기가 없으니 바의 칸 수는 드래그로
 * 변하지 않고, 놓는 지점도 "어느 칩과 바꿀 것인가" 하나로 좁혀진다.
 * 칸 사이 간격이든 컨테이너 패딩이든 바 오른쪽 끝이든 가장 가까운 칩이 답이라
 * "여기서는 안 되는" 지점이 없다
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { keysApi } from '@api/modules/editor/keysApi';
import { useKeyStore } from '@stores/data/useKeyStore';
import { scrollLenisBy } from '@hooks/useLenis';
import { createDragBendMotion } from '@utils/animation/dragBendMotion';
import { MAX_FRAME_DT } from '@utils/animation/spring';
import { swapTabs, type TabPlacement } from '@utils/tabOrder';
import {
  activatePopupDragSession,
  beginPopupDragSession,
  endPopupDragSession,
} from '@utils/ui/popupDragSession';
import {
  TabDragContext,
  type TabDragOrientation,
  type TabDragZone,
} from './tabDragContext';

// 이만큼 움직여야 드래그로 본다. 그 전까지는 클릭
const DRAG_THRESHOLD = 4;
// 복귀 전이 길이와 맞춘다 (dragBendMotion 스펙)
const RETURN_DURATION_MS = 400;
// 응답 유실 시에도 권위 순서 유예가 영구히 잠기지 않게 하는 상한
const TAB_PLACEMENT_TIMEOUT_MS = 10_000;
// 착지 스쿼시 길이. main.css의 dmn-tab-land 키프레임과 같이 움직인다
const LAND_DURATION_MS = 380;
// 잡은 채 그리드 버튼 위에 머물면 팝업이 열린다
const OPENER_HOVER_MS = 260;
const DRAG_CURSOR_CLASS = 'dmn-dragging';
/* 목록 가장자리 자동 스크롤 - react-beautiful-dnd의 fluid scroller 규격을 따른다.
   임계를 컨테이너 크기의 비율로 두면 목록 높이가 바뀌어도 손볼 게 없다 */
// 가장자리에서 이 비율 안쪽에 들어오면 흐르기 시작한다
const EDGE_SCROLL_START_RATIO = 0.25;
// 이 비율 안쪽은 최대 속도로 평평하다. 끝에 픽셀 단위로 붙어야 빨라지면 못 쓴다
const EDGE_SCROLL_MAX_RATIO = 0.05;
/* 속도는 프레임이 아니라 초 단위다. 원본은 프레임당 28px인데 그대로 옮기면
   120Hz에서 같은 조작이 두 배 빨라진다. 값은 그 28px/frame(=1680px/s)을
   뷰포트 높이 대비 비율로 환산한 것 - 전속으로 보이는 만큼을 약 0.5초에 지난다 */
const EDGE_SCROLL_VIEWPORTS_PER_SEC = 2;
// 억제 구간에도 완전히 멈추지는 않는다. 원본의 최소 1px/frame과 같은 눈금
const EDGE_SCROLL_MIN_SPEED = 60;
// 잡자마자 가장자리에 있으면 목록이 튄다. 이 구간은 기어가다 서서히 붙는다
const EDGE_SCROLL_DAMPEN_FROM_MS = 360;
const EDGE_SCROLL_DAMPEN_TO_MS = 1200;
// 이 표식이 붙은 버튼에서 시작한 포인터는 드래그를 열지 않는다. 행 전체가
// 손잡이라 이름 변경·삭제까지 손잡이가 되면 살짝 흔들린 클릭이 드래그로 샌다
const ACTION_SELECTOR = '[data-tab-action]';

interface DropTarget {
  id: string;
  element: HTMLElement;
}

/* 교체가 끝나면 탭이 바와 팝업 사이를 건너간다. 새 자리의 마운트와 옛 자리의
   언마운트는 순서가 정해져 있지 않아서, id 하나로 키를 잡으면 언마운트의 삭제가
   방금 등록한 항목을 지울 수 있다. 영역까지 키에 넣으면 그 경합이 사라진다 */
const targetKey = (id: string, orientation: TabDragOrientation) =>
  `${id}:${orientation}`;

interface DragSession {
  id: string;
  element: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  /** 드래그가 시작된 시각. 자동 스크롤이 잡은 직후를 눌러 두는 데 쓴다 */
  startedAt: number;
  /** 지금 겨누고 있는 교체 상대 */
  targetId: string | null;
  ghost: HTMLElement | null;
}

/**
 * 잡은 칩은 원본이 아니라 body에 붙인 복제본이 움직인다.
 * 팝업 목록은 overflow·contain·마스크로 잘리기 때문에 원본을 그대로 끌면
 * 팝업 밖으로 못 나간다. z-index로는 해결이 안 된다 - 클리핑이라서
 */
const createGhost = (source: HTMLElement): HTMLElement => {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  ghost.removeAttribute('data-dragging');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.classList.add('dmn-tab-ghost');
  ghost.style.position = 'fixed';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = '0';
  ghost.style.pointerEvents = 'none';
  document.body.appendChild(ghost);
  return ghost;
};

/**
 * 드래그로 끝난 포인터가 만드는 click 하나를 그 자리서 삼킨다
 * 플래그로 들고 있다가 다음 클릭에서 소비하면, 클릭이 안 오는 드래그 뒤에
 * 엉뚱한 클릭(삭제 x 같은)이 대신 씹힌다
 */
const swallowNextClick = () => {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  // click은 pointerup과 같은 태스크에서 오므로 다음 태스크면 이미 지났다
  setTimeout(() => window.removeEventListener('click', swallow, true), 0);
};

const releasePointerCaptureSafely = (
  element: HTMLElement,
  pointerId: number,
) => {
  const releasePointerCapture = element.releasePointerCapture;
  if (!releasePointerCapture) return;
  try {
    releasePointerCapture.call(element, pointerId);
  } catch {
    // 이미 해제된 포인터
  }
};

const readPlacement = (): TabPlacement => {
  const state = useKeyStore.getState();
  return { order: state.tabOrder, barCount: state.barCount };
};

export const TabDragProvider = ({
  children,
  onRequestOpenPopup,
}: {
  children: React.ReactNode;
  onRequestOpenPopup?: () => void;
}) => {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [isOverOpener, setIsOverOpener] = useState(false);
  const tabOrder = useKeyStore((state) => state.tabOrder);

  const targetsRef = useRef(new Map<string, DropTarget>());
  const zonesRef = useRef(new Map<TabDragZone, HTMLElement>());
  const motionRef = useRef(createDragBendMotion());
  const sessionRef = useRef<DragSession | null>(null);
  // 연속 드래그에서 오래된 실패 응답이 더 최신 낙관 상태를 되돌리지 못하게 한다
  const commitSeqRef = useRef(0);
  // 복귀 중인 고스트를 각자 타이머와 함께 들고 있는다. 타이머 ref 하나를 돌려쓰면
  // 400ms 안에 두 번 빗나갔을 때 앞 타이머만 취소되고 앞 고스트가 body에 영구히 남는다
  const returningRef = useRef(
    new Map<HTMLElement, ReturnType<typeof setTimeout>>(),
  );
  const landTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 자동 스크롤 루프 핸들. 세션을 끝내는 쪽에서도 바로 끊을 수 있어야
  // 죽은 세션의 프레임이 한 번 더 도는 일이 없다
  const scrollRafRef = useRef(0);
  // 매 pointermove마다 setState를 때리지 않도록 마지막 값을 들고 있는다
  const openerHotRef = useRef(false);
  // 자동 스크롤 루프가 포인터를 안 움직여도 지금 위치를 알아야 한다
  const pointerRef = useRef({ x: 0, y: 0 });
  const openPopupRef = useRef(onRequestOpenPopup);
  // 프레임 루프가 최신 콜백을 보도록 렌더 후 갱신 (useGooeySpring과 같은 문법)
  useLayoutEffect(() => {
    openPopupRef.current = onRequestOpenPopup;
  });

  const dropGhost = useCallback((ghost: HTMLElement) => {
    const timer = returningRef.current.get(ghost);
    if (timer === undefined) return;
    clearTimeout(timer);
    returningRef.current.delete(ghost);
    ghost.remove();
    motionRef.current.cancel(ghost);
  }, []);

  const dropAllGhosts = useCallback(() => {
    for (const ghost of [...returningRef.current.keys()]) dropGhost(ghost);
  }, [dropGhost]);

  // 시작 시점에 한 번 재서 캐시하고 레이아웃 근거가 바뀔 때만 버린다
  const rectsRef = useRef(new Map<string, DOMRect>());
  const dropRects = useCallback(() => {
    rectsRef.current = new Map();
  }, []);

  // ref 콜백은 신원이 바뀌면 React가 매 렌더 해제·재등록한다. id별로 캐시해 고정한다
  const refCallbacksRef = useRef(
    new Map<string, (element: HTMLElement | null) => void>(),
  );
  const registerTarget = useCallback(
    (id: string, orientation: TabDragOrientation) => {
      const cacheKey = `${id}:${orientation}`;
      const cached = refCallbacksRef.current.get(cacheKey);
      if (cached) return cached;
      const callback = (element: HTMLElement | null) => {
        dropRects();
        if (element) targetsRef.current.set(cacheKey, { id, element });
        else targetsRef.current.delete(cacheKey);
      };
      refCallbacksRef.current.set(cacheKey, callback);
      return callback;
    },
    [dropRects],
  );

  const zoneCallbacksRef = useRef(
    new Map<TabDragZone, (element: HTMLElement | null) => void>(),
  );
  const registerZone = useCallback((zone: TabDragZone) => {
    const cached = zoneCallbacksRef.current.get(zone);
    if (cached) return cached;
    const callback = (element: HTMLElement | null) => {
      if (element) zonesRef.current.set(zone, element);
      else zonesRef.current.delete(zone);
    };
    zoneCallbacksRef.current.set(zone, callback);
    return callback;
  }, []);

  const snapshotRects = useCallback(() => {
    const rects = new Map<string, DOMRect>();
    for (const [key, target] of targetsRef.current) {
      rects.set(key, target.element.getBoundingClientRect());
    }
    rectsRef.current = rects;
  }, []);

  // 같은 탭 노드가 자리만 바뀌면 ref 콜백은 다시 불리지 않는다. 드래그 중 외부
  // 순서 변경이 DOM에 반영된 뒤 좌표 캐시를 버려 다음 판정에서 다시 측정
  useLayoutEffect(() => {
    if (sessionRef.current?.active) dropRects();
  }, [dropRects, tabOrder]);

  const rectOf = useCallback(
    (key: string) => {
      if (rectsRef.current.size !== targetsRef.current.size) snapshotRects();
      return rectsRef.current.get(key) ?? null;
    },
    [snapshotRects],
  );

  /** 포인터가 들어 있는 영역과 그 영역의 칩들 */
  const resolveScope = useCallback((x: number, y: number) => {
    for (const [zone, element] of zonesRef.current) {
      if (zone === 'opener') continue;
      const rect = element.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        continue;
      }
      const horizontal = zone === 'bar';
      const orientation: TabDragOrientation = horizontal
        ? 'horizontal'
        : 'vertical';
      const siblings = readPlacement().order.filter((id) =>
        targetsRef.current.has(targetKey(id, orientation)),
      );
      return { horizontal, orientation, siblings, rect };
    }
    return null;
  }, []);

  /**
   * 바꿀 상대를 정한다
   * 영역을 칩 수만큼의 칸으로 쪼개고 포인터가 든 칸의 주인을 고른다.
   * 칸 경계는 두 칩 사이 한가운데, 양 끝은 영역의 끝이다. 그래서 칸 사이 간격이나
   * 컨테이너 패딩에도 죽은 자리가 없으면서 남의 칩까지 넘보지 않는다 -
   * 간격이 4px이라 실질적으로는 그 칩 위에 있어야 켜진다
   */
  const resolveTarget = useCallback(
    (x: number, y: number, draggedId: string) => {
      const scope = resolveScope(x, y);
      if (!scope) return null;
      const { horizontal, orientation, siblings, rect: zone } = scope;
      const slots = siblings
        .map((id) => ({ id, rect: rectOf(targetKey(id, orientation)) }))
        .filter((slot): slot is { id: string; rect: DOMRect } => !!slot.rect);
      if (slots.length === 0) return null;

      const position = horizontal ? x : y;
      const endOf = (index: number) => {
        const next = slots[index + 1];
        if (!next) return horizontal ? zone.right : zone.bottom;
        const current = slots[index].rect;
        return horizontal
          ? (current.right + next.rect.left) / 2
          : (current.bottom + next.rect.top) / 2;
      };
      const picked =
        slots.find((_, index) => position <= endOf(index)) ??
        slots[slots.length - 1];
      return picked.id === draggedId ? null : picked.id;
    },
    [rectOf, resolveScope],
  );

  const commitSwap = useCallback((draggedId: string, targetId: string) => {
    const placement = readPlacement();
    const next = swapTabs(placement, draggedId, targetId);
    // 바뀌는 게 없으면 history를 만들지 않는다
    if (next === placement) return;
    const seq = ++commitSeqRef.current;
    const store = useKeyStore.getState();
    // 요청을 띄우기 직전 세대를 잡아둔다. 응답이 돌아왔을 때 세대가 올라 있으면
    // 그 사이 들어온 권위 이벤트가 더 새로우므로 응답은 통째로 버린다
    const generation = store.tabMetadataGeneration;
    store.setTabPlacement(next.order, next.barCount);
    // 요청이 큐에서 기다리는 동안 앞선 순서 변경의 customTabs:changed가 도착한다.
    // 그 스냅샷은 방금 놓은 자리보다 낡았으므로 순서 필드만 흘려보낸다
    store.beginTabPlacementMutation();
    let mutationReleased = false;
    let mutationTimer: ReturnType<typeof setTimeout> | null = null;
    const releaseMutation = () => {
      if (mutationReleased) return;
      mutationReleased = true;
      if (mutationTimer) clearTimeout(mutationTimer);
      mutationTimer = null;
      useKeyStore.getState().endTabPlacementMutation();
    };
    mutationTimer = setTimeout(releaseMutation, TAB_PLACEMENT_TIMEOUT_MS);
    // 배열이 아니라 연산을 보낸다. 기다리는 사이 다른 창에서 탭이 생기거나
    // 사라져도 이 교체는 여전히 유효하다
    void keysApi.tabs
      .swap(draggedId, targetId)
      .then((response) => {
        if (seq !== commitSeqRef.current || !response?.result) return;
        if (response.error) console.warn('탭 순서 변경 거절', response.error);
        // 성공에도 스냅샷이 실려 온다. 다만 커밋 시점 값이라 "지금"은 아니다 -
        // 그 사이 이벤트를 들었으면 스토어가 세대를 보고 이 스냅샷을 버린다
        useKeyStore.getState().setTabMetadata(response.result, generation);
      })
      .catch((error) => {
        const current = useKeyStore.getState();
        if (
          seq !== commitSeqRef.current ||
          current.tabMetadataGeneration !== generation
        ) {
          return;
        }
        console.error('Failed to reorder tabs', error);
        current.setTabPlacement(placement.order, placement.barCount);
      })
      .finally(releaseMutation);
  }, []);

  // 착지 스쿼시 클래스는 React가 붙인다. imperative로 붙이면 세션이 끝나며
  // draggingId가 바뀌어 className prop이 달라지고 React가 속성을 통째로 다시 써서 지운다.
  // data-dragging 제거만 imperative인데, 그건 React도 같은 값(없음)으로 수렴하는
  // 속성이라 서로 부딪히지 않는다. 고스트는 React 밖 노드라 전부 imperative다
  const endSession = useCallback(
    (targetId: string | null) => {
      const session = sessionRef.current;
      sessionRef.current = null;
      setDraggingId(null);
      setSwapTargetId(null);
      openerHotRef.current = false;
      setIsOverOpener(false);
      document.body.classList.remove(DRAG_CURSOR_CLASS);
      endPopupDragSession();
      if (openerTimerRef.current) clearTimeout(openerTimerRef.current);
      openerTimerRef.current = null;
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
      if (!session) return;
      // 캡처 해제가 실패해도 고스트 회수는 계속 진행
      releasePointerCaptureSafely(session.element, session.pointerId);
      if (!session.active) return;
      // 드래그였으면 뒤이어 오는 click은 탭 선택이 아니다
      swallowNextClick();
      const waitsForReturn = motionRef.current.release(targetId !== null);
      const ghost = session.ghost;

      if (targetId !== null) {
        // 고스트가 사라지는 프레임에 원본도 같이 진해져야 한다. 연한 색을 React
        // 상태로만 두면 리렌더가 한 프레임 늦게 붙는 경우가 있고, 그 프레임에는
        // 고스트도 없고 칩도 연한 채라 빈 자리가 번쩍인다
        session.element.removeAttribute('data-dragging');
        ghost?.remove();
        setLandedId(session.id);
        if (landTimerRef.current) clearTimeout(landTimerRef.current);
        landTimerRef.current = setTimeout(
          () => setLandedId(null),
          LAND_DURATION_MS,
        );
        return;
      }

      // 빗나갔으면 고스트가 제자리로 돌아가고 나서 사라진다
      if (!ghost) return;
      if (!waitsForReturn) {
        ghost.remove();
        motionRef.current.cancel(ghost);
        return;
      }
      ghost.classList.add('dmn-tab-returning');
      returningRef.current.set(
        ghost,
        setTimeout(() => dropGhost(ghost), RETURN_DURATION_MS),
      );
    },
    [dropGhost],
  );

  const beginDrag = useCallback(
    (id: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      if ((event.target as HTMLElement).closest?.(ACTION_SELECTOR)) return;
      // 두 번째 포인터가 세션을 덮어쓰면 앞 세션의 고스트를 가리키는 참조가
      // 사라져 body에 영구히 남는다. 앞 세션을 접고 시작한다
      if (sessionRef.current) endSession(null);
      sessionRef.current = {
        id,
        element: event.currentTarget,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        startedAt: 0,
        targetId: null,
        ghost: null,
      };
      beginPopupDragSession();
    },
    [endSession],
  );

  useEffect(() => {
    const motion = motionRef.current;
    const timers = [landTimerRef, openerTimerRef];

    const armOpener = (x: number, y: number) => {
      const opener = zonesRef.current.get('opener');
      const rect = opener?.getBoundingClientRect();
      const inside =
        !!rect &&
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom;
      if (openerHotRef.current !== inside) {
        openerHotRef.current = inside;
        setIsOverOpener(inside);
      }
      if (!inside) {
        if (openerTimerRef.current) clearTimeout(openerTimerRef.current);
        openerTimerRef.current = null;
        return;
      }
      if (openerTimerRef.current) return;
      // 스쳐 지나가는 것만으로 열리면 성가시다. 잠깐 머물러야 연다
      openerTimerRef.current = setTimeout(() => {
        openerTimerRef.current = null;
        openPopupRef.current?.();
      }, OPENER_HOVER_MS);
    };

    const syncTarget = (x: number, y: number) => {
      const session = sessionRef.current;
      if (!session) return;
      const targetId = resolveTarget(x, y, session.id);
      if (targetId === session.targetId) return;
      session.targetId = targetId;
      setSwapTargetId(targetId);
    };

    /**
     * 가장자리에 가져가면 목록이 흐른다
     * 포인터를 멈춰도 계속 흘러야 하므로 pointermove가 아니라 자기 루프로 돈다
     */
    let scrollClock = 0;
    const autoScroll = (now: number) => {
      const session = sessionRef.current;
      if (!session?.active) {
        scrollRafRef.current = 0;
        return;
      }
      const dt = Math.min(MAX_FRAME_DT, (now - scrollClock) / 1000);
      scrollClock = now;
      const zone = zonesRef.current.get('overflow');
      const room = zone ? zone.scrollHeight - zone.clientHeight : 0;
      if (zone && room > 1) {
        const rect = zone.getBoundingClientRect();
        const { x, y } = pointerRef.current;
        // 목록 안에 있을 때만 흐른다. 밖에서도 흐르게 두면 팝업 바로 아래
        // 그리드 버튼 위에서 팝업이 열리는 순간 "한참 아래"로 읽혀 끝까지 내려간다
        const inside =
          x >= rect.left &&
          x <= rect.right &&
          y >= rect.top &&
          y <= rect.bottom;
        const toTop = y - rect.top;
        const toBottom = rect.bottom - y;
        const down = toBottom < toTop;
        const distance = down ? toBottom : toTop;
        const size = rect.height;
        const startFrom = size * EDGE_SCROLL_START_RATIO;
        const canScroll = down ? zone.scrollTop < room - 1 : zone.scrollTop > 1;

        if (inside && canScroll && distance <= startFrom) {
          const maxAt = size * EDGE_SCROLL_MAX_RATIO;
          const maxSpeed = size * EDGE_SCROLL_VIEWPORTS_PER_SEC;
          // 최대 속도 구간 안쪽은 평평하고 그 바깥은 2차 곡선으로 붙는다
          const reach =
            distance <= maxAt
              ? 1
              : 1 - (distance - maxAt) / Math.max(1, startFrom - maxAt);
          let speed = maxSpeed * reach * reach;
          const runTime = now - session.startedAt;
          if (runTime < EDGE_SCROLL_DAMPEN_FROM_MS) {
            speed = EDGE_SCROLL_MIN_SPEED;
          } else if (runTime < EDGE_SCROLL_DAMPEN_TO_MS) {
            const warm =
              (runTime - EDGE_SCROLL_DAMPEN_FROM_MS) /
              (EDGE_SCROLL_DAMPEN_TO_MS - EDGE_SCROLL_DAMPEN_FROM_MS);
            speed = Math.max(speed * warm * warm, EDGE_SCROLL_MIN_SPEED);
          }
          scrollLenisBy(zone, (down ? 1 : -1) * speed * dt);
          // 행이 움직였으니 좌표를 다시 재고, 커서 밑에 새로 온 행을 겨눈다
          dropRects();
          syncTarget(x, y);
        }
      }
      scrollRafRef.current = requestAnimationFrame(autoScroll);
    };

    const handleMove = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      // 창 밖에서 버튼을 뗀 뒤 돌아오면 pointerup이 안 온다. 눌림이 풀린
      // 채로 움직이는 포인터가 그 신호다
      if (event.buttons === 0) {
        endSession(null);
        return;
      }
      pointerRef.current = { x: event.clientX, y: event.clientY };
      if (!session.active) {
        const moved = Math.hypot(
          event.clientX - session.startX,
          event.clientY - session.startY,
        );
        if (moved < DRAG_THRESHOLD) return;
        session.active = true;
        activatePopupDragSession();
        session.startedAt = performance.now();
        session.element.setPointerCapture?.(session.pointerId);
        scrollClock = performance.now();
        // 앞 세션의 프레임이 아직 예약돼 있으면 그게 그대로 이 세션의 루프가
        // 된다. 새로 잡으면 체인이 둘이 되어 스크롤이 두 배로 흐른다
        if (!scrollRafRef.current) {
          scrollRafRef.current = requestAnimationFrame(autoScroll);
        }
        session.ghost = createGhost(session.element);
        snapshotRects();
        document.body.classList.add(DRAG_CURSOR_CLASS);
        motion.start(session.ghost, { x: session.startX, y: session.startY });
        setDraggingId(session.id);
      }
      motion.move({ x: event.clientX, y: event.clientY });
      armOpener(event.clientX, event.clientY);
      syncTarget(event.clientX, event.clientY);
    };

    const handleUp = (event: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || event.pointerId !== session.pointerId) return;
      const targetId = session.active ? session.targetId : null;
      if (targetId) commitSwap(session.id, targetId);
      endSession(targetId);
    };

    const handleCancel = () => {
      if (sessionRef.current) endSession(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !sessionRef.current) return;
      endSession(null);
    };

    // 잡은 채 목록을 스크롤하면 행이 움직인다. 캡처 단계라 어느 컨테이너가
    // 스크롤되든 잡힌다

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    /* pointerup이 안 오는 경로가 셋 더 있다. 창이 포커스를 잃거나(창 밖 릴리스),
       캡처하던 행이 언마운트되거나(프리셋 로드, undo), 사용자가 무르거나.
       useDraggable·useSelectionDrag가 쓰는 것과 같은 안전망이다 */
    window.addEventListener('lostpointercapture', handleCancel);
    window.addEventListener('blur', handleCancel);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', dropRects, true);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('lostpointercapture', handleCancel);
      window.removeEventListener('blur', handleCancel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', dropRects, true);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
      for (const timer of timers) {
        if (timer.current) clearTimeout(timer.current);
      }
      document.body.classList.remove(DRAG_CURSOR_CLASS);
      endPopupDragSession();
      sessionRef.current?.ghost?.remove();
      dropAllGhosts();
      motion.cancel();
    };
  }, [
    commitSwap,
    dropAllGhosts,
    dropRects,
    endSession,
    resolveTarget,
    snapshotRects,
  ]);

  const value = useMemo(
    () => ({
      draggingId,
      landedId,
      isOverOpener,
      swapTargetId,
      beginDrag,
      registerTarget,
      registerZone,
    }),
    [
      draggingId,
      landedId,
      isOverOpener,
      swapTargetId,
      beginDrag,
      registerTarget,
      registerZone,
    ],
  );

  return (
    <TabDragContext.Provider value={value}>{children}</TabDragContext.Provider>
  );
};
