module.exports = {
  main: {
    width: 902,
    height: 488,
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
      contextIsolation: false,
      enableBlinkFeatures: 'CSSContainment',
      disableBlinkFeatures: 'VSync', // VSync 비활성화로 지연 최소화 (테어링 문제 체크 필요)
    }
  }
}