const { app, ipcMain } = require('electron/main')
const MainWindow = require('./windows/mainWindow')
const OverlayWindow = require('./windows/overlayWindow')
const keyboardService = require('./services/keyboardListener')

// main 코드 변경 시 자동 재시작
if (process.env.NODE_ENV === 'development') {
  try {
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: false,
      ignore: ['node_modules/*', 'src/renderer/*'],
      paths: ['src/main/**/*']
    })
  } catch (err) { console.log(err) }
}

class Application {
  constructor() {
    this.mainWindow = null
    this.overlayWindow = null
  }

  init() {
    this.setupEventListeners()
  }

  setupEventListeners() {
    // ANGLE 백엔드 설정 (d3d11, d3d9, gl, default)
    app.commandLine.appendSwitch('use-angle', 'd3d9')
    app.whenReady().then(() => this.createWindows())
    app.on('window-all-closed', this.handleWindowsClosed.bind(this))
    // app.disableHardwareAcceleration()

    ipcMain.on('minimize-window', () => this.mainWindow.minimize())
    ipcMain.on('close-window', () => {
      this.mainWindow.close()
      this.overlayWindow.close()
    })
    
    ipcMain.on('getKeyMappings', (e) => {
      e.reply('updateKeyMappings', keyboardService.getKeyMappings())
    })

    // 키매핑이 업데이트 되었을 때 오버레이에 전달
    ipcMain.on('update-key-mapping', (e, keys) => {
      keyboardService.updateKeyMapping(keys);
      this.overlayWindow.webContents.send('updateKeyMappings', keys);
    })
  }

  createWindows() {
    const mainWindowInstance = new MainWindow()
    const overlayWindowInstance = new OverlayWindow()

    this.mainWindow = mainWindowInstance.create()
    this.overlayWindow = overlayWindowInstance.create()

    this.mainWindow.on('closed', () => {
      mainWindowInstance.cleanup()
      if (!this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close()
      }
    })

    keyboardService.setOverlayWindow(this.overlayWindow)
    keyboardService.startListening()
  }

  handleWindowsClosed() {
    keyboardService.stopListening()
    app.quit()
  }
}

new Application().init()