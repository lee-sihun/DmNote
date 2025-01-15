const { app, ipcMain } = require('electron/main')
const MainWindow = require('./windows/mainWindow')
const OverlayWindow = require('./windows/overlayWindow')
const keyboardService = require('./services/keyboardListener')
const { resetKeys } = require('./services/keyMappings')
const { loadKeyPositions, saveKeyPositions, resetKeyPositions } = require('./services/keyPositions')
const { saveBackgroundColor, loadBackgroundColor, resetBackgroundColor } = require('./services/backgroundColor')
const Store = require('electron-store');
const store = new Store();

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
    // 하드웨어 가속 설정
    if (store.get('hardwareAcceleration') === undefined) {
      store.set('hardwareAcceleration', true);
    }
    
    const hwAccel = store.get('hardwareAcceleration');
    if (!hwAccel) {
      app.disableHardwareAcceleration();
    }

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

    // 윈도우 컨트롤
    ipcMain.on('minimize-window', () => this.mainWindow.minimize())
    ipcMain.on('close-window', () => {
      this.mainWindow.close()
      this.overlayWindow.close()
    })

    // 키 모드 변경
    ipcMain.on('setKeyMode', (e, mode) => {
      if (keyboardService.setKeyMode(mode)) {
        this.overlayWindow.webContents.send('keyModeChanged', mode);
        e.reply('keyModeUpdated', true);
      } else {
        e.reply('keyModeUpdated', false);
      }
    });

    ipcMain.on('getCurrentMode', (e) => {
      e.reply('currentMode', keyboardService.getCurrentMode());
    });

    // 키매핑 요청 처리
    ipcMain.on('getKeyMappings', (e) => {
      e.reply('updateKeyMappings', keyboardService.getKeyMappings())
    })

    ipcMain.on('update-key-mapping', (e, keys) => {
      keyboardService.updateKeyMapping(keys);
      this.overlayWindow.webContents.send('updateKeyMappings', keys);
    })

    // 키포지션 요청 처리
    ipcMain.on('getKeyPositions', (e) => {
      e.reply('updateKeyPositions', loadKeyPositions());
    });

    ipcMain.on('update-key-positions', (e, positions) => {
      saveKeyPositions(positions);
      this.overlayWindow.webContents.send('updateKeyPositions', positions);
    });

    // 배경색 요청 처리 
    ipcMain.on('getBackgroundColor', (e) => {
      e.reply('updateBackgroundColor', loadBackgroundColor());
    });

    ipcMain.on('update-background-color', (e, color) => {
      saveBackgroundColor(color);
      this.overlayWindow.webContents.send('updateBackgroundColor', color);
    });

    // 초기화 요청 처리
    ipcMain.on('reset-keys', (e) => {
      const defaultKeys = resetKeys();
      const defaultPositions = resetKeyPositions();
      const defaultColor = resetBackgroundColor();

      keyboardService.updateKeyMapping(defaultKeys);

      this.overlayWindow.webContents.send('updateKeyMappings', defaultKeys);
      this.overlayWindow.webContents.send('updateKeyPositions', defaultPositions);
      this.overlayWindow.webContents.send('updateBackgroundColor', defaultColor);

      // 모든 데이터를 한 번에 보내는 새로운 이벤트
      e.reply('resetComplete', {
        keys: defaultKeys,
        positions: defaultPositions,
        color: defaultColor
      });
    });

    // 하드웨어 가속 토글 
    ipcMain.handle('toggle-hardware-acceleration', async (_, enabled) => {
      store.set('hardwareAcceleration', enabled);
      return true;
    });

    ipcMain.on('get-hardware-acceleration', (e) => {
      e.reply('update-hardware-acceleration', store.get('hardwareAcceleration'));
    });

    // 앱 재시작
    ipcMain.on('restart-app', () => {
      app.relaunch();
      app.exit(0);
    });
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