const { BrowserWindow, screen } = require('electron/main')
const path = require('node:path')
const windowConfig = require('../config/windowConfig')

class OverlayWindow {
  constructor() {
    this.window = null
  }

  create() {
    this.window = new BrowserWindow(windowConfig.overlay)
    this.setPosition()
    this.disableContextMenu()
    this.loadContent()

    // 개발자 도구 단축키 비활성화
    this.window.webContents.on('before-input-event', (event, input) => {
      if (input.control && input.shift && input.key.toLowerCase() === 'i') {
        event.preventDefault()
      }
    })

    // 최상위 레벨 설정 추가
    this.window.setAlwaysOnTop(true, 'screen-saver', 1);
    
    // 포커스 관련 이벤트
    this.window.on('blur', () => {
      if (!this.window.isDestroyed()) {
        this.window.setAlwaysOnTop(true, 'screen-saver', 1);
      }
    });

    // 클릭 투과 설정
    // this.window.setIgnoreMouseEvents(true, { forward: true })
    
    return this.window
  }

  setPosition() {
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