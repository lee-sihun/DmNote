const { BrowserWindow } = require('electron/main')
const path = require('node:path')
const windowConfig = require('../config/windowConfig')

class MainWindow {
  constructor() {
    this.window = null
    this.backgroundInterval = null
  }

  create() {
    this.window = new BrowserWindow({
      ...windowConfig.main,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js')
      }
    })

    this.disableContextMenu()
    this.loadContent()
    // this.setupBackgroundOptimization()
    
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

  // // 테두리 라운딩 렌더링 최적화 
  // setupBackgroundOptimization() {
  //   this.backgroundInterval = setInterval(() => {
  //     if (!this.window.isDestroyed() && this.window.isVisible()) {
  //       this.window.setBackgroundColor('rgba(0,0,0,0)')
  //     }
  //   }, 500)
  // }

  cleanup() {
    clearInterval(this.backgroundInterval)
  }
}

module.exports = MainWindow