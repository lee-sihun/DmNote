const { app, ipcMain, shell, screen } = require("electron/main");
const MainWindow = require("./windows/mainWindow");
const OverlayWindow = require("./windows/overlayWindow");
const keyboardService = require("./services/keyboardListener");
const { resetKeys, resetKeysForMode } = require("./services/keyMappings");
const {
  loadKeyPositions,
  saveKeyPositions,
  resetKeyPositions,
  resetKeyPositionsForMode,
} = require("./services/keyPositions");
const {
  saveBackgroundColor,
  loadBackgroundColor,
  resetBackgroundColor,
} = require("./services/backgroundColor");
const Store = require("electron-store");
const store = new Store();
const roiRecorder = require("./services/roiRecorder");
const frameExtractor = require("./services/frameExtractor");

// main 코드 변경 시 자동 재시작
if (process.env.NODE_ENV === "development") {
  try {
    require("electron-reloader")(module, {
      debug: true,
      watchRenderer: false,
      ignore: ["node_modules/*", "src/renderer/*"],
      paths: ["src/main/**/*"],
    });
  } catch (err) {
    console.log(err);
  }
}

class Application {
  constructor() {
    // 하드웨어 가속 설정
    if (store.get("hardwareAcceleration") === undefined) {
      store.set("hardwareAcceleration", true);
    }

    const hwAccel = store.get("hardwareAcceleration");
    if (!hwAccel) {
      app.disableHardwareAcceleration();
    }

    // Always on Top 설정
    if (store.get("alwaysOnTop") === undefined) {
      store.set("alwaysOnTop", true);
    }

    // 오버레이 고정 설정
    if (store.get("overlayLocked") === undefined) {
      store.set("overlayLocked", false);
    }

    // 노트 효과 설정
    if (store.get("noteEffect") === undefined) {
      store.set("noteEffect", false);
    }

    // 노트 효과 상세 설정 (borderRadius, speed, trackHeight, reverse)
    if (store.get("noteSettings") === undefined) {
      store.set("noteSettings", {
        borderRadius: 2,
        speed: 180,
        trackHeight: 150,
        reverse: false,
      });
    } else {
      // 호환성 보정
      const defaults = {
        borderRadius: 2,
        speed: 180,
        trackHeight: 150,
        reverse: false,
      };
      const existing = store.get("noteSettings") || {};
      const normalized = { ...defaults, ...existing };
      store.set("noteSettings", normalized);
    }

    // 선택된 키 모드 초기 설정
    if (store.get("selectedKeyType") === undefined) {
      store.set("selectedKeyType", "4key");
    }

    // ANGLE 모드 초기 설정
    if (store.get("angleMode") === undefined) {
      store.set("angleMode", "d3d11");
    }

    // ANGLE 백엔드 설정 적용
    const angleMode = store.get("angleMode");
    app.commandLine.appendSwitch("use-angle", angleMode);

    this.mainWindow = null;
    this.overlayWindow = null;
    global.isAppQuitting = false;
  }

  init() {
    this.setupEventListeners();
  }

