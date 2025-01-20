module.exports = {
  main: {
    width: 898,
    height: 481,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    transparent: true,
    backgroundColor: 'rgba(0,0,0,0)',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    // 렌더링 최적화
    vibrancy: 'under-window',
    visualEffectState: 'active',
    paintWhenInitiallyHidden: true,
    backgroundThrottling: false
  },
  overlay: {
    width: 860,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: 'rgba(0,0,0,0)',
    alwaysOnTop: true,
    // skipTaskbar: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  }
}