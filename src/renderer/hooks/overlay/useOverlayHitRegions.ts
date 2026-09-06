import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { subscribe } from '@api/modules/shared';
import {
  accumulatedTransformLinear,
  cornersMatchRect,
  hitRectsFromMeasurements,
  isIdentityLinear,
  transformedBoxCorners,
  type MeasuredHitBox,
  type TransformStyleReader,
} from '@utils/overlay/hitRegionShape';
import { borderBoxSize } from '@utils/dom/borderBoxSize';
import {
  sampleHitAnimations,
  type HitAnimationSamples,
} from '@utils/overlay/hitRegionAnimations';

export interface HitRegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// 리로드 후에도 이전 세션보다 큰 revision을 보내도록 시각 기반 시드.
// 시작 시 발급 상한(lease)을 미리 저장해 두므로, 크래시 시점과 무관하게
// 다음 세션은 항상 이번 세션이 발급했을 수 있는 최대값보다 크게 시작한다
// (시계 역행 포함). 측정마다 쓰기가 없는 crash-safe 단조성
const REVISION_STORAGE_KEY = 'dmnote:overlay-hit-revision';
const REVISION_LEASE_SPAN = 10_000_000;
// JS 안전 정수 경계이자 발급 포화점 - 도달 시 동일 revision이 반복되어
// 백엔드가 거부하는 fail-closed (Date.now 기준 수천 년 뒤의 이론적 한계)
const MAX_REVISION = Number.MAX_SAFE_INTEGER;

// 저장값 해석: 정상 lease 상한은 그대로 이어가고, 손상값만 시각 시드로 폴백
export const computeRevisionSeed = (
  storedRaw: string | null,
  now: number,
): number => {
  const stored = Number(storedRaw);
  if (
    Number.isSafeInteger(stored) &&
    stored > 0 &&
    stored < MAX_REVISION &&
    stored >= now
  ) {
    return stored + 1;
  }
  return now;
};

export const computeLeaseEnd = (base: number): number =>
  Math.min(base + REVISION_LEASE_SPAN, MAX_REVISION);

let revisionLeaseEnd = 0;

const reserveRevisionLease = (base: number) => {
  revisionLeaseEnd = computeLeaseEnd(base);
  try {
    window.localStorage.setItem(REVISION_STORAGE_KEY, String(revisionLeaseEnd));
  } catch {
    // 저장 실패는 무시 - 다음 리로드에서 시각 시드로 폴백
  }
};

// 네이티브 부모 창이 없는 OBS 브라우저 소스에서는 측정도 IPC도 무의미하다.
// 커맨드가 allowlist 밖이라 호출이 항상 거부되므로 측정 자체를 건너뛴다
const IS_OBS = typeof window !== 'undefined' && window.__dmn_runtime === 'obs';

// 히트 창을 쓰지 않는 OBS에서는 lease 저장도 하지 않는다
let hitRegionRevision = IS_OBS
  ? 0
  : (() => {
      let storedRaw: string | null = null;
      try {
        storedRaw = window.localStorage.getItem(REVISION_STORAGE_KEY);
      } catch {
        // localStorage 접근 실패 시 시각 시드만 사용
      }
      const seed = computeRevisionSeed(storedRaw, Date.now());
      reserveRevisionLease(seed);
      return seed;
    })();

const nextRevision = () => {
  if (hitRegionRevision < MAX_REVISION) {
    hitRegionRevision += 1;
  }
  if (hitRegionRevision >= revisionLeaseEnd) {
    reserveRevisionLease(hitRegionRevision);
  }
  return hitRegionRevision;
};

// 문서마다 1회 발급. 백엔드는 이 값이 현재 ready lease와 같을 때만 측정값을 채택한다.
// 리로드 전 문서의 늦은 응답이 새 문서 것으로 오인되는 경쟁을 막는다
const createSessionId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const RENDERER_SESSION_ID = createSessionId();

// 백엔드가 무효화할 때마다 올리는 세대. 이 값이 맞아야 측정값이 채택된다
let currentEpoch: number | null = null;

// 훅이 설치하는 재측정 트리거. 모듈 수준 복구 경로에서도 써야 한다
let requestMeasure: () => void = () => {};

// ready 재호출 폭주 방지. 거부가 반복돼도 초당 1회를 넘지 않는다
let announcing = false;
let lastAnnounceAt = 0;
const ANNOUNCE_MIN_INTERVAL_MS = 1_000;

