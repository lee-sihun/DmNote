const { BrowserWindow, screen } = require('electron/main')
const path = require('node:path')
const windowConfig = require('../config/windowConfig')
const Store = require('electron-store')

const WINDOW_POSITION_KEY = 'overlayWindowPosition'

class OverlayWindow {
  constructor() {
    this.window = null
    this.store = new Store()
  }

  create() {
    this.window = new BrowserWindow(windowConfig.overlay)
    this.restorePosition()
    this.disableContextMenu()
    this.loadContent()

    // 개발자 도구 단축키 비활성화
    this.window.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault()
      }
    })

    this.window.on('close', (event) => {
      // 앱이 종료중이 아니라면 닫기 동작 취소
      if (!global.isAppQuitting) {
        event.preventDefault()
        this.window.hide()
        this.window.webContents.send('overlay-visibility-changed', false)
        if (global.mainWindow && !global.mainWindow.isDestroyed()) {
          global.mainWindow.webContents.send('overlay-visibility-changed', false)
        }
      }
    })

    // 최상위 레벨 설정 추가
    const store = require('electron-store');
    const settings = new store();
    const alwaysOnTop = settings.get('alwaysOnTop', true);
    this.window.setAlwaysOnTop(alwaysOnTop, 'screen-saver', 1);

    // 포커스 관련 이벤트
    this.window.on('blur', () => {
      if (!this.window.isDestroyed()) {
        const currentSetting = settings.get('alwaysOnTop', true);
        this.window.setAlwaysOnTop(currentSetting, 'screen-saver', 1);
      }
    });

    // 윈도우 위치 저장
    this.window.on('moved', () => {
      const [x, y] = this.window.getPosition()
      this.store.set(WINDOW_POSITION_KEY, { x, y })
    })

    // 오버레이 고정 설정
    const overlayLocked = settings.get('overlayLocked', true);
    this.window.setIgnoreMouseEvents(overlayLocked, { forward: true });

    return this.window
  }

  restorePosition() {
    const savedPosition = this.store.get(WINDOW_POSITION_KEY)
    if (savedPosition) {
      this.window.setPosition(savedPosition.x, savedPosition.y)
    } else {
      this.setDefaultPosition()
    }
  }

  setDefaultPosition() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    this.window.setPosition(width - 860, height - 320)
  }

  // 컨텍스트 메뉴 비활성화
  disableContextMenu() {
    const WM_INITMENU = 0x0116
    this.window.hookWindowMessage(WM_INITMENU, () => {
      this.window.setEnabled(false)
      this.window.setEnabled(true)
    })
  }

  loadContent() {
    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) {
      this.window.loadURL('http://localhost:3000/overlay.html')
    } else {
      this.window.loadFile(path.join(__dirname, '..', '..', '..', 'dist', 'renderer', 'overlay.html'))
    }
  }
}

module.exports = OverlayWindow