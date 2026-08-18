import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

// 클릭 → 상태 반영까지 허용하는 지연 (비동기 커맨드 왕복 포함)
const PRESS_WINDOW_MS = 300;

const INTERACTIVE_SELECTOR =
  'button, label, a, [role="button"], [role="switch"], [role="checkbox"], [tabindex]';

// 상태 토글 애니메이션의 발동 조건을 "직접 클릭"으로 제한하는 훅.
// ref 요소에서 가장 가까운 인터랙티브 조상의 클릭 시각을 기록하고,
// value가 클릭 없이 바뀌면 한 프레임 동안 data-dmn-instant를 부여해
// CSS transition을 전역 규칙(main.css)으로 차단.
// WAAPI 기반 컴포넌트는 isInstant()로 분기해 정적 상태를 바로 커밋.
// 시간창 휴리스틱의 한계: 300ms를 넘는 비동기 반영은 클릭이어도 즉시 전환,
// 클릭 직후 300ms 안의 외부 변경은 애니메이션 — 둘 다 미용적 실패라 수용
export const usePressGatedSwap = <T extends Element>(value: unknown) => {
  const ref = useRef<T>(null);
  const lastPressRef = useRef(Number.NEGATIVE_INFINITY);
  const instantRef = useRef(false);
  const prevValueRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 클릭 감지 표면: 인터랙티브 조상 + 행 단위 press 스코프.
    // 설정 행처럼 컨트롤 밖을 눌러 토글하는 표면은 data-dmn-press-scope로 옵트인
    const hosts = new Set(
      [
        el.closest(INTERACTIVE_SELECTOR),
        el.closest('[data-dmn-press-scope]'),
      ].filter((host): host is Element => host !== null),
    );
    if (hosts.size === 0) return;
    const mark = () => {
      lastPressRef.current = performance.now();
    };
    // click은 키보드 활성화(Enter/Space)도 커버
    hosts.forEach((host) => {
      host.addEventListener('pointerdown', mark);
      host.addEventListener('click', mark);
    });
    return () => {
      hosts.forEach((host) => {
        host.removeEventListener('pointerdown', mark);
        host.removeEventListener('click', mark);
      });
    };
  }, []);

  // 훅이 소비자보다 먼저 선언되므로 소비자 layout effect 시점엔 판정 완료
  useLayoutEffect(() => {
    if (prevValueRef.current === value) return;
    prevValueRef.current = value;
    instantRef.current =
      performance.now() - lastPressRef.current > PRESS_WINDOW_MS;

    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(rafRef.current);
    if (!instantRef.current) {
      el.removeAttribute('data-dmn-instant');
      return;
    }

    // 페인트에 한 번 반영된 뒤 제거 (더블 rAF) — 이후 클릭 전환은 다시 애니메이션
    el.setAttribute('data-dmn-instant', '');
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        el.removeAttribute('data-dmn-instant');
      });
    });
  }, [value]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const isInstant = useCallback(() => instantRef.current, []);

  // 이벤트로 못 잡는 직접 조작을 직접 찍는다. 드래그처럼 누른 시각과 값이 바뀌는
  // 시각이 시간창보다 벌어지는 제스처는 이걸 불러야 정착 모션이 산다
  const markPress = useCallback(() => {
    lastPressRef.current = performance.now();
  }, []);

  return { ref, isInstant, markPress };
};
