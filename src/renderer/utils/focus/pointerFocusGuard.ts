// 마우스 클릭이 남기는 "활성화 가능한 잔류 포커스" 무해화 가드.
//
// 키를 상시 누르는 앱 특성상 클릭 포커스가 버튼류에 남으면 다음 Space/Enter가
// 그 컨트롤을 재활성화하고(효과음 선택 해제 등), 첫 키 입력에 :focus-visible로
// 승격돼 포커스 링이 뒤늦게 나타난다. macOS 네이티브(클릭은 버튼에 포커스를
// 주지 않음)와 같은 결과를 만들되 Tab 키보드 접근은 그대로 유지한다.
//
// 판정은 시간 창이 아니라 pointer session이다. pointerdown의 대상을 기억해 두고
// activation(click)이 끝난 뒤 최종 activeElement가 그 대상과 같은 갈래일 때만
// 무해화한다. 같은 클릭 흐름의 프로그램적 포커스 이동(Dropdown 옵션 로빙,
// Modal 초기 포커스)은 대상이 달라 건드리지 않는다

type PointerFocusPolicy = 'release' | 'retain';
type InputModality = 'pointer' | 'keyboard';

// 요소 단위 정책 재정의 - 마우스로 잡은 뒤 방향키 미세 조정이 설계된 컨트롤은 retain
export const POINTER_FOCUS_ATTR = 'data-dmn-pointer-focus';

// 텍스트 캐럿·키 편집이 필요한 input 타입만 클릭 포커스 유지
const TEXT_ENTRY_INPUT_TYPES = new Set([
  'text',
  'search',
  'number',
  'password',
  'email',
  'url',
  'tel',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
]);

const RETAIN_SELECTOR =
  'textarea, select, [contenteditable]:not([contenteditable="false"])';

const RELEASE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="slider"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].join(', ');

// 마지막 입력 수단 - 창이 여러 개여도 사용자는 한 명이라 모듈 전역
let lastInputModality: InputModality = 'keyboard';

export const getLastInputModality = (): InputModality => lastInputModality;

const resolvePointerFocusPolicy = (
  element: Element,
): PointerFocusPolicy | null => {
  const override = element.closest(`[${POINTER_FOCUS_ATTR}]`);
  if (override) {
    const value = override.getAttribute(POINTER_FOCUS_ATTR);
    if (value === 'retain' || value === 'release') return value;
  }
  if (element.matches('input')) {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    return TEXT_ENTRY_INPUT_TYPES.has(type) ? 'retain' : 'release';
  }
  if (element.matches(RETAIN_SELECTOR)) return 'retain';
  if (element.matches(RELEASE_SELECTOR)) return 'release';
  return null;
};

// 팝업 닫힘 복원(useFocusRestore 등)이 버튼류 opener를 마우스 흐름에서
// 다시 잡지 않게 하는 판정 공유
export const isPointerFocusRelease = (element: Element): boolean =>
  resolvePointerFocusPolicy(element) === 'release';

interface PointerFocusSession {
  pointerId: number;
  target: Element;
}

interface GuardEntry {
  count: number;
  uninstall: () => void;
}

const installedDocs = new WeakMap<Document, GuardEntry>();

// click이 오지 않는 경로(창 밖 릴리스, stopPropagation) 폴백 지연
const CLICKLESS_RELEASE_DELAY_MS = 80;