// 준비 통보. 최초 handshake와 lease 회수 복구가 같은 경로를 쓴다
const announceRenderer = (): Promise<void> => {
  const now = Date.now();
  if (announcing || now - lastAnnounceAt < ANNOUNCE_MIN_INTERVAL_MS) {
    return Promise.resolve();
  }
  announcing = true;
  lastAnnounceAt = now;
  return invoke<{ epoch: number }>('overlay_hit_renderer_ready', {
    rendererSessionId: RENDERER_SESSION_ID,
  })
    .then((result) => {
      if (adoptEpoch(result.epoch)) requestMeasure();
    })
    .catch((error) => {
      console.warn('Failed to announce overlay hit renderer', error);
    })
    .finally(() => {
      announcing = false;
    });
};

// 동일 오류 반복만 억제 - 새로운 오류는 항상 노출
let lastSyncFailureMessage: string | null = null;
// 직전 발행 rect - 동일하면 IPC를 생략한다 (옵저버·이벤트 중복 트리거 흡수)
let lastSentRects: HitRegionRect[] | null = null;
// 배율도 발행 기준에 포함한다. rect는 CSS px라 배율만 바뀌면 값이 그대로인데,
// 백엔드는 이 배율로 물리 좌표를 만들기 때문에 생략하면 옛 배율에 갇힌다
let lastSentDpr: number | null = null;

const rectsEqual = (a: HitRegionRect[], b: HitRegionRect[]): boolean =>
  a.length === b.length &&
  a.every((rect, index) => {
    const other = b[index];
    return (
      rect.x === other.x &&
      rect.y === other.y &&
      rect.width === other.width &&
      rect.height === other.height
    );
  });

// 발행 여부 판정. rect와 배율을 함께 봐야 한다 - rect는 CSS px라 배율만 바뀌면
// 값이 그대로인데, 백엔드는 이 배율로 물리 좌표를 만든다
export const shouldPublishHitRegions = (
  lastRects: HitRegionRect[] | null,
  lastDpr: number | null,
  rects: HitRegionRect[],
  devicePixelRatio: number,
): boolean =>
  !lastRects || lastDpr !== devicePixelRatio || !rectsEqual(lastRects, rects);

// 역행하는 epoch는 무시한다. handshake 응답과 resync 요청이 엇갈려 도착할 수 있다
const adoptEpoch = (epoch: number): boolean => {
  if (
    !Number.isSafeInteger(epoch) ||
    (currentEpoch !== null && epoch < currentEpoch)
  ) {
    return false;
  }
  currentEpoch = epoch;
  // 재동기화의 핵심 - 좌표가 같아도 반드시 다시 보내도록 기준선을 지운다
  lastSentRects = null;
  lastSentDpr = null;
  return true;
};

const syncHitRegions = (rects: HitRegionRect[]) => {
  // handshake 전에는 유효한 epoch가 없다. 보내도 거부되므로 보류하고,
  // epoch를 받는 즉시 재측정이 걸린다
  if (currentEpoch === null) return;
  // 보정 줌이 곱해진 실측 배율 - 백엔드가 DPI로 대신 계산할 수 없다
  const devicePixelRatio = window.devicePixelRatio;
  if (
    !shouldPublishHitRegions(
      lastSentRects,
      lastSentDpr,
      rects,
      devicePixelRatio,
    )
  ) {
    return;
  }
  lastSentRects = rects;
  lastSentDpr = devicePixelRatio;
  invoke<{ accepted: boolean }>('overlay_sync_hit_regions', {
    payload: {
      rects,
      revision: nextRevision(),
      devicePixelRatio,
      epoch: currentEpoch,
      rendererSessionId: RENDERER_SESSION_ID,
    },
  })
    .then((result) => {
      lastSyncFailureMessage = null;
      // 거부는 lease나 세대가 어긋났다는 뜻이다. 준비를 다시 알려 되찾는다.
      // 이걸 안 하면 요청과 거부가 무한 반복되며 히트 창이 영영 안 살아난다
      if (result && !result.accepted) {
        lastSentRects = null;
        lastSentDpr = null;
        void announceRenderer();
      }
    })
    .catch((error) => {
      // 실패한 발행은 기준선으로 남기지 않는다 - 같은 rect 재시도가 막히면
      // 히트 창이 영영 옛 배치에 머무른다
      lastSentRects = null;
      lastSentDpr = null;
      const message = String(error);
      if (message === lastSyncFailureMessage) return;
      lastSyncFailureMessage = message;
      console.warn('Failed to sync overlay hit regions', error);
    });
};

