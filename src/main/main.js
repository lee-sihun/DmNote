const { app, BrowserWindow, screen, ipcMain } = require('electron/main')
const path = require('node:path')
const { GlobalKeyboardListener } = require('node-global-key-listener')

// 메인 프로세스 코드 변경 시 자동 재시작
if (process.env.NODE_ENV === 'development') {
  try {
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: false,
      ignore: [
        'node_modules/*',
        'src/renderer/*',
      ]
    });
  } catch (_) { console.log('Error'); }
}

const v = new GlobalKeyboardListener()

function handleKeyPress(e) {
  const key = e.name;
  const state = e.state;

  switch (key) {
    case "Z":
    case "X":
    case "DOT":
    case "FORWARD SLASH":
      console.log(`Pressed: ${key} ${state}`);
      BrowserWindow.getAllWindows()[0].webContents.send('keyState', { key, state });
      break;
  }
}

//  키보드 리스너 설정 - 디버깅용
//  v.addListener(function (e) { 
//   console.log('키 입력 감지:', {
//     name: e.name,           // 키 이름
//     state: e.state,         // 상태 (UP/DOWN)
//     rawKey: e.rawKey,       // raw 키코드
//     vKey: e.vKey,          // 가상 키코드
//     scanCode: e.scanCode,   // 스캔 코드
//     modifiers: e.modifiers  // 수정자 키
//   });
// });

function createWindow() {
  // 메인 윈도우
  const win = new BrowserWindow({
    width: 900,
    height: 485,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // 컨텍스트 메뉴 비활성화 
  const WM_INITMENU = 0x0116;
  win.hookWindowMessage(WM_INITMENU, () => {
    win.setEnabled(false);
    win.setEnabled(true);
  });

  win.setResizable(false); // 크기 조절 방지 
  win.setMaximizable(false); // 최대화 방지

  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:3000/index.html');
  } else {
    win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  }

  // 오버레이 윈도우
  const overlay = new BrowserWindow({
    width: 400,
    height: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      // preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: false
    },
  })

  // 화면 크기 얻기
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  // 우하단 위치 계산 및 설정
  overlay.setPosition(width - 400, height - 100)

  // overlay.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'overlay.html'));

  if (process.env.NODE_ENV === 'development') {
    overlay.loadURL('http://localhost:3000/overlay.html');
  } else {
    overlay.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'overlay.html'));
  }

  // 메인 윈도우 종료 시 오버레이도 함께 종료
  win.on('closed', () => {
    if (!overlay.isDestroyed()) {
      overlay.close()
    }
  })

  ipcMain.on('minimize-window', () => {
    win.minimize()
  })

  ipcMain.on('close-window', () => {
    win.close()
    overlay.close()
  })
}

app.whenReady().then(() => {
  v.addListener(handleKeyPress)
  createWindow()
})

app.on('window-all-closed', () => {
  v.kill()
  app.quit()
})