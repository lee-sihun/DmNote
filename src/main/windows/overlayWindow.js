const { BrowserWindow, screen } = require("electron/main");
const path = require("node:path");
const windowConfig = require("../config/windowConfig");
const Store = require("electron-store");

const WINDOW_POSITION_KEY = "overlayWindowPosition";
const WINDOW_BOUNDS_KEY = "overlayWindowBounds";

class OverlayWindow {
  constructor() {
    this.window = null;
    this.store = new Store();
  }

  create() {
    this.window = new BrowserWindow(windowConfig.overlay);
    this.window.setTitle("DM Note - Overlay");
    this.restorePosition();
    this.disableContextMenu();
    this.loadContent();

    // 렌더러 프로세스 우선순위 높이기
    this.window.webContents.setFrameRate(0); // 프레임 제한 해제

    // 개발자 도구 단축키 비활성화
    const isDev = process.env.NODE_ENV === "development";
    if (!isDev) {
      this.window.webContents.on("before-input-event", (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === "i") {
          event.preventDefault();
        }
      });
    }

    this.window.on("close", (event) => {
      // 앱이 종료중이 아니라면 닫기 동작 취소
      if (!global.isAppQuitting) {
        event.preventDefault();
        this.window.hide();
        this.window.webContents.send("overlay-visibility-changed", false);
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send(
            "overlay-visibility-changed",
            false
          );
        }
      }
    });

    // 최상위 레벨 설정 추가
    const store = require("electron-store");
    const settings = new store();
    const alwaysOnTop = settings.get("alwaysOnTop", true);
    this.window.setAlwaysOnTop(alwaysOnTop, "screen-saver", 1);

    // 포커스 관련 이벤트
    this.window.on("blur", () => {
      if (!this.window.isDestroyed()) {
        const currentSetting = settings.get("alwaysOnTop", true);
        this.window.setAlwaysOnTop(currentSetting, "screen-saver", 1);
      }
    });

    // 윈도우 위치/크기 저장
    this.window.on("moved", () => {
      const b = this.window.getBounds();
      this.store.set(WINDOW_POSITION_KEY, { x: b.x, y: b.y });
      this.store.set(WINDOW_BOUNDS_KEY, b);
    });
    this.window.on("resized", () => {
      const b = this.window.getBounds();
      this.store.set(WINDOW_POSITION_KEY, { x: b.x, y: b.y });
      this.store.set(WINDOW_BOUNDS_KEY, b);
    });

    // 오버레이 고정 설정
    const overlayLocked = settings.get("overlayLocked", true);
    this.window.setIgnoreMouseEvents(overlayLocked, { forward: true });

    return this.window;
  }

  restorePosition() {
    const savedBounds = this.store.get(WINDOW_BOUNDS_KEY);
    const savedPosition = this.store.get(WINDOW_POSITION_KEY);
    // 가능하면 bounds로 복원 (크기 변동 포함)
    if (
      savedBounds &&
      typeof savedBounds.x === "number" &&
      typeof savedBounds.y === "number"
    ) {
      try {
        this.window.setBounds(savedBounds);
        return;
      } catch {}
    }
    if (
      savedPosition &&
      typeof savedPosition.x === "number" &&
      typeof savedPosition.y === "number"
    ) {
      this.window.setPosition(savedPosition.x, savedPosition.y);
    } else {
      this.setDefaultPosition();
    }
  }

  setDefaultPosition() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    this.window.setPosition(width - 860, height - 320);
  }

  // 컨텍스트 메뉴 비활성화
  disableContextMenu() {
    const WM_INITMENU = 0x0116;
    this.window.hookWindowMessage(WM_INITMENU, () => {
      this.window.setEnabled(false);
      this.window.setEnabled(true);
    });
  }

  loadContent() {
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
      this.window.loadURL("http://localhost:3000/overlay/index.html");
    } else {
      this.window.loadFile(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "dist",
          "renderer",
          "overlay",
          "index.html"
        )
      );
    }
  }
}

module.exports = OverlayWindow;
