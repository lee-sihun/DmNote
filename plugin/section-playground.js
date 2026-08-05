// @id section-playground

/**
 * 섹션 API 전 기능 테스트 플러그인
 *
 * settings-example이 패널 경로(settingsUI: "panel")를 보여주므로,
 * 이 플러그인은 나머지를 전부 검증합니다:
 * - defineSettings + settingsUI: "modal" (레거시 모달 경로)
 * - defineElement의 settings (React 패널 경로)
 * - 암시적 첫 카드 / 이름 있는·없는 section
 * - 조건부 section (그룹 통째 표시/숨김) / 조건부 필드
 * - 모든 필드가 숨겨진 section의 카드 소멸
 * - visible 함수 예외의 fail-closed (콘솔 로그 1회 + 해당 항목만 숨김)
 * - boolean/color/number/string/select 전 컨트롤 타입
 * - ko/en 번역 키 (section label 포함)
 *
 * 체크리스트:
 * [요소 패널] 1. 요소 생성 → 우측 패널: [암시적 카드(배지 표시)] [요소 모양] 카드 2개 확인
 * [요소 패널] 2. "배지 표시" 끄면 "배지 문구"만 숨고 카드는 유지되는지
 * [전역 모달] 3. 컨텍스트 메뉴 → "섹션 플레이그라운드 설정 (모달)" →
 *              [암시적 카드(활성화)] [모양] [이름 없는 카드] 3개 확인
 * [전역 모달] 4. "고급 표시" 토글 → 저장 없이 "고급"·"유령" 카드가 즉시 나타나고
 *              사라지는지 (재정규화)
 * [전역 모달] 5. "예외 필드 표시"를 켜도 깨진 항목이 나타나지 않고 콘솔 에러 1회만 찍히는지
 */

// ============================================
// 전역 설정 — 레거시 모달 경로 테스트
// ============================================
const globalSettings = dmn.plugin.defineSettings({
  settingsUI: "modal",
  settings: {
    // 암시적 첫 카드 (section 선언 전)
    enabled: {
      type: "boolean",
      default: true,
      label: "g.enabled",
    },

    // 이름 있는 section
    lookSection: { type: "section", label: "section.look" },
    tint: {
      type: "color",
      default: "#8B5CF6",
      label: "g.tint",
    },
    size: {
      type: "number",
      default: 16,
      min: 8,
      max: 48,
      step: 1,
      label: "g.size",
    },
    shape: {
      type: "select",
      options: [
        { value: "round", label: "g.shape.round" },
        { value: "square", label: "g.shape.square" },
      ],
      default: "round",
      label: "g.shape",
    },

    // 조건부 section — showAdvanced가 켜져야 그룹 전체 표시
    showAdvanced: {
      type: "boolean",
      default: false,
      label: "g.showAdvanced",
    },
    advancedSection: {
      type: "section",
      label: "section.advanced",
      visible: (s) => !!s.showAdvanced,
    },
    advancedText: {
      type: "string",
      default: "",
      placeholder: "memo...",
      label: "g.advancedText",
    },
    advancedRatio: {
      type: "number",
      default: 50,
      min: 0,
      max: 100,
      step: 5,
      label: "g.advancedRatio",
    },

    // 모든 필드가 조건부인 section — 필드가 다 숨으면 카드째 소멸해야 함
    ghostSection: { type: "section", label: "section.ghost" },
    ghostField: {
      type: "string",
      default: "boo",
      label: "g.ghostField",
      visible: (s) => !!s.showAdvanced,
    },

    // 이름 없는 section + 예외 필드 (fail-closed 확인)
    tailSection: { type: "section" },
    showBroken: {
      type: "boolean",
      default: false,
      label: "g.showBroken",
    },
    brokenField: {
      type: "string",
      default: "",
      label: "g.brokenField",
      // 켜는 순간 예외 발생 — 이 필드만 숨겨지고 콘솔 에러 1회
      visible: (s) => {
        if (s.showBroken) throw new Error("intentional visibility error");
        return false;
      },
    },
  },

  messages: {
    ko: {
      "g.enabled": "활성화",
      "g.tint": "색조",
      "g.size": "크기",
      "g.shape": "모양",
      "g.shape.round": "둥글게",
      "g.shape.square": "각지게",
      "g.showAdvanced": "고급 표시",
      "g.advancedText": "메모",
      "g.advancedRatio": "비율",
      "g.ghostField": "유령 필드",
      "g.showBroken": "예외 필드 표시",
      "g.brokenField": "깨진 필드",
      "section.look": "모양",
      "section.advanced": "고급",
      "section.ghost": "유령 (고급 켜야 보임)",
    },
    en: {
      "g.enabled": "Enabled",
      "g.tint": "Tint",
      "g.size": "Size",
      "g.shape": "Shape",
      "g.shape.round": "Round",
      "g.shape.square": "Square",
      "g.showAdvanced": "Show Advanced",
      "g.advancedText": "Memo",
      "g.advancedRatio": "Ratio",
      "g.ghostField": "Ghost Field",
      "g.showBroken": "Show Broken Field",
      "g.brokenField": "Broken Field",
      "section.look": "Look",
      "section.advanced": "Advanced",
      "section.ghost": "Ghost (needs Advanced)",
    },
  },
});

// ============================================
// 요소 — React 패널 경로 테스트
// ============================================
dmn.plugin.defineElement({
  name: "Section Playground",
  maxInstances: 2,

  messages: {
    ko: {
      "el.title": "섹션 플레이그라운드",
      "el.badge": "배지 표시",
      "el.badgeText": "배지 문구",
      "section.elLook": "요소 모양",
    },
    en: {
      "el.title": "Section Playground",
      "el.badge": "Show Badge",
      "el.badgeText": "Badge Text",
      "section.elLook": "Element Look",
    },
  },

  // 인스턴스 설정 — 암시적 카드 + 이름 있는 section + 조건부 필드
  settings: {
    badge: {
      type: "boolean",
      default: true,
      label: "el.badge",
    },
    elLookSection: { type: "section", label: "section.elLook" },
    badgeText: {
      type: "string",
      default: "TEST",
      label: "el.badgeText",
      visible: (s) => !!s.badge,
    },
    opacity: {
      type: "number",
      default: 100,
      min: 10,
      max: 100,
      step: 10,
      label: "Opacity",
    },
  },

  template: (state, instanceSettings, { html, t }) => {
    const g = globalSettings.get();
    const { badge, badgeText, opacity } = instanceSettings;
    const radius = g.shape === "square" ? "2px" : "10px";

    return html`
      <div
        style="
          border: 2px solid ${g.tint};
          border-radius: ${radius};
          padding: 10px 14px;
          font-size: ${g.size}px;
          opacity: ${(opacity ?? 100) / 100};
          background: rgba(17, 17, 20, 0.85);
          color: #fff;
          user-select: none;
        "
      >
        <div style="font-weight:700; color:${g.tint};">${t("el.title")}</div>
        ${badge
          ? html`<div style="font-size: 11px; opacity: 0.8;">
              ${badgeText || "TEST"} · ${g.enabled ? "on" : "off"}
            </div>`
          : ""}
      </div>
    `;
  },
});

// ============================================
// 컨텍스트 메뉴
// ============================================
dmn.ui.contextMenu.addGridMenuItem({
  id: "section-playground-settings",
  label: "섹션 플레이그라운드 설정 (모달)",
  position: "bottom",
  onClick: () => globalSettings.open(),
});
