const { GlobalKeyboardListener } = require('node-global-key-listener')

// name: e.name,           // 키 이름
// state: e.state,         // 상태 (UP/DOWN)
// rawKey: e.rawKey,       // raw 키코드
// vKey: e.vKey,          // 가상 키코드
// scanCode: e.scanCode,   // 스캔 코드
// modifiers: e.modifiers  // 수정자 키

class KeyboardService {
  constructor() {
    this.listener = new GlobalKeyboardListener()
    this.overlayWindow = null
  }

  setOverlayWindow(window) {
    this.overlayWindow = window
  }

  startListening() {
    this.listener.addListener(this.handleKeyPress.bind(this))
  }

  stopListening() {
    this.listener.kill()
  }

  handleKeyPress(e) {
    const key = e.name
    const state = e.state

    if (!this.isValidKey(key)) return

    this.sendKeyStateToOverlay(key, state)
  }

  isValidKey(key) {
    return ['Z', 'X', 'DOT', 'FORWARD SLASH'].includes(key)
  }

  sendKeyStateToOverlay(key, state) {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      // console.log(`Key: ${key}, State: ${state}`)
      this.overlayWindow.webContents.send('keyState', { key, state })
    }
  }
}

module.exports = new KeyboardService()