const install = (doc: Document): (() => void) => {
  const view = doc.defaultView;
  if (!view) return () => {};

  let session: PointerFocusSession | null = null;
  let timer: number | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      view.clearTimeout(timer);
      timer = null;
    }
  };

  const discardSession = () => {
    session = null;
    cancelTimer();
  };

  const evaluate = () => {
    const current = session;
    session = null;
    if (!current) return;
    const active = doc.activeElement;
    if (!active || active === doc.body || active === doc.documentElement) {
      return;
    }
    // 브라우저 기본 포커스는 눌린 지점의 가장 가까운 포커스 가능 조상에 앉는다 -
    // 눌린 대상과 같은 갈래일 때만 클릭 유래 포커스로 본다. 그새 Tab으로 옮겨간
    // 포커스는 대상과 무관해져 여기서 걸러진다.
    // label 안을 누르면 포커스는 연결된 형제 input에 위임돼 앉는다 - label 기준 보강
    const target = current.target;
    if (!target.isConnected) return;
    const label = target.closest('label');
    const related =
      active === target ||
      active.contains(target) ||
      target.contains(active) ||
      (label !== null &&
        (label.contains(active) ||
          (label as HTMLLabelElement).control === active));
    if (!related) return;
    if (resolvePointerFocusPolicy(active) !== 'release') return;
    // 모달·팝업 안에서는 body로 떨어뜨리지 않고 레이어 표면(tabIndex=-1)의
    // 중립 지점으로 - 포커스가 다이얼로그 밖으로 나가면 트랩 전제와 Tab 재개
    // 위치가 깨진다. tabindex 없는 표면(Dropdown 메뉴)은 focus가 안 앉으니 blur
    const scope = active.closest(
      '[data-dmn-modal-backdrop="true"], [data-dmn-popup-layer="true"]',
    );
    if (
      scope &&
      scope !== active &&
      scope.hasAttribute('tabindex') &&
      typeof (scope as HTMLElement).focus === 'function'
    ) {
      (scope as HTMLElement).focus({ preventScroll: true });
      return;
    }
    (active as HTMLElement).blur?.();
  };

  const schedule = (delay: number) => {
    cancelTimer();
    timer = view.setTimeout(() => {
      timer = null;
      evaluate();
    }, delay);
  };

  const onPointerDown = (event: PointerEvent) => {
    lastInputModality = 'pointer';
    if (event.isPrimary === false) return;
    cancelTimer();
    const target = event.target as Element | null;
    session =
      target && target.nodeType === 1
        ? { pointerId: event.pointerId ?? 0, target }
        : null;
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!session || session.pointerId !== (event.pointerId ?? 0)) return;
    schedule(CLICKLESS_RELEASE_DELAY_MS);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!session || session.pointerId !== (event.pointerId ?? 0)) return;
    discardSession();
  };

  // capture 단계라 중간 stopPropagation과 무관하게 닿는다. setTimeout(0)은
  // click 디스패치 태스크(핸들러 + React 동기 flush) 종료 후 실행되므로
  // 팝업이 열리며 수행한 opener 캡처·초기 포커스가 끝난 상태에서 최종 판정
  const onClick = () => {
    if (!session) return;
    schedule(0);
  };

  // 캡처 드래그가 창 밖에서 끝나 click이 안 오는 경로의 추가 종료 신호
  const onLostPointerCapture = (event: PointerEvent) => {
    if (!session || session.pointerId !== (event.pointerId ?? 0)) return;
    schedule(CLICKLESS_RELEASE_DELAY_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 단축키 조합은 탐색 의도가 아님 (:focus-visible 휴리스틱과 동일)
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // 클릭·드래그 중 키 입력은 :focus-visible 승격 전에 즉시 무해화
    if (session) {
      const focused = doc.activeElement;
      evaluate();
      // 이벤트 경로는 디스패치 시점 고정 - blur해도 이 키는 원래 타깃의
      // 핸들러에 닿는다. 방금 무해화한 컨트롤로 가던 키는 여기서 흡수
      if (
        focused &&
        doc.activeElement !== focused &&
        event.target === focused
      ) {
        event.stopPropagation();
        event.preventDefault();
      }
    }
    lastInputModality = 'keyboard';
  };

  const onWindowBlur = () => {
    discardSession();
  };

  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointerup', onPointerUp, true);
  doc.addEventListener('pointercancel', onPointerCancel, true);
  doc.addEventListener('lostpointercapture', onLostPointerCapture, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('keydown', onKeyDown, true);
  view.addEventListener('blur', onWindowBlur);

  return () => {
    discardSession();
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerCancel, true);
    doc.removeEventListener('lostpointercapture', onLostPointerCapture, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    view.removeEventListener('blur', onWindowBlur);
  };
};

// 문서당 1회 설치 - 메인 창과 패널 호스트가 같은 문서를 공유해도 중복 리스너 없음
export const installPointerFocusGuard = (doc: Document): (() => void) => {
  const existing = installedDocs.get(doc);
  if (existing) {
    existing.count += 1;
  } else {
    installedDocs.set(doc, { count: 1, uninstall: install(doc) });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = installedDocs.get(doc);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count <= 0) {
      installedDocs.delete(doc);
      entry.uninstall();
    }
  };
};
