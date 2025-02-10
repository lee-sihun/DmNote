const { BrowserWindow } = require('electron/main')
const path = require('node:path')
const windowConfig = require('../config/windowConfig')
const keyboardService = require('../services/keyboardListener')

class MainWindow {
  constructor() {
    this.window = null
    this.backgroundInterval = null
  }

  create() {
    this.window = new BrowserWindow({
      ...windowConfig.main,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        devTools: process.env.NODE_ENV === 'development' // 개발 모드에서만 devTools 활성화
      }
    })

    // 윈도우 종료 이벤트 처리 추가
    this.window.on('close', () => {
      global.isAppQuitting = true;
      keyboardService.stopListening() // 키보드 서비스 정지
      if (this.backgroundInterval) {
        clearInterval(this.backgroundInterval)
      }
    });

    this.disableContextMenu()
    this.loadContent()
    // this.setupBackgroundOptimization()

    // // 개발자 도구 단축키 비활성화
    // this.window.webContents.on('before-input-event', (event, input) => {
    //   if (input.control && input.shift && input.key.toLowerCase() === 'i') {
    //     event.preventDefault()
    //   }
    // })

    return this.window
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
      this.window.loadURL('http://localhost:3000/index.html')
    } else {
      this.window.loadFile(path.join(__dirname, '..', '..', '..', 'dist', 'renderer', 'index.html'))
    }
  }

  cleanup() {
    clearInterval(this.backgroundInterval)
  }
}

module.exports = MainWindow