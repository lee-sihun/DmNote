/* eslint-disable no-console -- 콘솔에서 부르고 콘솔로 결과를 알리는 개발 도구 */
import { emit } from '@tauri-apps/api/event';
import { appApi } from '@api/modules/appApi';
import { setUpdateRuntimeForDev, useUpdateStore } from '@stores/useUpdateStore';
import { useSettingsStore } from '@stores/useSettingsStore';
import type { UpdateProgressEvent } from '@src/types/plugin/api';

/**
 * 업데이트 UI 시뮬레이터 (개발 전용)
 *
 * 실제 다운로드나 앱 교체 없이 업데이트 모달의 게이지·라벨 전이를 확인한다.
 * 진행 이벤트는 백엔드가 쓰는 것과 같은 이름으로 실제 이벤트 버스에 실어 보내므로,
 * 구독·상태 변환·렌더까지 실기와 같은 경로를 탄다. 대체하는 건 다운로드 커맨드와
 * 재시작 호출 두 개뿐이다
 *
 * 개발자 콘솔에서. 호출하면 모달만 뜨고, 진행은 업데이트 버튼을 눌러야 시작한다:
 *   __dmn_updateSim()               0~100 진행 후 재시작 라벨을 잠깐 보여주고 모달을 닫는다
 *   __dmn_updateSim('no-percent')   진행률 없는 다운로드 (서버가 크기를 안 줄 때)
 *   __dmn_updateSim('restart-fail') 설치는 됐지만 재시작 실패
 *   __dmn_updateSim('real-restart') 마지막에 진짜로 앱을 껐다 켠다
 *   __dmn_updateSim('fail')         100%까지 받은 뒤 실패
 *   __dmn_updateSimStop()           시뮬레이션 해제 (실제 업데이트 경로로 복귀)
 */
type Scenario =
  | 'default'
  | 'no-percent'
  | 'restart-fail'
  | 'real-restart'
  | 'fail';

declare global {
  interface Window {
    __dmn_updateSim?: (scenario?: Scenario) => void;
    __dmn_updateSimStop?: () => void;
    __dmn_updateScenario?: Scenario;
  }
}

// src-tauri/src/commands/app/update.rs의 UPDATE_PROGRESS_EVENT와 같은 이름
const PROGRESS_EVENT = 'update:progress';

const sleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// 시뮬레이션 세대. 중단·재시작 시 이전 루프가 이어서 이벤트를 쏘는 것을 막는다
let generation = 0;

const emitProgress = (payload: UpdateProgressEvent) =>
  emit(PROGRESS_EVENT, payload);

const playDownload = async (scenario: Scenario, alive: () => boolean) => {
  // 응답 헤더를 받기까지의 연결 시간
  await sleep(320);
  if (!alive()) return false;

  if (scenario === 'no-percent') {
    // 크기를 모르면 백엔드는 진행률 없는 신호를 한 번 보내고 그 뒤로 침묵한다
    await emitProgress({ phase: 'downloading', percent: null });
    await sleep(2600);
    return alive();
  }

  let percent = 0;
  for (;;) {
    await emitProgress({ phase: 'downloading', percent });
    if (percent >= 100) break;
    // 60% 언저리에서 멈칫하는 실제 다운로드 패턴 재현
    const stalling = percent >= 61 && percent <= 67;
    await sleep(stalling ? 900 : 110 + Math.random() * 170);
    if (!alive()) return false;
    percent = Math.min(100, percent + 2 + Math.floor(Math.random() * 5));
  }
  return alive();
};

const runScenario = async (scenario: Scenario) => {
  const mine = ++generation;
  const alive = () => mine === generation;

  if (!(await playDownload(scenario, alive))) return;

  if (scenario === 'fail') {
    throw new Error('simulated download failure');
  }

  await emitProgress({ phase: 'verifying', percent: null });
  await sleep(1150);
  if (!alive()) return;

  await emitProgress({ phase: 'installing', percent: null });
  await sleep(1750);
};

