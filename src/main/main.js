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

    // Always on Top 설정
    if (store.get('alwaysOnTop') === undefined) {
      store.set('alwaysOnTop', true);
    }

    // 오버레이 고정 설정
    if (store.get('overlayLocked') === undefined) {
      store.set('overlayLocked', false);
    }

    // ANGLE 모드 초기 설정
    if (store.get('angleMode') === undefined) {
      store.set('angleMode', 'd3d11');
    }

    // ANGLE 백엔드 설정 적용
    const angleMode = store.get('angleMode');
    app.commandLine.appendSwitch('use-angle', angleMode);

    this.mainWindow = null
    this.overlayWindow = null
  }

  init() {
    this.setupEventListeners()
  }

  setupEventListeners() {
    // ANGLE 백엔드 설정 (d3d11, d3d9, gl, default)
    // app.commandLine.appendSwitch('use-angle', 'd3d9')
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

    // 항상 위에 표시 토글
    ipcMain.on('toggle-always-on-top', (_, enabled) => {
      store.set('alwaysOnTop', enabled);
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.setAlwaysOnTop(enabled, 'screen-saver', 1);
      }
    });

    ipcMain.on('get-always-on-top', (e) => {
      e.reply('update-always-on-top', store.get('alwaysOnTop'));
    });

    ipcMain.on('overlay-toggle-ignore-mouse', (event, ignore) => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        if (ignore) {
          this.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
        } else {
          this.overlayWindow.setIgnoreMouseEvents(false);
        }
      }
    });

    // // 윈도우 위치 가져오기
    // ipcMain.handle('overlay-get-position', () => {
    //   if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
    //     return this.overlayWindow.getPosition();
    //   }
    //   return [0, 0];
    // });

    // // 윈도우 위치 설정
    // ipcMain.on('overlay-set-position', (e, x, y) => {
    //   if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
    //     this.overlayWindow.setPosition(x, y);
    //   }
    // });

    // ipcMain.on('overlay-move', (e, x, y) => {
    //   this.overlayWindow?.setPosition(
    //     this.overlayWindow.getPosition()[0] + x,
    //     this.overlayWindow.getPosition()[1] + y
    //   );
    // });

    // 키 카운트 표시 설정
    ipcMain.on('toggle-show-key-count', (_, value) => {
      store.set('showKeyCount', value);
      this.overlayWindow.webContents.send('update-show-key-count', value);
    });

    ipcMain.on('get-show-key-count', (e) => {
      const showKeyCount = store.get('showKeyCount', false);
      e.reply('update-show-key-count', showKeyCount);
    });

    ipcMain.on('reset-key-count', (e) => {
      const positions = loadKeyPositions();
      // 모든 키의 카운트를 0으로 초기화
      Object.keys(positions).forEach(mode => {
        positions[mode] = positions[mode].map(pos => ({
          ...pos,
          count: 0
        }));
      });
      saveKeyPositions(positions);
      this.overlayWindow.webContents.send('updateKeyPositions', positions);
    });

    // 오버레이 표시 여부
    ipcMain.handle('get-overlay-visibility', () => {
      return this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible();
    });
    
    ipcMain.on('toggle-overlay', (_, show) => {
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        if (show) {
          this.overlayWindow.show();
          // 오버레이가 표시될 때 현재 lock 상태 적용
          const isLocked = store.get('overlayLocked', false);
          this.overlayWindow.setIgnoreMouseEvents(isLocked, { forward: true });
        } else {
          this.overlayWindow.hide();
        }
      }
    });

    // 오버레이 고정 설정
    ipcMain.on('toggle-overlay-lock', (_, enabled) => {
      store.set('overlayLocked', enabled);
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.setIgnoreMouseEvents(enabled, { forward: true });
      }
    });
    
    ipcMain.on('get-overlay-lock', (e) => {
      e.reply('update-overlay-lock', store.get('overlayLocked'));
    });

    // ANGLE 모드 설정
    ipcMain.on('set-angle-mode', (_, mode) => {
      store.set('angleMode', mode);
    });

    ipcMain.handle('get-angle-mode', () => {
      return store.get('angleMode', 'd3d11');
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