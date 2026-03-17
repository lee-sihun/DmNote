// @id audio-spectrum

/* ================================================================
 *  Audio Spectrum Visualizer
 *  시스템/마이크 오디오를 실시간 스펙트럼으로 시각화
 * ================================================================ */

/* ---------- 유틸리티 ---------- */

const hexToRgb = (hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const lerpColor = (hex1, hex2, t) => {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
};

const barColor = (i, total, s) => {
  const t = total > 1 ? i / (total - 1) : 0;
  if (s.colorMode === "rainbow") return `hsl(${t * 300},85%,60%)`;
  if (s.colorMode === "gradient") return lerpColor(s.primaryColor, s.secondaryColor, t);
  return s.primaryColor;
};

// Catmull-Rom 스타일 스무스 웨이브 SVG 패스
const wavePath = (bars, w, h) => {
  if (!bars.length) return "";
  const pts = bars.map((v, i) => [
    (i / (bars.length - 1)) * w,
    h - (Math.min(v, 100) / 100) * h,
  ]);
  let d = `M0,${h} L${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1][0] + pts[i][0]) / 2;
    d += ` C${mx},${pts[i - 1][1]} ${mx},${pts[i][1]} ${pts[i][0]},${pts[i][1]}`;
  }
  d += ` L${w},${h} Z`;
  return d;
};

/* ---------- 플러그인 정의 ---------- */

dmn.plugin.defineElement({
  name: "Audio Spectrum",
  maxInstances: 1,
  resizable: true,
  preserveAxis: "both",
  resizeAnchor: "bottom-center",

  contextMenu: {
    create: "menu.create",
    delete: "menu.delete",
    items: [
      {
        label: "menu.start",
        action: "startCapture",
        visible: (ctx) => !ctx.state?.active,
      },
      {
        label: "menu.stop",
        action: "stopCapture",
        visible: (ctx) => !!ctx.state?.active,
      },
    ],
  },

  /* ---- 설정 ---- */

  settings: {
    source: {
      type: "select",
      default: "mic",
      label: "source",
      options: [
        { label: "source.system", value: "system" },
        { label: "source.mic", value: "mic" },
      ],
    },
    fftSize: {
      type: "select",
      default: "2048",
      label: "fftSize",
      options: [
        { label: "512", value: "512" },
        { label: "1024", value: "1024" },
        { label: "2048", value: "2048" },
        { label: "4096", value: "4096" },
      ],
    },
    smoothing: {
      type: "number",
      default: 0.82,
      min: 0,
      max: 0.95,
      step: 0.01,
      label: "smoothing",
    },
    sensitivity: {
      type: "number",
      default: 1.4,
      min: 0.5,
      max: 3.0,
      step: 0.1,
      label: "sensitivity",
    },

    divider1: { type: "divider" },

    visualStyle: {
      type: "select",
      default: "bars",
      label: "style",
      options: [
        { label: "style.bars", value: "bars" },
        { label: "style.mirror", value: "mirror" },
        { label: "style.wave", value: "wave" },
      ],
    },
    barCount: {
      type: "number",
      default: 48,
      min: 8,
      max: 128,
      step: 4,
      label: "barCount",
    },
    barGap: {
      type: "number",
      default: 2,
      min: 0,
      max: 8,
      step: 1,
      label: "barGap",
    },
    barRadius: {
      type: "number",
      default: 3,
      min: 0,
      max: 12,
      step: 1,
      label: "barRadius",
    },

    divider2: { type: "divider" },

    colorMode: {
      type: "select",
      default: "gradient",
      label: "colorMode",
      options: [
        { label: "color.solid", value: "solid" },
        { label: "color.gradient", value: "gradient" },
        { label: "color.rainbow", value: "rainbow" },
      ],
    },
    primaryColor: {
      type: "color",
      default: "#86EFAC",
      label: "primaryColor",
    },
    secondaryColor: {
      type: "color",
      default: "#3B82F6",
      label: "secondaryColor",
      visible: (s) => s.colorMode === "gradient",
    },

    divider3: { type: "divider" },

    bgOpacity: {
      type: "number",
      default: 0,
      min: 0,
      max: 1,
      step: 0.05,
      label: "bgOpacity",
    },
    glowIntensity: {
      type: "number",
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.1,
      label: "glowIntensity",
    },
  },

  /* ---- 다국어 ---- */

  messages: {
    ko: {
      "name": "오디오 스펙트럼",
      "menu.create": "오디오 스펙트럼 생성",
      "menu.delete": "오디오 스펙트럼 삭제",
      "menu.start": "오디오 캡처 시작",
      "menu.stop": "오디오 캡처 중지",
      "idle": "우클릭 → 오디오 캡처 시작",
      "error": "오디오 캡처 실패",
      "source": "오디오 소스",
      "source.system": "시스템 오디오",
      "source.mic": "마이크",
      "fftSize": "FFT 크기",
      "smoothing": "스무딩",
      "sensitivity": "감도",
      "style": "스타일",
      "style.bars": "바",
      "style.mirror": "미러",
      "style.wave": "웨이브",
      "barCount": "바 개수",
      "barGap": "바 간격 (px)",
      "barRadius": "바 라운딩",
      "colorMode": "색상 모드",
      "color.solid": "단색",
      "color.gradient": "그라디언트",
      "color.rainbow": "레인보우",
      "primaryColor": "주 색상",
      "secondaryColor": "보조 색상",
      "bgOpacity": "배경 투명도",
      "glowIntensity": "글로우 강도",
    },
    en: {
      "name": "Audio Spectrum",
      "menu.create": "Create Audio Spectrum",
      "menu.delete": "Delete Audio Spectrum",
      "menu.start": "Start Audio Capture",
      "menu.stop": "Stop Audio Capture",
      "idle": "Right-click → Start Audio Capture",
      "error": "Audio capture failed",
      "source": "Audio Source",
      "source.system": "System Audio",
      "source.mic": "Microphone",
      "fftSize": "FFT Size",
      "smoothing": "Smoothing",
      "sensitivity": "Sensitivity",
      "style": "Style",
      "style.bars": "Bars",
      "style.mirror": "Mirror",
      "style.wave": "Wave",
      "barCount": "Bar Count",
      "barGap": "Bar Gap (px)",
      "barRadius": "Bar Radius",
      "colorMode": "Color Mode",
      "color.solid": "Solid",
      "color.gradient": "Gradient",
      "color.rainbow": "Rainbow",
      "primaryColor": "Primary Color",
      "secondaryColor": "Secondary Color",
      "bgOpacity": "Background Opacity",
      "glowIntensity": "Glow Intensity",
    },
  },

  /* ---- 미리보기 상태 ---- */

  previewState: {
    bars: Array.from({ length: 48 }, (_, i) => {
      const x = i / 47;
      // 저음 높고 고음 낮은 자연스러운 스펙트럼 형태
      const base = Math.pow(1 - x, 0.8) * 70;
      const variation = Math.sin(x * 12) * 15 + Math.cos(x * 7) * 10;
      return Math.max(3, base + variation);
    }),
    active: true,
  },

  /* ---- 템플릿 ---- */

  template: (state, settings, { html, t }) => {
    const bars = state.bars || [];
    const active = state.active;
    const wrap =
      "position:relative;width:100%;height:100%;overflow:hidden;" +
      `background:rgba(0,0,0,${settings.bgOpacity});` +
      "border-radius:8px;box-sizing:border-box;";

    /* 비활성 / 에러 */
    if (!active) {
      const msg = state.error ? `${t("error")}: ${state.error}` : t("idle");
      return html`
        <div
          style="${wrap}display:flex;align-items:center;justify-content:center;"
        >
          <span
            style="color:rgba(255,255,255,0.45);font-size:12px;text-align:center;padding:16px;user-select:none;"
          >
            ${msg}
          </span>
        </div>
      `;
    }

    const n = bars.length;
    const glow = settings.glowIntensity;
    const r = settings.barRadius;

    /* 웨이브 스타일 */
    if (settings.visualStyle === "wave") {
      const d = wavePath(bars, 100, 100);
      const c1 = settings.primaryColor;
      const c2 =
        settings.colorMode === "gradient" ? settings.secondaryColor : c1;
      const [r1, g1, b1] = hexToRgb(c1);
      const glowFilter =
        glow > 0
          ? `filter:drop-shadow(0 0 ${glow * 12}px rgba(${r1},${g1},${b1},${glow}));`
          : "";

      return html`
        <div style="${wrap}">
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style="display:block;${glowFilter}"
          >
            <defs>
              <linearGradient id="as-wg" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stop-color="${c1}" />
                <stop offset="100%" stop-color="${c2}" />
              </linearGradient>
            </defs>
            <path d="${d}" fill="url(#as-wg)" opacity="0.85" />
          </svg>
        </div>
      `;
    }

    /* 바 / 미러 스타일 */
    const isMirror = settings.visualStyle === "mirror";
    const align = isMirror ? "center" : "flex-end";
    const gap = settings.barGap;

    return html`
      <div
        style="${wrap}display:flex;align-items:${align};gap:${gap}px;padding:4px;box-sizing:border-box;"
      >
        ${bars.map((h, i) => {
          const c = barColor(i, n, settings);
          const height = Math.max(1, Math.min(100, h));

          let shadow = "";
          if (glow > 0) {
            const [cr, cg, cb] =
              settings.colorMode === "rainbow"
                ? (() => {
                    const hue = (i / (n - 1)) * 300;
                    // HSL → 대략적 RGB (글로우용)
                    const s2 = 0.85,
                      l = 0.6;
                    const k = (n2) => (n2 + hue / 30) % 12;
                    const a = s2 * Math.min(l, 1 - l);
                    const f = (n2) =>
                      l -
                      a *
                        Math.max(
                          -1,
                          Math.min(k(n2) - 3, Math.min(9 - k(n2), 1)),
                        );
                    return [
                      Math.round(f(0) * 255),
                      Math.round(f(8) * 255),
                      Math.round(f(4) * 255),
                    ];
                  })()
                : hexToRgb(
                    settings.colorMode === "gradient"
                      ? lerpColor(
                          settings.primaryColor,
                          settings.secondaryColor,
                          n > 1 ? i / (n - 1) : 0,
                        )
                      : settings.primaryColor,
                  );
            shadow = `box-shadow:0 0 ${glow * 10}px rgba(${cr},${cg},${cb},${glow * 0.6});`;
          }

          const radius = isMirror
            ? `border-radius:${r}px;`
            : `border-radius:${r}px ${r}px 0 0;`;

          return html`
            <div
              style="flex:1;min-width:0;height:${height}%;background:${c};${radius}${shadow}transition:height 50ms ease-out;"
            ></div>
          `;
        })}
      </div>
    `;
  },

  /* ---- 마운트 ---- */

  onMount: (ctx) => {
    const { setState, getSettings, onSettingsChange, expose } = ctx;

    let audioCtx = null;
    let analyser = null;
    let sourceNode = null;
    let stream = null;
    let rafId = null;
    let running = false;
    let lastFrame = 0;

    /* 리소스 정리 */
    const release = () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (sourceNode) {
        try {
          sourceNode.disconnect();
        } catch {}
      }
      sourceNode = null;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null;
      if (audioCtx) {
        try {
          audioCtx.close();
        } catch {}
      }
      audioCtx = null;
      analyser = null;
    };

    /* 오디오 캡처 시작 */
    const startCapture = async () => {
      release();
      const s = getSettings();

      try {
        if (s.source === "system") {
          // 시스템 오디오: getDisplayMedia (화면 공유 다이얼로그 필요)
          stream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: { width: 1, height: 1 },
          });
          // 비디오 트랙 즉시 정지 — 오디오만 사용
          stream.getVideoTracks().forEach((t) => t.stop());
          if (!stream.getAudioTracks().length) {
            throw new Error("No audio track");
          }
        } else {
          // 마이크 입력
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        audioCtx = new AudioContext();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = parseInt(s.fftSize);
        analyser.smoothingTimeConstant = s.smoothing;

        sourceNode = audioCtx.createMediaStreamSource(stream);
        sourceNode.connect(analyser);

        // 스트림 종료 감지 (사용자가 화면 공유 중지 등)
        stream.getAudioTracks()[0].addEventListener("ended", () => {
          stopCapture();
        });

        running = true;
        setState({ active: true, error: null });
        rafId = requestAnimationFrame(tick);
      } catch (e) {
        release();
        setState({ active: false, error: e.message || String(e) });
      }
    };

    /* 오디오 캡처 중지 */
    const stopCapture = () => {
      release();
      setState({ active: false, bars: [], error: null });
    };

    /* 프레임 루프 (~30 fps) */
    const tick = (ts) => {
      if (!running || !analyser) return;
      rafId = requestAnimationFrame(tick);

      if (ts - lastFrame < 33) return;
      lastFrame = ts;

      const s = getSettings();
      const bufLen = analyser.frequencyBinCount;
      const data = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(data);

      const count = s.barCount;
      const slice = Math.max(1, Math.floor(bufLen / count));
      const bars = [];

      for (let i = 0; i < count; i++) {
        let sum = 0;
        const start = i * slice;
        for (let j = 0; j < slice && start + j < bufLen; j++) {
          sum += data[start + j];
        }
        const avg = sum / slice;
        bars.push(Math.min(100, (avg / 255) * 100 * s.sensitivity));
      }

      setState({ bars });
    };

    /* 설정 변경 반응 */
    onSettingsChange((next, prev) => {
      if (!analyser) return;

      // 소스 변경 시 재시작
      if (next.source !== prev.source) {
        startCapture();
        return;
      }

      // analyser 속성 업데이트
      try {
        const newFft = parseInt(next.fftSize);
        if (analyser.fftSize !== newFft) analyser.fftSize = newFft;
        analyser.smoothingTimeConstant = next.smoothing;
      } catch {}
    });

    /* 컨텍스트 메뉴 액션 */
    expose({ startCapture, stopCapture });

    /* 언마운트 시 정리 */
    return release;
  },
});