const install = () => {
  setUpdateRuntimeForDev({
    // 시나리오가 안 걸려 있으면 개발 빌드에서도 실제 업데이트 경로를 그대로 쓴다.
    // 여기서 무조건 가로채면 개발 중에는 진짜 업데이트를 한 번도 확인할 수 없다
    autoUpdate: async (tag: string) => {
      const scenario = window.__dmn_updateScenario;
      if (!scenario) {
        console.warn(
          '[UpdateSim] 시나리오가 걸려 있지 않다. 실제 릴리즈를 받아 실제로 설치한다',
        );
        return appApi.autoUpdate(tag);
      }
      await runScenario(scenario);
      return { previousVersion: '0.0.0', updatedTo: tag, downloadUrl: '' };
    },
    restart: async () => {
      const scenario = window.__dmn_updateScenario;
      if (!scenario) {
        console.warn(
          '[UpdateSim] 시나리오가 걸려 있지 않다. 실제로 재시작한다',
        );
        return appApi.restart();
      }
      if (scenario === 'restart-fail') {
        throw new Error('simulated restart failure');
      }
      if (scenario === 'real-restart') {
        // 재시작 라벨을 눈으로 확인할 틈을 준 뒤 진짜로 껐다 켠다
        await sleep(2000);
        return appApi.restart();
      }
      // 실제로 재시작하면 창이 사라져 화면 확인이 끊긴다. 라벨을 읽을 만큼만 붙잡고
      // 시뮬레이션 상태만 직접 닫는다 - 실제 경로의 restarting 잠금은 유지해야 한다
      await sleep(1800);
      console.info(
        '[UpdateSim] 실제로는 여기서 앱이 재시작된다. 모달을 닫고 시뮬레이션 상태는 유지한다',
      );
      // 시나리오는 유지한다. 실제 업데이트 경로 복귀는 Stop에서만 한다
      useUpdateStore.setState({
        dismissed: true,
        updateAvailable: false,
        isAutoUpdating: false,
        autoUpdatePhase: 'idle',
        autoUpdateProgress: null,
      });
    },
  });

  window.__dmn_updateSim = (scenario: Scenario = 'default') => {
    window.__dmn_updateScenario = scenario;
    generation += 1;

    if (scenario === 'real-restart') {
      // tauri dev는 앱이 종료되면 beforeDevCommand로 띄운 Vite까지 같이 내린다.
      // 새로 뜬 앱은 붙을 dev 서버가 없어 빈 창이 된다. 프로덕션 빌드에서는 안 생긴다
      console.warn(
        '[UpdateSim] 개발 서버에서는 재시작 후 빈 창이 뜬다. 앱이 종료되면서 Vite도 같이 내려가기 때문이고, 재시작 자체는 정상이다. 빈 창을 닫고 tauri:dev를 다시 실행하면 된다',
      );
    }

    if (!useSettingsStore.getState().autoUpdateEnabled) {
      console.warn(
        '[UpdateSim] 설정에서 자동 업데이트가 꺼져 있어 버튼이 릴리즈 페이지를 엽니다. 켜고 다시 시도하세요',
      );
    }

    const currentVersion = __APP_VERSION__;
    useUpdateStore.setState({
      updateAvailable: true,
      isLatestVersion: false,
      dismissed: false,
      isAutoUpdating: false,
      autoUpdatePhase: 'idle',
      autoUpdateProgress: null,
      error: null,
      updateInfo: {
        currentVersion,
        latestVersion: '99.0.0',
        releaseUrl: 'https://github.com/DmNote-App/DmNote/releases',
        releaseName: 'Simulated release',
        releaseNotes: '',
        publishedAt: new Date().toISOString(),
      },
    });
    console.info(`[UpdateSim] '${scenario}' 준비됨. 업데이트 버튼을 누르세요`);
  };

  window.__dmn_updateSimStop = () => {
    generation += 1;
    window.__dmn_updateScenario = undefined;
    setUpdateRuntimeForDev(null);
    // 작업 중에는 dismissUpdate가 닫기를 무시하므로 여기서는 직접 되돌린다
    useUpdateStore.setState({
      dismissed: true,
      updateAvailable: false,
      isLatestVersion: false,
      isAutoUpdating: false,
      autoUpdatePhase: 'idle',
      autoUpdateProgress: null,
    });
    console.info(
      '[UpdateSim] 해제됨. 다시 쓰려면 새로고침 후 __dmn_updateSim()',
    );
  };
};

export const installUpdateSimulator = () => {
  if (!import.meta.env.DEV) return;
  install();
};
