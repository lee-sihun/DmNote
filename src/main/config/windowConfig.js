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
  }, overlay: {
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
    // 성능 최적화 설정
    paintWhenInitiallyHidden: false,
    backgroundThrottling: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableBlinkFeatures: 'CSSContainment',
      disableBlinkFeatures: 'VSync', // VSync 비활성화로 지연 최소화 (테어링 문제 체크 필요)
      // GPU 가속 및 렌더링 최적화
      experimentalFeatures: true,
      forceHardwareAcceleration: true,
      enableGpuSandbox: false,
      // 메모리 최적화
      nodeIntegrationInSubFrames: false,
      additionalArguments: [
        '--disable-frame-rate-limit',
        '--disable-vsync',
        '--max-active-webgl-contexts=0',
        '--disable-features=TranslateUI',
        '--disable-component-update'
      ]
    }
  }
}