// 배율 변경은 CSS px 레이아웃을 바꾸지 않아 ResizeObserver도 resize 이벤트도 발화하지 않는다.
// 현재 배율에 고정한 미디어 쿼리를 걸어 두고, 깨지는 순간 다시 걸며 재측정을 알린다
const watchDevicePixelRatio = (onChange: () => void): (() => void) => {
  let query: MediaQueryList | null = null;
  let disposed = false;

  function handleChange() {
    arm();
    onChange();
  }

  function arm() {
    if (disposed) return;
    query?.removeEventListener('change', handleChange);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', handleChange);
  }

  // 테스트 환경 등 matchMedia가 없는 곳에서는 감시를 건너뛴다.
  // 발행 기준에 배율이 들어가 있어 다음 재측정에서 어차피 따라잡는다
  if (typeof window.matchMedia !== 'function') {
    return () => {};
  }

  arm();
  return () => {
    disposed = true;
    query?.removeEventListener('change', handleChange);
    query = null;
  };
};

const HIT_NODE_SELECTOR = '[data-overlay-hit="true"]';

const hitNodes = (): HTMLElement[] =>
  // 오버레이에서 드래그·우클릭을 받을 모든 표시 요소의 공용 표식
  Array.from(document.querySelectorAll<HTMLElement>(HIT_NODE_SELECTOR));

const containsHitNode = (node: Node): boolean => {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  return (
    element.matches(HIT_NODE_SELECTOR) ||
    element.querySelector(HIT_NODE_SELECTOR) !== null
  );
};

const mutationAffectsHitNodes = (records: MutationRecord[]): boolean =>
  records.some((record) => {
    if (record.type === 'attributes') {
      return (
        record.attributeName === 'data-overlay-hit' ||
        containsHitNode(record.target)
      );
    }
    return (
      Array.from(record.addedNodes).some(containsHitNode) ||
      Array.from(record.removedNodes).some(containsHitNode)
    );
  });

const measureHitRects = (nodes: HTMLElement[]): HitRegionRect[] => {
  const boxes: MeasuredHitBox[] = [];
  // 키들이 같은 조상을 공유하므로 한 번의 측정 안에서 스타일은 요소당 한 번만 읽는다
  const styles = new Map<Element, ReturnType<TransformStyleReader>>();
  const readStyle: TransformStyleReader = (element) => {
    const cached = styles.get(element);
    if (cached) return cached;
    const style = getComputedStyle(element);
    const read = {
      transform: style.transform,
      rotate: style.rotate,
      scale: style.scale,
      zoom: style.zoom,
      offsetPath: style.offsetPath,
    };
    styles.set(element, read);
    return read;
  };
  nodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const aabb = {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
    // 회전·배율이 걸린 요소는 AABB가 빈 모서리까지 잡는다. 문서 루트까지 누적한
    // 변환으로 화면 꼭짓점을 복원해 띠로 쪼개면 히트 창 계약(사각형 목록)을 그대로
    // 쓰면서 모양을 따른다. 복원할 수 없는 변환(3D·zoom)은 AABB로 남긴다
    const linear = accumulatedTransformLinear(node, readStyle);
    if (!linear || isIdentityLinear(linear)) {
      boxes.push({ aabb, corners: null });
      return;
    }
    const size = borderBoxSize(node, getComputedStyle(node));
    if (size.width <= 0 || size.height <= 0) {
      boxes.push({ aabb, corners: null });
      return;
    }
    const corners = transformedBoxCorners(
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      size.width,
      size.height,
      linear,
    );
    // 복원한 꼭짓점이 실측 AABB와 어긋나면 읽지 못한 변환(원근·z 이동)이 있다는 뜻
    boxes.push({
      aabb,
      corners: cornersMatchRect(corners, aabb) ? corners : null,
    });
  });
  return hitRectsFromMeasurements(boxes);
};

/**
 * 표시 요소 rect를 실측해 백엔드 히트 창과 동기화
 *
 * `generation`(레이아웃 계산 결과)이 바뀌면 노드 집합을 다시 모으고 옵저버를
 * 재등록한다. 실제 재측정은 ResizeObserver와 CSS 변경 이벤트가 몰아주므로,
 * 폰트 로드·커스텀 CSS/JS·플러그인 스타일처럼 레이아웃 계산 밖에서 요소 크기가
 * 변하는 경로까지 원인 열거 없이 덮인다. 같은 rect면 IPC는 생략된다
 */
