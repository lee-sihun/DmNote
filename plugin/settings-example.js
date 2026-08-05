// @id settings-example

/**
 * defineSettings API 예제 플러그인
 *
 * 이 플러그인은 dmn.plugin.defineSettings()를 사용하여
 * 전역 설정을 선언적으로 정의하고 관리하는 방법을 보여줍니다.
 *
 * 주요 기능:
 * - 전역 설정 정의 (defineSettings)
 * - 패널별 설정 정의 (defineElement의 settings)
 * - 컨텍스트 메뉴에서 전역 설정 열기
 * - 전역 설정과 패널 설정의 조합
 */

// ============================================
// 1. 전역 설정 정의 (모든 패널에 공통으로 적용)
// ============================================
const globalSettings = dmn.plugin.defineSettings({
  settings: {
    appearanceSection: {
      type: "section",
      label: "section.appearance",
    },
    // 기본 테마 색상
    primaryColor: {
      type: "color",
      default: "#86EFAC",
      label: "global.primaryColor",
    },
    // 폰트 크기
    fontSize: {
      type: "number",
      default: 14,
      min: 10,
      max: 24,
      step: 1,
      label: "global.fontSize",
    },
    behaviorSection: {
      type: "section",
      label: "section.behavior",
    },
    // 애니메이션 활성화
    enableAnimation: {
      type: "boolean",
      default: true,
      label: "global.enableAnimation",
    },
    // 테마 모드
    themeMode: {
      type: "select",
      options: [
        { value: "dark", label: "global.theme.dark" },
        { value: "light", label: "global.theme.light" },
        { value: "system", label: "global.theme.system" },
      ],
      default: "dark",
      label: "global.themeMode",
    },
  },

  // 다국어 지원
  messages: {
    ko: {
      "global.primaryColor": "메인 색상",
      "global.fontSize": "폰트 크기",
      "global.enableAnimation": "애니메이션 활성화",
      "global.themeMode": "테마 모드",
      "global.theme.dark": "다크",
      "global.theme.light": "라이트",
      "global.theme.system": "시스템 설정",
      "section.appearance": "모양",
      "section.behavior": "동작",
      "menu.create": "예제 패널 생성",
      "menu.delete": "예제 패널 삭제",
      "menu.globalSettings": "전역 설정",
      "menu.reset": "초기화",
      "panel.title": "설정 예제",
      "panel.clickCount": "클릭 횟수",
      "settings.showTitle": "제목 표시",
      "settings.customText": "커스텀 텍스트",
    },
    en: {
      "global.primaryColor": "Primary Color",
      "global.fontSize": "Font Size",
      "global.enableAnimation": "Enable Animation",
      "global.themeMode": "Theme Mode",
      "global.theme.dark": "Dark",
      "global.theme.light": "Light",
      "global.theme.system": "System",
      "section.appearance": "Appearance",
      "section.behavior": "Behavior",
      "menu.create": "Create Example Panel",
      "menu.delete": "Delete Example Panel",
      "menu.globalSettings": "Global Settings",
      "menu.reset": "Reset",
      "panel.title": "Settings Example",
      "panel.clickCount": "Click Count",
      "settings.showTitle": "Show Title",
      "settings.customText": "Custom Text",
    },
  },

  // 설정 변경 시 콜백
  onChange: (newSettings, oldSettings) => {
    console.log("[settings-example] Global settings changed:", {
      from: oldSettings,
      to: newSettings,
    });

    // 특정 설정 변경에 따른 처리
    if (newSettings.themeMode !== oldSettings.themeMode) {
      console.log(
        `[settings-example] Theme changed to: ${newSettings.themeMode}`
      );
    }
  },
});

