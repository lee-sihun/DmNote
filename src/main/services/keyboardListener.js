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
    this.currentMode = '4key'; // 기본 모드
    this.validKeySet = new Set();
    this.updateValidKeySet();
    this.vKeyCache = new Map();
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

  setKeyMode(mode) {
    if (this.keys[mode]) {
      this.currentMode = mode;
      this.updateValidKeySet();
      return true;
    }
    return false;
  }

  getCurrentMode() {
    return this.currentMode;
  }

  handleKeyPress(e) {
    let key = e.name || e.vKey.toString();
    const state = e.state;

    // 배열 순차 탐색에서 해시 테이블 기반 조회로 개선 
    if (!this.validKeySet.has(key)) {
      return;
    }

    this.sendKeyStateToOverlay(key, state);
  }

  updateValidKeySet() {
    this.validKeySet = new Set(this.keys[this.currentMode] || []);
  }

  updateKeyMapping(keys) {
    this.keys = keys;
    this.updateValidKeySet();
    saveKeys(keys);
  }

  getKeyMappings() {
    return this.keys;
  }

  sendKeyStateToOverlay(key, state) {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send('keyState', {
        key,
        state,
        mode: this.currentMode
      });
    }
  }
}

module.exports = new KeyboardService();