  setupEventListeners() {
    // ANGLE 백엔드 설정 (d3d11, d3d9, gl, default)
    // app.commandLine.appendSwitch('use-angle', 'd3d9')
    app.whenReady().then(() => this.createWindows());
    // 모든 윈도우가 닫혔을 때 앱 종료
    app.on("window-all-closed", () => {
      keyboardService.stopListening();
      global.isAppQuitting = true;
      app.quit();
    });
    // 앱 종료 이벤트 핸들러 추가
    app.on("before-quit", () => {
      keyboardService.stopListening();
      global.isAppQuitting = true;
    });
    ipcMain.on("close-window", () => {
      keyboardService.stopListening();
      global.isAppQuitting = true;
      this.mainWindow.close();
      this.overlayWindow.close();
    });

    // 윈도우 컨트롤
    ipcMain.on("minimize-window", () => this.mainWindow.minimize());
    ipcMain.on("close-window", () => {
      this.mainWindow.close();
      this.overlayWindow.close();
    });

    // 키 모드 변경
    ipcMain.on("setKeyMode", (e, mode) => {
      if (keyboardService.setKeyMode(mode)) {
        // 저장
        store.set("selectedKeyType", mode);
        this.overlayWindow.webContents.send("keyModeChanged", mode);
        e.reply("keyModeUpdated", true);
      } else {
        e.reply("keyModeUpdated", false);
      }
    });

    ipcMain.on("getCurrentMode", (e) => {
      e.reply("currentMode", keyboardService.getCurrentMode());
    });

    ipcMain.handle("get-selected-key-type", () => {
      return store.get("selectedKeyType", "4key");
    });

    // 키매핑 요청 처리
    ipcMain.on("getKeyMappings", (e) => {
      e.reply("updateKeyMappings", keyboardService.getKeyMappings());
    });

    ipcMain.on("update-key-mapping", (e, keys) => {
      keyboardService.updateKeyMapping(keys);
      this.overlayWindow.webContents.send("updateKeyMappings", keys);
    });

    // 키포지션 요청 처리
    ipcMain.on("getKeyPositions", (e) => {
      e.reply("updateKeyPositions", loadKeyPositions());
    });

    ipcMain.on("update-key-positions", (e, positions) => {
      saveKeyPositions(positions);
      this.overlayWindow.webContents.send("updateKeyPositions", positions);
    });

    // 배경색 요청 처리
    ipcMain.on("getBackgroundColor", (e) => {
      e.reply("updateBackgroundColor", loadBackgroundColor());
    });

    ipcMain.on("update-background-color", (e, color) => {
      saveBackgroundColor(color);
      this.overlayWindow.webContents.send("updateBackgroundColor", color);
    });

    // 초기화 요청 처리
    ipcMain.on("reset-keys", (e) => {
      const defaultKeys = resetKeys();
      const defaultPositions = resetKeyPositions();
      const defaultColor = resetBackgroundColor();

      // 노트 관련 기본값
      const defaultNoteSettings = {
        borderRadius: 2,
        speed: 180,
        trackHeight: 150,
        reverse: false,
      };

      // CSS 관련 상태들 초기화
      store.set("useCustomCSS", false);
      store.set("customCSS", { path: null, content: "" });

      // 노트 관련 설정 초기화
      store.set("noteEffect", false);
      store.set("noteSettings", defaultNoteSettings);

      keyboardService.updateKeyMapping(defaultKeys);

      // Overlay에 최신 상태 브로드캐스트
      this.overlayWindow.webContents.send("updateKeyMappings", defaultKeys);
      this.overlayWindow.webContents.send(
        "updateKeyPositions",
        defaultPositions
      );
      this.overlayWindow.webContents.send(
        "updateBackgroundColor",
        defaultColor
      );
      this.overlayWindow.webContents.send("update-note-effect", false);
      this.overlayWindow.webContents.send(
        "update-note-settings",
        defaultNoteSettings
      );

      // CSS 초기화 알림
      [this.mainWindow, this.overlayWindow].forEach((window) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send("update-use-custom-css", false);
          window.webContents.send("update-custom-css", "");
        }
      });

      // 모든 데이터를 한 번에 보내는 새로운 이벤트
      e.reply("resetComplete", {
        keys: defaultKeys,
        positions: defaultPositions,
        color: defaultColor,
        noteSettings: defaultNoteSettings,
        noteEffect: false,
      });
    });

    // 현재 탭(모드)만 초기화
    ipcMain.on("reset-current-mode", (e, mode) => {
      try {
        const valid = ["4key", "5key", "6key", "8key"];
        if (!valid.includes(mode)) {
          e.reply("resetCurrentModeComplete", {
            success: false,
            error: "invalid mode",
          });
          return;
        }

        const updatedKeys = resetKeysForMode(mode);
        const updatedPositions = resetKeyPositionsForMode(mode);

        keyboardService.updateKeyMapping(updatedKeys);

        [this.overlayWindow, this.mainWindow].forEach((window) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send("updateKeyMappings", updatedKeys);
            window.webContents.send("updateKeyPositions", updatedPositions);
          }
        });

        e.reply("resetCurrentModeComplete", { success: true, mode });
      } catch (err) {
        console.error("Failed to reset current mode:", err);
        e.reply("resetCurrentModeComplete", {
          success: false,
          error: err.message,
        });
      }
    });

    // 하드웨어 가속 토글
    ipcMain.handle("toggle-hardware-acceleration", async (_, enabled) => {
      store.set("hardwareAcceleration", enabled);
      return true;
    });

    ipcMain.on("get-hardware-acceleration", (e) => {
      e.reply(
        "update-hardware-acceleration",
        store.get("hardwareAcceleration")
      );
    });

    // 항상 위에 표시 토글
    ipcMain.on("toggle-always-on-top", (_, enabled) => {
      store.set("alwaysOnTop", enabled);
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.setAlwaysOnTop(enabled, "floating");
      }
    });

    ipcMain.on("get-always-on-top", (e) => {
      e.reply("update-always-on-top", store.get("alwaysOnTop"));
    });

    // // 키 카운트 표시 설정
    // ipcMain.on('toggle-show-key-count', (_, value) => {
    //   store.set('showKeyCount', value);
    //   this.overlayWindow.webContents.send('update-show-key-count', value);
    // });

    // ipcMain.on('get-show-key-count', (e) => {
    //   const showKeyCount = store.get('showKeyCount', false);
    //   e.reply('update-show-key-count', showKeyCount);
    // });

    // ipcMain.on('reset-key-count', (e) => {
    //   const positions = loadKeyPositions();
    //   // 모든 키의 카운트를 0으로 초기화
    //   Object.keys(positions).forEach(mode => {
    //     positions[mode] = positions[mode].map(pos => ({
    //       ...pos,
    //       count: 0
    //     }));
    //   });
    //   saveKeyPositions(positions);
    //   this.overlayWindow.webContents.send('updateKeyPositions', positions);
    // });

    // 오버레이 표시 여부
    ipcMain.handle("get-overlay-visibility", () => {
      return (
        this.overlayWindow &&
        !this.overlayWindow.isDestroyed() &&
        this.overlayWindow.isVisible()
      );
    });

    ipcMain.on("toggle-overlay", (_, show) => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        if (show) {
          this.overlayWindow.show();
          // 오버레이가 표시될 때 현재 lock 상태 적용
          const isLocked = store.get("overlayLocked", false);
          this.overlayWindow.setIgnoreMouseEvents(isLocked, { forward: true });
        } else {
          this.overlayWindow.hide();
        }
      }
    });

    // 오버레이 고정 설정
    ipcMain.on("toggle-overlay-lock", (_, enabled) => {
      store.set("overlayLocked", enabled);
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
      }
    });

    ipcMain.on("get-overlay-lock", (e) => {
      e.reply("update-overlay-lock", store.get("overlayLocked"));
    });

    // 노트 효과 설정
    ipcMain.on("toggle-note-effect", (_, enabled) => {
      store.set("noteEffect", enabled);
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send("update-note-effect", enabled);
      }
    });

    ipcMain.on("get-note-effect", (e) => {
      e.reply("update-note-effect", store.get("noteEffect", true));
    });

    // 녹화 상태 제어
    ipcMain.on("recording-control", (_, action) => {
      if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return;
      if (action === "start" || action === "stop") {
        this.overlayWindow.webContents.send("recording-control", action);
      }
    });

    // 프레임 추출: events.json 생성 시점과 영상 파일 완료 시점을 모두 만족한 뒤 실행되도록 폴링 기반 스케줄러
    const extractionsScheduled = new Set();
    const runExtractionWhenReady = (outDir, videoPath) => {
      try {
        const fs = require("fs");
        const path = require("path");
        const maxWaitMs = 20000; // 최대 20초 대기
        const intervalMs = 250;
        let waited = 0;

        const attempt = async () => {
          try {
            // 1) events.json 존재 체크
            const eventsPath = path.join(outDir, "events.json");
            const hasEvents = fs.existsSync(eventsPath);
            // 2) 영상 파일 존재/사이즈 체크(0바이트 회피)
            const hasVideo =
              typeof videoPath === "string" &&
              fs.existsSync(videoPath) &&
              (fs.statSync(videoPath).size || 0) > 0;

            if (!hasEvents || !hasVideo) {
              if (waited >= maxWaitMs) {
                [this.mainWindow, this.overlayWindow].forEach((win) => {
                  if (win && !win.isDestroyed()) {
                    win.webContents.send("frames-extracted", {
                      success: false,
                      outDir,
                      error: !hasEvents
                        ? "events.json not found within timeout"
                        : "video not ready within timeout",
                    });
                  }
                });
                return;
              }
              waited += intervalMs;
              setTimeout(attempt, intervalMs);
              return;
            }

            const res = await frameExtractor.extractFramesForOutDir({
              outDir,
              videoPath,
              onlyDown: true,
            });

            [this.mainWindow, this.overlayWindow].forEach((win) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send("frames-extracted", {
                  success: true,
                  outDir,
                  shotsDir: res?.shotsDir || null,
                  count: res?.count ?? 0,
                });
              }
            });
          } catch (err) {
            [this.mainWindow, this.overlayWindow].forEach((win) => {
              if (win && !win.isDestroyed()) {
                win.webContents.send("frames-extracted", {
                  success: false,
                  outDir,
                  error: err?.message || String(err),
                });
              }
            });
          }
        };

        attempt();
      } catch (e) {
        [this.mainWindow, this.overlayWindow].forEach((win) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("frames-extracted", {
              success: false,
              outDir,
              error: e?.message || String(e),
            });
          }
        });
      }
    };

    // ROI 녹화 시작
    ipcMain.handle("roi-recording:start", async (_, roi) => {
      try {
        const defaults = store.get("roiRect", {
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
        });
        const incoming = roi || {};
        // 정수/가드 처리
        const toInt = (v, d) => {
          const n = parseInt(v);
          return Number.isFinite(n) ? n : d;
        };
        const merged = {
          x: Math.max(0, toInt(incoming.x ?? defaults.x, defaults.x)),
          y: Math.max(0, toInt(incoming.y ?? defaults.y, defaults.y)),
          width: Math.max(
            1,
            toInt(incoming.width ?? defaults.width, defaults.width)
          ),
          height: Math.max(
            1,
            toInt(incoming.height ?? defaults.height, defaults.height)
          ),
        };
        // 최신 ROI를 저장하여 재사용 가능
        store.set("roiRect", merged);

        const res = roiRecorder.startRecording(merged);
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayWindow.webContents.send("recording-control", "start");
        }
        return { success: true, session: res };
      } catch (err) {
        console.error("Failed to start ROI recording:", err);
        return { success: false, error: err?.message || String(err) };
      }
    });

    // ROI 디버그 정보
    ipcMain.handle("roi-recording:debug-info", () => {
      try {
        if (roiRecorder.debugInfo)
          return { success: true, data: roiRecorder.debugInfo() };
        return { success: false, error: "no-debug-info" };
      } catch (err) {
        return { success: false, error: err?.message || String(err) };
      }
    });

    // ROI 녹화 종료
    ipcMain.handle("roi-recording:stop", async () => {
      try {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayWindow.webContents.send("recording-control", "stop");
        }
        const result = await roiRecorder.stopRecording();

        // 영상 파일 완료 이후, events.json 생성을 기다린 뒤 프레임 추출 스케줄
        try {
          const outDir = result?.session?.outDir;
          const videoPath = result?.session?.videoPath;
          if (outDir && videoPath) {
            if (!extractionsScheduled.has(outDir)) {
              extractionsScheduled.add(outDir);
              runExtractionWhenReady(outDir, videoPath);
            }
          }
        } catch {}

        return { success: true, result };
      } catch (err) {
        console.error("Failed to stop ROI recording:", err);
        return { success: false, error: err?.message || String(err) };
      }
    });

    // 오버레이에서 전송한 녹화 데이터 저장
    ipcMain.on("recording-data", async (e, payload) => {
      try {
        // ROI 녹화 세션이 있으면 동일 폴더에 자동 저장(메타 병합)
        const active = roiRecorder.getSession && roiRecorder.getSession();
        if (active && active.outDir) {
          const fs = require("fs");
          const path = require("path");
          const metaPath = path.join(active.outDir, "meta.json");
          const eventsPath = path.join(active.outDir, "events.json");

          // events.json 저장
          fs.writeFileSync(
            eventsPath,
            JSON.stringify(payload, null, 2),
            "utf8"
          );

          // meta.json 병합(가능하면)
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
            meta.events = payload?.events || [];
            meta.recording = {
              startedAt: payload?.startedAt,
              durationMs: payload?.duration,
            };
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
          } catch {
            // meta가 없거나 읽기 실패 시 무시
          }

          [this.mainWindow, this.overlayWindow].forEach((win) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("recording-saved", {
                success: true,
                path: metaPath,
                count: payload?.events?.length || 0,
              });
            }
          });

          // 보강: events.json을 막 작성한 직후에도 스케줄 시도(중복 방지 가드)
          try {
            if (active && active.outDir && active.videoPath) {
              if (!extractionsScheduled.has(active.outDir)) {
                extractionsScheduled.add(active.outDir);
                runExtractionWhenReady(active.outDir, active.videoPath);
              }
            }
          } catch {}

          return;
        }

        // ROI 세션이 없으면 기존 동작: 사용자가 저장 위치 선택
        const { dialog } = require("electron");
        const fs = require("fs");
        const path = require("path");
        const defaultFilename = `key-recording-${new Date()
          .toISOString()
          .replace(/[:]/g, "-")}.json`;
        const { filePath } = await dialog.showSaveDialog({
          defaultPath: path.join(app.getPath("documents"), defaultFilename),
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        if (filePath) {
          fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
          [this.mainWindow, this.overlayWindow].forEach((win) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("recording-saved", {
                success: true,
                path: filePath,
                count: payload?.events?.length || 0,
              });
            }
          });
        } else {
          [this.mainWindow, this.overlayWindow].forEach((win) => {
            if (win && !win.isDestroyed()) {
              win.webContents.send("recording-saved", {
                success: false,
                canceled: true,
              });
            }
          });
        }
      } catch (err) {
        console.error("Failed to save recording:", err);
        [this.mainWindow, this.overlayWindow].forEach((win) => {
          if (win && !win.isDestroyed()) {
            win.webContents.send("recording-saved", {
              success: false,
              error: err.message,
            });
          }
        });
      }
    });

    // 노트 효과 상세 설정 IPC
    ipcMain.handle("get-note-settings", () => {
      const defaults = {
        borderRadius: 2,
        speed: 180,
        trackHeight: 150,
        reverse: false,
        fadePosition: "auto",
      };
      const settings = store.get("noteSettings", defaults) || defaults;
      const normalized = { ...defaults, ...settings };
      if (
        settings.borderRadius === undefined ||
        settings.speed === undefined ||
        settings.trackHeight === undefined ||
        settings.reverse === undefined ||
        settings.fadePosition === undefined
      ) {
        store.set("noteSettings", normalized);
      }
      return normalized;
    });

    ipcMain.handle("update-note-settings", (_, newSettings) => {
      try {
        const defaults = {
          borderRadius: 2,
          speed: 180,
          trackHeight: 150,
          reverse: false,
        };
        const fadeDefault = "auto";
        const br = parseInt(newSettings?.borderRadius ?? defaults.borderRadius);
        const sp = parseInt(newSettings?.speed ?? defaults.speed);
        const th = parseInt(newSettings?.trackHeight ?? defaults.trackHeight);
        const rv =
          newSettings?.reverse === undefined
            ? defaults.reverse
            : !!newSettings.reverse;
        // fadePosition: 'auto' | 'top' | 'bottom'
        const incomingFade =
          (newSettings && newSettings.fadePosition) || fadeDefault;
        const validFade = ["auto", "top", "bottom"].includes(incomingFade)
          ? incomingFade
          : fadeDefault;
        const normalized = {
          ...defaults,
          ...newSettings,
          borderRadius: Math.max(
            1,
            Math.min(Number.isFinite(br) ? br : defaults.borderRadius, 100)
          ),
          speed: Math.max(
            70,
            Math.min(Number.isFinite(sp) ? sp : defaults.speed, 1000)
          ),
          trackHeight: Math.max(
            20,
            Math.min(Number.isFinite(th) ? th : defaults.trackHeight, 2000)
          ),
          reverse: rv,
          fadePosition: validFade,
        };
        store.set("noteSettings", normalized);
        [this.mainWindow, this.overlayWindow].forEach((window) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send("update-note-settings", normalized);
          }
        });
        return true;
      } catch (err) {
        console.error("Failed to update note settings:", err);
        return false;
      }
    });

    // ANGLE 모드 설정
    ipcMain.on("set-angle-mode", (_, mode) => {
      store.set("angleMode", mode);
    });

    ipcMain.handle("get-angle-mode", () => {
      return store.get("angleMode", "d3d11");
    });

    // 프리셋 저장하기
    ipcMain.handle("save-preset", async () => {
      const { dialog } = require("electron");
      const path = require("path");

      // 현재 설정들을 가져옴
      const preset = {
        keys: store.get("keys"),
        keyPositions: store.get("keyPositions"),
        backgroundColor: store.get("backgroundColor"),
        noteSettings: store.get("noteSettings", {
          borderRadius: 2,
          speed: 180,
          trackHeight: 150,
          reverse: false,
        }),
      };

      const { filePath } = await dialog.showSaveDialog({
        defaultPath: path.join(app.getPath("documents"), "preset.json"),
        filters: [{ name: "DM NOTE Preset", extensions: ["json"] }],
      });

      if (filePath) {
        try {
          require("fs").writeFileSync(
            filePath,
            JSON.stringify(preset, null, 2)
          );
          return true;
        } catch (err) {
          console.error("Failed to save preset:", err);
          return false;
        }
      }
      return false;
    });

    // 프리셋 불러오기
    ipcMain.handle("load-preset", async () => {
      const { dialog } = require("electron");

      const { filePaths } = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "DM NOTE Preset", extensions: ["json"] }],
      });

      if (filePaths.length > 0) {
        try {
          const preset = JSON.parse(
            require("fs").readFileSync(filePaths[0], "utf8")
          );

          // 설정 적용
          store.set("keys", preset.keys);
          store.set("keyPositions", preset.keyPositions);
          store.set("backgroundColor", preset.backgroundColor);
          // 노트 설정 적용 (호환 범위로 정규화)
          const defaults = { borderRadius: 2, speed: 180 };
          const incoming = preset.noteSettings || {};
          const br = parseInt(incoming.borderRadius ?? defaults.borderRadius);
          const sp = parseInt(incoming.speed ?? defaults.speed);
          const normalized = {
            borderRadius: Math.max(
              1,
              Math.min(Number.isFinite(br) ? br : defaults.borderRadius, 100)
            ),
            speed: Math.max(
              70,
              Math.min(Number.isFinite(sp) ? sp : defaults.speed, 1000)
            ),
          };
          store.set("noteSettings", normalized);
          // noteSettings normalized above; legacy branch removed

          keyboardService.updateKeyMapping(preset.keys);

          [this.overlayWindow, this.mainWindow].forEach((window) => {
            window.webContents.send("updateKeyMappings", preset.keys);
            window.webContents.send("updateKeyPositions", preset.keyPositions);
            window.webContents.send(
              "updateBackgroundColor",
              preset.backgroundColor
            );
            window.webContents.send(
              "update-note-settings",
              store.get("noteSettings", { borderRadius: 2, speed: 180 })
            );
          });

          return true;
        } catch (err) {
          console.error("Failed to load preset:", err);
          return false;
        }
      }
      return false;
    });

    // 커스텀 CSS 핸들러 ---
    ipcMain.handle("load-custom-css", async () => {
      const { dialog } = require("electron");
      const fs = require("fs");

      const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "CSS", extensions: ["css"] }],
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false };
      }

      try {
        const content = fs.readFileSync(filePaths[0], "utf8");
        store.set("customCSS", { path: filePaths[0], content });
        // forward to both windows
        [this.mainWindow, this.overlayWindow].forEach((window) => {
          if (window && !window.isDestroyed()) {
            window.webContents.send("update-custom-css", content);
          }
        });
        return { success: true, content, path: filePaths[0] };
      } catch (err) {
        console.error("Failed to read custom css:", err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle("get-custom-css", () => {
      return store.get("customCSS", { path: null, content: "" });
    });

    ipcMain.on("toggle-custom-css", (_, enabled) => {
      store.set("useCustomCSS", enabled);
      [this.mainWindow, this.overlayWindow].forEach((window) => {
        if (window && !window.isDestroyed()) {
          window.webContents.send("update-use-custom-css", enabled);
          if (enabled) {
            const css = store.get("customCSS", { content: "" }).content || "";
            window.webContents.send("update-custom-css", css);
          }
        }
      });
    });

    ipcMain.handle("get-use-custom-css", () => {
      return store.get("useCustomCSS", false);
    });

    // 오버레이 리사이즈 기준점 저장/조회
    ipcMain.handle("set-overlay-resize-anchor", (_, anchor) => {
      const valid = [
        "top-left",
        "bottom-left",
        "top-right",
        "bottom-right",
        "center",
      ];
      const value = valid.includes(anchor) ? anchor : "top-left";
      store.set("overlayResizeAnchor", value);
      return value;
    });

    ipcMain.handle("get-overlay-resize-anchor", () => {
      return store.get("overlayResizeAnchor", "top-left");
    });

    // ROI 좌표 저장/조회 (Windows 가상 데스크탑 물리 픽셀 기준)
    ipcMain.handle("get-roi-settings", () => {
      const defaults = { x: 0, y: 0, width: 1280, height: 720 };
      const roi = store.get("roiRect", defaults) || defaults;
      const toInt = (v, d) => {
        const n = parseInt(v);
        return Number.isFinite(n) ? n : d;
      };
      const normalized = {
        x: Math.max(0, toInt(roi.x, 0)),
        y: Math.max(0, toInt(roi.y, 0)),
        width: Math.max(1, toInt(roi.width, 1280)),
        height: Math.max(1, toInt(roi.height, 720)),
      };
      if (
        normalized.x !== roi.x ||
        normalized.y !== roi.y ||
        normalized.width !== roi.width ||
        normalized.height !== roi.height
      ) {
        store.set("roiRect", normalized);
      }
      return normalized;
    });

    ipcMain.handle("update-roi-settings", (_, incoming) => {
      try {
        const current =
          store.get("roiRect", { x: 0, y: 0, width: 1280, height: 720 }) || {};
        const toInt = (v, d) => {
          const n = parseInt(v);
          return Number.isFinite(n) ? n : d;
        };
        const next = {
          x: Math.max(0, toInt(incoming?.x ?? current.x ?? 0, current.x ?? 0)),
          y: Math.max(0, toInt(incoming?.y ?? current.y ?? 0, current.y ?? 0)),
          width: Math.max(
            1,
            toInt(
              incoming?.width ?? current.width ?? 1280,
              current.width ?? 1280
            )
          ),
          height: Math.max(
            1,
            toInt(
              incoming?.height ?? current.height ?? 720,
              current.height ?? 720
            )
          ),
        };
        store.set("roiRect", next);
        return next;
      } catch (err) {
        console.error("Failed to update ROI settings:", err);
        return store.get("roiRect", { x: 0, y: 0, width: 1280, height: 720 });
      }
    });

    // URL 열기 요청 처리
    ipcMain.on("open-external", (_, url) => {
      shell.openExternal(url);
    });

    // 앱 재시작
    ipcMain.on("restart-app", () => {
      app.relaunch();
      app.exit(0);
    });

    // 오버레이 동적 리사이즈
    // 기존 호출은 {width, height} 만 보내도 동작하도록 유지합니다.
    ipcMain.on("resize-overlay", (_, payload) => {
      try {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          const width = payload?.width;
          const height = payload?.height;
          const anchor =
            payload?.anchor || store.get("overlayResizeAnchor", "top-left");

          // 최소/최대 값 가드 (이상치 방지)
          const safeWidth = Math.max(100, Math.min(Math.round(width), 2000));
          const safeHeight = Math.max(100, Math.min(Math.round(height), 2000));

          const bounds = this.overlayWindow.getBounds();
          const oldX = bounds.x;
          const oldY = bounds.y;
          const oldW = bounds.width;
          const oldH = bounds.height;

          // 변경이 없으면 바로 리턴
          if (oldW === safeWidth && oldH === safeHeight) return;

          // Windows에서 resizable:false 상태에서는 축소가 제한될 수 있으므로 임시로 활성화
          const wasResizable = this.overlayWindow.isResizable();
          if (!wasResizable) this.overlayWindow.setResizable(true);

          // anchor 기준으로 새로운 좌표 계산
          let newX = oldX;
          let newY = oldY;
          switch ((anchor || "top-left").toString()) {
            case "bottom-left":
              newY = oldY + oldH - safeHeight;
              break;
            case "top-right":
              newX = oldX + oldW - safeWidth;
              break;
            case "bottom-right":
              newX = oldX + oldW - safeWidth;
              newY = oldY + oldH - safeHeight;
              break;
            case "center":
              newX = oldX + Math.round((oldW - safeWidth) / 2);
              newY = oldY + Math.round((oldH - safeHeight) / 2);
              break;
            case "top-left":
            default:
              // 기본: 좌상단 고정 (기존 동작)
              break;
          }

          // 경계값 정수로 보정
          newX = Math.round(newX);
          newY = Math.round(newY);

          // 위치 + 크기 동시 적용
          this.overlayWindow.setBounds({
            x: newX,
            y: newY,
            width: safeWidth,
            height: safeHeight,
          });

          if (!wasResizable) this.overlayWindow.setResizable(false);

          // obs 포커스 이슈 대응
          setTimeout(() => {
            if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
              try {
                this.overlayWindow.setBounds({
                  x: newX,
                  y: newY,
                  width: safeWidth + 1,
                  height: safeHeight + 1,
                });
              } catch {}
            }
          }, 10);

          setTimeout(() => {
            if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
              try {
                this.overlayWindow.setBounds({
                  x: newX,
                  y: newY,
                  width: safeWidth,
                  height: safeHeight,
                });
              } catch {}
            }
          }, 26);
        }
      } catch (err) {
        console.error("Failed to resize overlay window:", err);
      }
    });
  }

  createWindows() {
    // 미리 저장된 키 모드를 키보드 서비스에 적용(렌더러 로드 전, 초기 동기화 보장)
    try {
      const savedMode = store.get("selectedKeyType", "4key");
      const mappings = keyboardService.getKeyMappings
        ? keyboardService.getKeyMappings()
        : {};
      const validModes = Object.keys(mappings || {});
      const initialMode = validModes.includes(savedMode) ? savedMode : "4key";
      keyboardService.setKeyMode(initialMode);
      // 정규화된 값을 다시 저장
      store.set("selectedKeyType", initialMode);
    } catch (err) {
      console.error("Failed to pre-apply key mode:", err);
    }

    const mainWindowInstance = new MainWindow();
    const overlayWindowInstance = new OverlayWindow();

    this.mainWindow = mainWindowInstance.create();
    this.overlayWindow = overlayWindowInstance.create();

    global.mainWindow = this.mainWindow;

    // 오버레이가 로드 완료되면 현재 모드 및 상태를 즉시 푸시하여 초기 동기화 보장
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.on("did-finish-load", () => {
        try {
          const mode = keyboardService.getCurrentMode();
          this.overlayWindow.webContents.send("keyModeChanged", mode);
          // overlay App은 'currentMode' 채널도 수신하도록 되어 있으므로 함께 전송
          this.overlayWindow.webContents.send("currentMode", mode);

          // 안전하게 현재 상태도 함께 동기화
          this.overlayWindow.webContents.send(
            "updateKeyMappings",
            keyboardService.getKeyMappings()
          );
          this.overlayWindow.webContents.send(
            "updateKeyPositions",
            loadKeyPositions()
          );
          this.overlayWindow.webContents.send(
            "updateBackgroundColor",
            loadBackgroundColor()
          );
          this.overlayWindow.webContents.send(
            "update-note-settings",
            store.get("noteSettings", {
              borderRadius: 2,
              speed: 180,
              trackHeight: 150,
              reverse: false,
            })
          );
        } catch (err) {
          console.error("Failed to sync overlay initial state:", err);
        }
      });
    }

    this.mainWindow.on("closed", () => {
      mainWindowInstance.cleanup();
      if (!this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close();
      }
    });

    keyboardService.setOverlayWindow(this.overlayWindow);
    keyboardService.startListening();

    // 앱 시작 시 저장된 키 모드 적용
    try {
      const savedMode = store.get("selectedKeyType", "4key");
      const mappings = keyboardService.getKeyMappings
        ? keyboardService.getKeyMappings()
        : {};
      const validModes = Object.keys(mappings || {});
      const initialMode = validModes.includes(savedMode) ? savedMode : "4key";
      keyboardService.setKeyMode(initialMode);
      // 정규화된 값을 다시 저장
      store.set("selectedKeyType", initialMode);

      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send("keyModeChanged", initialMode);
      }
    } catch (err) {
      console.error("Failed to apply initial key mode:", err);
    }
  }

  handleWindowsClosed() {
    keyboardService.stopListening();
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
    }
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.destroy();
    }
    app.quit();
  }
}

new Application().init();