// ============================================
// 2. 패널 정의 (인스턴스별 설정 + 전역 설정 참조)
// ============================================
dmn.plugin.defineElement({
  name: "Settings Example",
  maxInstances: 2, // 최대 2개까지 생성 가능

  // 컨텍스트 메뉴 (전역 설정 열기 포함)
  contextMenu: {
    create: "menu.create",
    delete: "menu.delete",
    items: [
      {
        label: "menu.globalSettings",
        onClick: () => globalSettings.open(), // 👈 전역 설정 다이얼로그 열기
      },
      {
        label: "menu.reset",
        onClick: ({ actions }) => actions.reset(),
      },
    ],
  },

  // 다국어 메시지 (defineElement는 자체 messages 번들 사용)
  messages: {
    ko: {
      "menu.create": "예제 패널 생성",
      "menu.delete": "예제 패널 삭제",
      "menu.globalSettings": "전역 설정",
      "menu.reset": "초기화",
      "panel.title": "설정 예제",
      "panel.clickCount": "클릭 횟수",
      "settings.showTitle": "제목 표시",
      "settings.customText": "커스텀 텍스트",
      "section.content": "콘텐츠",
    },
    en: {
      "menu.create": "Create Example Panel",
      "menu.delete": "Delete Example Panel",
      "menu.globalSettings": "Global Settings",
      "menu.reset": "Reset",
      "panel.title": "Settings Example",
      "panel.clickCount": "Click Count",
      "settings.showTitle": "Show Title",
      "settings.customText": "Custom Text",
      "section.content": "Content",
    },
  },

  // 인스턴스별 설정 (각 패널마다 다를 수 있음)
  settings: {
    contentSection: {
      type: "section",
      label: "section.content",
    },
    showTitle: {
      type: "boolean",
      default: true,
      label: "settings.showTitle",
    },
    customText: {
      type: "string",
      default: "Hello!",
      label: "settings.customText",
      placeholder: "Enter text...",
    },
  },

  // 템플릿 (전역 설정 + 인스턴스 설정 조합)
  template: (state, instanceSettings, { html, t }) => {
    const global = globalSettings.get(); // 👈 전역 설정 참조
    const { clickCount = 0 } = state;
    const { showTitle, customText } = instanceSettings;

    // 테마에 따른 배경색
    const bgColor =
      global.themeMode === "light"
        ? "rgba(255, 255, 255, 0.9)"
        : "rgba(17, 17, 20, 0.9)";
    const textColor = global.themeMode === "light" ? "#1A1A1A" : "#FFFFFF";

    // 애니메이션 스타일
    const transition = global.enableAnimation ? "all 0.3s ease" : "none";

    return html`
      <div
        style="
          background: ${bgColor};
          color: ${textColor};
          border: 1px solid ${global.primaryColor};
          border-radius: 8px;
          padding: 12px;
          min-width: 150px;
          font-size: ${global.fontSize}px;
          transition: ${transition};
          cursor: pointer;
          user-select: none;
        "
      >
        ${showTitle
          ? html`<div
              style="
                color: ${global.primaryColor};
                font-weight: 700;
                margin-bottom: 8px;
              "
            >
              ${t("panel.title")}
            </div>`
          : ""}

        <div style="margin-bottom: 4px;">${customText}</div>

        <div
          style="display: flex; justify-content: space-between; align-items: center;"
        >
          <span style="color: #9CA3AF;">${t("panel.clickCount")}</span>
          <span style="color: ${global.primaryColor}; font-weight: 700;">
            ${clickCount}
          </span>
        </div>
      </div>
    `;
  },

  // 미리보기 상태
  previewState: {
    clickCount: 42,
  },

  // 마운트 로직
  onMount: ({ setState, expose }) => {
    let clickCount = 0;

    // 클릭 카운터 증가 (테스트용)
    const incrementCount = () => {
      clickCount++;
      setState({ clickCount });
    };

    // 초기화
    const reset = () => {
      clickCount = 0;
      setState({ clickCount });
    };

    // 액션 노출
    expose({
      reset,
      increment: incrementCount,
    });

    // 전역 설정 변경 구독 (선택사항 - 특별한 처리가 필요한 경우)
    // 기본적으로 전역 설정 변경 시 패널이 자동으로 리렌더링됩니다.
    // 아래처럼 subscribe를 사용하면 추가적인 로직을 실행할 수 있습니다.
    const unsubscribe = globalSettings.subscribe((newSettings, oldSettings) => {
      console.log("[settings-example] Settings changed in panel:", {
        from: oldSettings,
        to: newSettings,
      });
    });

    return () => {
      unsubscribe();
    };
  },
});

// ============================================
// 3. 추가: 그리드 메뉴에 독립 설정 메뉴 추가 (선택사항)
// ============================================
// 패널과 별개로 그리드 우클릭 메뉴에서 직접 전역 설정을 열 수 있음
dmn.ui.contextMenu.addGridMenuItem({
  id: "settings-example-global",
  label: "예제 플러그인 전역 설정",
  position: "bottom",
  onClick: () => globalSettings.open(),
});