export const useOverlayHitRegions = (generation: unknown) => {
  const scheduleRef = useRef<() => void>(() => {});

  // CSS 변경 구독은 마운트 수명 - generation마다 재등록하면
  // IPC 처닝과 재등록 구간의 이벤트 유실이 생김
  useEffect(() => {
    if (IS_OBS) return;
    let cancelled = false;
    const notify = () => scheduleRef.current();
    // 백엔드가 측정값을 버렸을 때 오는 요청. 좌표가 같아도 반드시 다시 보낸다
    const resync = subscribe<{ epoch: number; reason: string }>(
      'overlay:hit-resync',
      ({ epoch }) => {
        if (adoptEpoch(epoch)) notify();
      },
    );
    const unsubscribers = [
      resync,
      subscribe('css:use', notify),
      subscribe('css:content', notify),
      // 탭 스코프 CSS는 별도 채널로 전달됨
      subscribe('tabCss:changed', notify),
    ];

    // 리스너 등록이 끝난 뒤에 준비를 알린다. 먼저 부르면 백엔드의 첫 요청을 놓친다
    void resync.ready.then(() => {
      if (cancelled) return;
      return announceRenderer();
    });

    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  useEffect(() => {
    if (IS_OBS) return;
    let cancelled = false;
    let raf = 0;
    let animationRaf = 0;
    let animationTargetsDirty = true;
    const animationTargets = new Set<Element>();
    let animationSamples: HitAnimationSamples = new Map();
    const observer = new ResizeObserver(() => scheduleMeasure());
    const observedNodes = new Set<HTMLElement>();
    const mutationObserver = new MutationObserver((records) => {
      if (!mutationAffectsHitNodes(records)) return;
      if (records.some((record) => record.type === 'childList')) {
        animationTargetsDirty = true;
      }
      scheduleMeasure();
    });

    // rAF 1회로 coalesce - 페인트 확정 후 실측.
    // 노드 집합을 매번 다시 모아 커스텀 JS·플러그인이 키를 추가·제거한 경우도 덮는다
    const scheduleMeasure = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (cancelled) return;
        const nodes = hitNodes();
        const nextNodes = new Set(nodes);
        for (const node of observedNodes) {
          if (nextNodes.has(node)) continue;
          observer.unobserve(node);
          observedNodes.delete(node);
          animationTargetsDirty = true;
        }
        for (const node of nodes) {
          if (observedNodes.has(node)) continue;
          try {
            observer.observe(node, { box: 'border-box' });
          } catch {
            observer.observe(node);
          }
          observedNodes.add(node);
          animationTargetsDirty = true;
        }
        if (animationTargetsDirty) {
          animationTargets.clear();
          for (const node of nodes) {
            let target: Element | null = node;
            while (target && !animationTargets.has(target)) {
              animationTargets.add(target);
              target = target.parentElement;
            }
          }
          animationTargetsDirty = false;
        }
        syncHitRegions(measureHitRects(nodes));
      });
    };

    // WAAPI 시작에는 DOM 이벤트가 없으므로 재생 목록은 매 프레임 확인
    // 실제 기하 측정은 히트 루트·조상의 기하 애니메이션이 바뀔 때만 실행
    const watchAnimations = () => {
      if (cancelled) return;
      if (animationTargets.size > 0) {
        const { samples, changed } = sampleHitAnimations(
          document.getAnimations(),
          animationTargets,
          animationSamples,
        );
        animationSamples = samples;
        if (changed) scheduleMeasure();
      }
      animationRaf = requestAnimationFrame(watchAnimations);
    };
    if (typeof document.getAnimations === 'function') {
      animationRaf = requestAnimationFrame(watchAnimations);
    }

    // 목록 조회를 지원하지 않는 웹뷰도 종료·취소 시 최종 배치는 반영
    const animationEvents = [
      'animationend',
      'animationcancel',
      'transitionend',
      'transitioncancel',
    ];
    const handleAnimation = (event: Event) => {
      if (event.target instanceof Element && containsHitNode(event.target)) {
        scheduleMeasure();
      }
    };
    animationEvents.forEach((event) =>
      document.addEventListener(event, handleAnimation),
    );

    scheduleRef.current = scheduleMeasure;
    requestMeasure = scheduleMeasure;
    const unwatchScale = watchDevicePixelRatio(scheduleMeasure);
    // 미디어 쿼리가 발화하지 않는 웹뷰를 대비한 두 번째 그물.
    // 발행 기준에 배율이 들어 있으므로 헛호출은 IPC로 이어지지 않는다
    window.addEventListener('resize', scheduleMeasure);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-overlay-hit', 'style', 'class', 'data-state'],
      childList: true,
      subtree: true,
    });
    scheduleMeasure();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(animationRaf);
      observer.disconnect();
      mutationObserver.disconnect();
      animationEvents.forEach((event) =>
        document.removeEventListener(event, handleAnimation),
      );
      unwatchScale();
      window.removeEventListener('resize', scheduleMeasure);
      requestMeasure = () => {};
      scheduleRef.current = () => {};
    };
  }, [generation]);
};

// 히트 창 우클릭 → 기존 네이티브 메뉴 브릿지
export const subscribeHitContextMenu = (
  listener: (pos: { x: number; y: number }) => void,
) => subscribe<{ x: number; y: number }>('overlay-hit-context-menu', listener);
