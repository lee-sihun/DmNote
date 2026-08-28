// @id key-interval

/**
 * Key Interval Meter Plugin
 *
 * 리듬게임용 키 입력 간격 측정 플러그인입니다.
 * 동시치기(동치) 감지를 지원하며, 임계값을 설정창에서 조절할 수 있습니다.
 *
 * 동치 로직:
 * - 마지막 키 입력으로부터 설정된 임계값(기본 15ms) 이내에 다른 키가 눌리면 "동치"로 판정
 * - 동치는 간격 계산에서 하나의 타이밍으로 취급됨
 * - 임계값 이후에 눌린 키는 새로운 노트로 간주하여 간격 계산에 포함
 */

dmn.plugin.defineElement({
  name: "Key Interval Meter",
  maxInstances: 1,

  contextMenu: {
    create: "menu.create",
    delete: "menu.delete",
    items: [
      {
        label: "menu.reset",
        onClick: ({ actions }) => actions.reset(),
      },
    ],
  },

  messages: {
    en: {
      "menu.create": "Create Key Interval Meter",
      "menu.delete": "Delete Key Interval Meter",
      "menu.reset": "Reset Statistics",
      "settings.chordThreshold": "Chord Threshold (ms)",
      "settings.idleTimeout": "Idle Reset Time (sec)",
      "settings.showLog": "Show Chord Log",
      "settings.bgColor": "Background Color",
      "label.ms": "ms",
      "label.keys": "keys",
      "label.chord": "chord",
      "label.first": "First",
      "settings.scale": "Scale",
    },
    ko: {
      "menu.create": "키 간격 측정기 생성",
      "menu.delete": "키 간격 측정기 삭제",
      "menu.reset": "통계 초기화",
      "settings.chordThreshold": "동시치기 임계값 (ms)",
      "settings.idleTimeout": "자동 초기화 시간 (초)",
      "settings.showLog": "동치 로그 표시",
      "settings.bgColor": "배경 색상",
      "label.ms": "ms",
      "label.keys": "키",
      "label.chord": "동치",
      "label.first": "첫 입력",
      "settings.scale": "배율",
    },
  },

  settings: {
    chordThreshold: {
      type: "number",
      default: 15,
      min: 1,
      max: 50,
      step: 1,
      label: "settings.chordThreshold",
    },
    idleTimeout: {
      type: "number",
      default: 7,
      min: 3,
      max: 30,
      step: 1,
      label: "settings.idleTimeout",
    },
    showLog: {
      type: "boolean",
      default: true,
      label: "settings.showLog",
    },
    bgColor: {
      type: "color",
      default: "rgba(17, 17, 20, 0.9)",
      label: "settings.bgColor",
    },
    scale: {
      type: "number",
      default: 1,
      min: 0.5,
      max: 3.0,
      step: 0.1,
      label: "settings.scale",
    },
  },

  template: (state, settings, { html, t }) => {
    const {
      currentInterval = null,
      chordSize = 0,
      chordLog = [],
    } = state;

    const {
      bgColor = "rgba(17, 17, 20, 0.95)",
      showLog = true,
      scale = 1,
    } = settings;

    // 기본 크기 값들
    const baseWidth = 244;
    const baseHeight = 101;
    const basePadding = 8;
    const baseGap = 10;
    const baseBorderRadius = 8;
    const baseLogWidth = 90;
    const baseLogGap = 2;
    const baseLogFontSize = 10;
    const baseLogLineHeight = 12;
    const baseDividerHeight = 60;
    const baseIntervalWidth = 75;
    const baseKeysWidth = 40;
    const baseLargeFontSize = 24;
    const baseSmallFontSize = 10;
    const baseMarginTop = 2;
    const baseLogTextGap = 4;

    const containerStyle = `
      background: ${bgColor};
      color: #fff;
      border-radius: ${baseBorderRadius * scale}px;
      padding: ${basePadding * scale}px;
      width: ${baseWidth * scale}px;
      height: ${baseHeight * scale}px;
      box-sizing: border-box;
      backdrop-filter: blur(4px);
      font-family: Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      cursor: pointer;
      user-select: none;
      display: flex;
      gap: ${baseGap * scale}px;
      align-items: center;
    `;

    // 로그 렌더링 (왼쪽, 고정 6줄)
    const renderLog = () => {
      if (!showLog) return "";

      // 항상 6줄 표시 (빈 줄은 placeholder)
      const displayLog = [...chordLog];
      while (displayLog.length < 6) {
        displayLog.push(null);
      }

      return html`
        <div style="
          width: ${baseLogWidth * scale}px;
          display: flex;
          flex-direction: column;
          gap: ${baseLogGap * scale}px;
          font-size: ${baseLogFontSize * scale}px;
          font-family: Pretendard, -apple-system, BlinkMacSystemFont, sans-serif;
        ">
          ${displayLog.map((log, i) => html`
            <div style="
              display: flex;
              gap: ${baseLogTextGap * scale}px;
              opacity: ${log ? (1 - i * 0.12) : 0.2};
              white-space: nowrap;
              height: ${baseLogLineHeight * scale}px;
              line-height: ${baseLogLineHeight * scale}px;
            ">
              ${log 
                ? html`
                    <span style="color: #fff;">[${log.interval !== null ? log.interval + 'ms' : t("label.first")}]</span>
                    <span style="color: #fff;">${log.keys} ${t("label.chord")}</span>
                  `
                : html`<span style="color: #fff;">-</span>`
              }
            </div>
          `)}
        </div>
      `;
    };

    return html`
      <link
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css"
        rel="stylesheet"
      />
      <div style=${containerStyle}>
        <!-- 동치 로그 (왼쪽) -->
        ${renderLog()}

        ${showLog ? html`
          <!-- 구분선 -->
          <div style="width: ${1 * scale}px; height: ${baseDividerHeight * scale}px; background: rgba(255, 255, 255, 0.1);"></div>
        ` : ""}

        <!-- 간격 표시 -->
        <div style="text-align: center; width: ${baseIntervalWidth * scale}px;">
          <div style="font-size: ${baseLargeFontSize * scale}px; font-weight: 700; color: #fff; line-height: 1;">
            ${currentInterval !== null ? currentInterval : "---"}
          </div>
          <div style="font-size: ${baseSmallFontSize * scale}px; opacity: 0.5; margin-top: ${baseMarginTop * scale}px;">
            ${t("label.ms")}
          </div>
        </div>

        <!-- 구분선 -->
        <div style="width: ${1 * scale}px; height: ${baseDividerHeight * scale}px; background: rgba(255, 255, 255, 0.1);"></div>

        <!-- 동시 입력 키 수 -->
        <div style="text-align: center; width: ${baseKeysWidth * scale}px;">
          <div style="font-size: ${baseLargeFontSize * scale}px; font-weight: 700; color: #fff; opacity: ${chordSize > 1 ? 1 : 0.3}; line-height: 1;">
            ${chordSize > 0 ? chordSize : "-"}
          </div>
          <div style="font-size: ${baseSmallFontSize * scale}px; opacity: 0.5; margin-top: ${baseMarginTop * scale}px;">
            ${t("label.keys")}
          </div>
        </div>
      </div>
    `;
  },

  previewState: {
    currentInterval: 127,
    chordSize: 2,
    chordLog: [
      { interval: 127, keys: 2 },
      { interval: 98, keys: 4 },
      { interval: 156, keys: 3 },
      { interval: 201, keys: 2 },
      { interval: 88, keys: 6 },
    ],
  },

  onMount: ({
    setState,
    getSettings,
    expose,
  }) => {
    // 상태 변수들
    let prevNoteTime = null; // 이전 완료된 동치의 시작 시간
    let lastKeyTime = null; // 마지막 키 입력 시간
    let currentChordGroup = []; // 현재 동치 그룹 (동시에 눌린 키들의 타임스탬프)
    let lastDisplayedInterval = null; // 마지막으로 표시된 간격
    let displayedChordSize = 0; // 화면에 표시할 동치 키 개수 (완성된 동치만)
    let chordLog = []; // 동치 로그 (최근 6개)
    let idleTimer = null; // 자동 초기화 타이머
    let chordDisplayTimer = null; // 동치 표시 디바운스 타이머
    let chordLogged = false; // 현재 동치가 로그에 기록되었는지
    let isMounted = true;

    // 현재 눌린 키 추적 (중복 방지)
    const pressedKeys = new Set();

    // 자동 초기화 타이머 리셋
    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      const settings = getSettings();
      const timeoutSec = settings.idleTimeout || 7;
      idleTimer = setTimeout(() => {
        if (isMounted) {
          resetKeepLog(); // 로그는 유지하고 나머지만 초기화
        }
      }, timeoutSec * 1000);
    };

    // 초기화 함수 (로그 유지)
    const resetKeepLog = () => {
      prevNoteTime = null;
      lastKeyTime = null;
      currentChordGroup = [];
      lastDisplayedInterval = null;
      displayedChordSize = 0;
      chordLogged = false;
      pressedKeys.clear();
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (chordDisplayTimer) {
        clearTimeout(chordDisplayTimer);
        chordDisplayTimer = null;
      }

      setState({
        currentInterval: null,
        chordSize: 0,
        chordLog: [...chordLog], // 로그 유지
      });
    };

    // 완전 초기화 함수 (메뉴에서 호출)
    const reset = () => {
      prevNoteTime = null;
      lastKeyTime = null;
      currentChordGroup = [];
      lastDisplayedInterval = null;
      displayedChordSize = 0;
      chordLogged = false;
      chordLog = [];
      pressedKeys.clear();
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (chordDisplayTimer) {
        clearTimeout(chordDisplayTimer);
        chordDisplayTimer = null;
      }

      setState({
        currentInterval: null,
        chordSize: 0,
        chordLog: [],
      });
    };

    // 동치 로그에 추가
    const addChordLog = (interval, keys) => {
      // 2키 이상 동치만 로그에 기록 (interval이 null이어도 기록)
      chordLog.unshift({ interval, keys });
      if (chordLog.length > 6) {
        chordLog.pop();
      }
    };

    // 키 입력 처리
    const handleKeyDown = (key, timestamp) => {
      // 이미 눌린 키면 무시 (홀드 방지)
      if (pressedKeys.has(key)) return;
      pressedKeys.add(key);

      // 자동 초기화 타이머 리셋
      resetIdleTimer();

      const settings = getSettings();
      const threshold = settings.chordThreshold || 15;

      if (lastKeyTime !== null) {
        const timeSinceLastKey = timestamp - lastKeyTime;

        if (timeSinceLastKey <= threshold) {
          // 동시치기로 판정 - 현재 동치 그룹에 추가
          currentChordGroup.push(timestamp);
          chordLogged = false; // 동치가 추가되었으므로 다시 로그 가능
        } else {
          // 새로운 노트 시작 - 새 동치 그룹 시작
          currentChordGroup = [timestamp];
          chordLogged = false;
        }
      } else {
        // 첫 번째 입력
        currentChordGroup = [timestamp];
        chordLogged = false;
      }

      lastKeyTime = timestamp;

      // 디바운싱: threshold 후에 UI 업데이트 (동치 완성 대기)
      if (chordDisplayTimer) clearTimeout(chordDisplayTimer);
      const chordStartTime = currentChordGroup[0]; // 현재 동치의 시작 시간
      chordDisplayTimer = setTimeout(() => {
        // 동치 완료 시점에 interval 계산
        if (prevNoteTime !== null) {
          lastDisplayedInterval = chordStartTime - prevNoteTime;
        }
        
        // 동치가 완성되었으므로 로그에 기록 (중복 방지)
        if (!chordLogged && currentChordGroup.length >= 2) {
          addChordLog(lastDisplayedInterval, currentChordGroup.length);
          chordLogged = true;
        }
        
        // 현재 동치를 "이전 동치"로 저장 (다음 interval 계산용)
        prevNoteTime = chordStartTime;
        
        displayedChordSize = currentChordGroup.length;
        setState({
          currentInterval: lastDisplayedInterval,
          chordSize: displayedChordSize,
          chordLog: [...chordLog],
        });
      }, threshold);
    };

    // 키 해제 처리
    const handleKeyUp = (key) => {
      pressedKeys.delete(key);
    };

    // 키 이벤트 구독
    const unsubKeyState = dmn.keys.onKeyState(({ key, state }) => {
      if (!isMounted) return;

      const timestamp = Date.now();

      if (state === "DOWN") {
        handleKeyDown(key, timestamp);
      } else if (state === "UP") {
        handleKeyUp(key);
      }
    });

    // expose로 컨텍스트 메뉴에서 호출 가능하게
    expose({
      reset,
    });

    // 클린업
    return () => {
      isMounted = false;
      unsubKeyState();
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      if (chordDisplayTimer) {
        clearTimeout(chordDisplayTimer);
      }
    };
  },
});
