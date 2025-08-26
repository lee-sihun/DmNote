const { app, ipcMain, shell } = require("electron/main");
const MainWindow = require("./windows/mainWindow");
const OverlayWindow = require("./windows/overlayWindow");
const keyboardService = require("./services/keyboardListener");
const { resetKeys } = require("./services/keyMappings");
const {
  loadKeyPositions,
  saveKeyPositions,
  resetKeyPositions,
} = require("./services/keyPositions");
const {
  saveBackgroundColor,
  loadBackgroundColor,
  resetBackgroundColor,
} = require("./services/backgroundColor");
const Store = require("electron-store");
const store = new Store();

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
        this.overlayWindow.webContents.send("keyModeChanged", mode);
        e.reply("keyModeUpdated", true);
      } else {
        e.reply("keyModeUpdated", false);
      }
    });

    ipcMain.on("getCurrentMode", (e) => {
      e.reply("currentMode", keyboardService.getCurrentMode());
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

      // CSS 관련 상태들 초기화
      store.set("useCustomCSS", false);
      store.set("customCSS", { path: null, content: "" });

      keyboardService.updateKeyMapping(defaultKeys);

      this.overlayWindow.webContents.send("updateKeyMappings", defaultKeys);
      this.overlayWindow.webContents.send(
        "updateKeyPositions",
        defaultPositions
      );
      this.overlayWindow.webContents.send(
        "updateBackgroundColor",
        defaultColor
      );

      // CSS 초기화 알림
      this.overlayWindow.webContents.send("update-use-custom-css", false);
      this.overlayWindow.webContents.send("update-custom-css", "");

      // 모든 데이터를 한 번에 보내는 새로운 이벤트
      e.reply("resetComplete", {
        keys: defaultKeys,
        positions: defaultPositions,
        color: defaultColor,
      });
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
        this.overlayWindow.setAlwaysOnTop(enabled, "normal", 1);
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

          keyboardService.updateKeyMapping(preset.keys);

          [this.overlayWindow, this.mainWindow].forEach((window) => {
            window.webContents.send("updateKeyMappings", preset.keys);
            window.webContents.send("updateKeyPositions", preset.keyPositions);
            window.webContents.send(
              "updateBackgroundColor",
              preset.backgroundColor
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
        // forward to overlay window
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          this.overlayWindow.webContents.send("update-custom-css", content);
        }
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
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.webContents.send("update-use-custom-css", enabled);
        if (enabled) {
          const css = store.get("customCSS", { content: "" }).content || "";
          this.overlayWindow.webContents.send("update-custom-css", css);
        }
      }
    });

    ipcMain.handle("get-use-custom-css", () => {
      return store.get("useCustomCSS", false);
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
    ipcMain.on("resize-overlay", (_, { width, height }) => {
      try {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
          // 최소/최대 값 가드 (이상치 방지)
          const safeWidth = Math.max(100, Math.min(Math.round(width), 2000));
          const safeHeight = Math.max(100, Math.min(Math.round(height), 2000));
          const [currentW, currentH] = this.overlayWindow.getSize();
          if (currentW !== safeWidth || currentH !== safeHeight) {
            // Windows에서 resizable:false 상태에서는 축소가 제한될 수 있으므로 임시로 활성화
            const wasResizable = this.overlayWindow.isResizable();
            if (!wasResizable) this.overlayWindow.setResizable(true);
            this.overlayWindow.setSize(safeWidth, safeHeight);
            if (!wasResizable) this.overlayWindow.setResizable(false);
          }
        }
      } catch (err) {
        console.error("Failed to resize overlay window:", err);
      }
    });
  }

  createWindows() {
    const mainWindowInstance = new MainWindow();
    const overlayWindowInstance = new OverlayWindow();

    this.mainWindow = mainWindowInstance.create();
    this.overlayWindow = overlayWindowInstance.create();

    global.mainWindow = this.mainWindow;

    this.mainWindow.on("closed", () => {
      mainWindowInstance.cleanup();
      if (!this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close();
      }
    });

    keyboardService.setOverlayWindow(this.overlayWindow);
    keyboardService.startListening();
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
