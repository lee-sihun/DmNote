import { useEffect, useState } from 'react';
import {
  hasEnabledPlugins,
  isLocalPluginRuntimeReady,
  isMainPluginsReady,
  subscribePluginReadiness,
} from '@plugins/runtime/pluginRuntimeReadiness';

// 조건이 끝내 충족되지 않아도 오버레이가 영구히 빈 화면으로 남지 않게 하는 상한
const REVEAL_DEADLINE_MS = 2500;

// 플러그인 요소까지 나올 준비가 끝났는지 - 활성 플러그인이 없으면 메인을 기다리지 않는다
const arePluginsSettled = (): boolean =>
  isLocalPluginRuntimeReady() && (!hasEnabledPlugins() || isMainPluginsReady());

/**
 * 오버레이 초기 리빌 게이트
 *
 * 일반 요소는 부트스트랩 직후 나오는 반면 플러그인 요소는 메인의 주입·복구를 거쳐
 * 수백 ms 뒤에 도착해, 늦게 뜨는 요소와 뒤따르는 창 리사이즈가 덜컥거림으로 보인다.
 * 모든 요소가 자리 잡은 뒤 한 번에 보이도록 첫 페인트를 늦춘다 (1회성).
 */
export function useOverlayReveal(
  isBootstrapped: boolean,
  resizePending: boolean,
): boolean {
  const [revealed, setRevealed] = useState(false);
  const [pluginsSettled, setPluginsSettled] = useState(arePluginsSettled);

  useEffect(() => {
    if (pluginsSettled) return;

    const update = () => {
      if (arePluginsSettled()) setPluginsSettled(true);
    };
    // 구독 사이에 전환된 준비 상태를 놓치지 않도록 즉시 1회 확인
    update();
    return subscribePluginReadiness(update);
  }, [pluginsSettled]);

  // 부트스트랩 실패·플러그인 미도착에도 화면이 열리도록 하는 마지막 방어선
  useEffect(() => {
    if (revealed) return;
    const timer = setTimeout(() => setRevealed(true), REVEAL_DEADLINE_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  useEffect(() => {
    if (revealed) return;
    if (!isBootstrapped || !pluginsSettled || resizePending) return;

    // 레이아웃 반영과 창 리사이즈가 커밋된 다음 프레임에 공개
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setRevealed(true));
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [revealed, isBootstrapped, pluginsSettled, resizePending]);

  return revealed;
}
