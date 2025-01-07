const { GlobalKeyboardListener } = require('node-global-key-listener')
const { loadKeys, saveKeys } = require('./keyMappings')

// name: e.name,           // 키 이름
// state: e.state,         // 상태 (UP/DOWN)
// rawKey: e.rawKey,       // raw 키코드
// vKey: e.vKey,          // 가상 키코드
// scanCode: e.scanCode,   // 스캔 코드
// modifiers: e.modifiers  // 수정자 키

class KeyboardService {
  constructor() {
    this.listener = new GlobalKeyboardListener();
    this.overlayWindow = null;
    this.keys = loadKeys();
  }

  setOverlayWindow(window) {
    this.overlayWindow = window;
  }

  startListening() {
    this.listener.addListener(this.handleKeyPress.bind(this));
  }

  stopListening() {
    this.listener.kill();
  }

  handleKeyPress(e) {
    let key = e.name || e.vKey.toString();
    const state = e.state;
    // console.log('Received key press:', key); // 디버깅용

    // console.log('[DEBUG] Key press:', {
    //   name: e.name, 
    //   vKey: e.vKey, 
    //   scanCode: e.scanCode,
    //   rawKey: e.rawKey, 
    // });

    if (!this.isValidKey(key)) {
      // console.log('Invalid key:', key); // 디버깅용
      return;
    }

    this.sendKeyStateToOverlay(key, state);
  }

  isValidKey(key) {
    return this.keys.includes(key);
  }

  updateKeyMapping(keys) {
    // console.log('Updating key mappings:', keys); // 디버깅용
    this.keys = keys;
    saveKeys(keys);
  }

  getKeyMappings() {
    return this.keys;
  }

  sendKeyStateToOverlay(key, state) {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      // console.log(`Key: ${key}, State: ${state}`)
      this.overlayWindow.webContents.send('keyState', { key, state });
    }
  }
}

module.exports = new KeyboardService();