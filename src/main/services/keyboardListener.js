const { GlobalKeyboardListener, KeyboardUtils } = require('node-global-key-listener-extended');
const { loadKeys, saveKeys } = require('./keyMappings');

const NUMPAD_SCAN_CODE_MAPPING = {
  82: 'NUMPAD 0',      // 넘패드 0 위치 (INS/0)
  79: 'NUMPAD 1',      // 넘패드 1 위치 (END/1)
  80: 'NUMPAD 2',      // 넘패드 2 위치 (DOWN/2)
  81: 'NUMPAD 3',      // 넘패드 3 위치 (PGDN/3)
  75: 'NUMPAD 4',      // 넘패드 4 위치 (LEFT/4)
  76: 'NUMPAD 5',      // 넘패드 5 위치 (CLEAR/5)
  77: 'NUMPAD 6',      // 넘패드 6 위치 (RIGHT/6)
  71: 'NUMPAD 7',      // 넘패드 7 위치 (HOME/7)
  72: 'NUMPAD 8',      // 넘패드 8 위치 (UP/8)5
  73: 'NUMPAD 9',      // 넘패드 9 위치 (PGUP/9)

  28: 'NUMPAD RETURN',    // 넘패드 엔터
  83: 'NUMPAD DELETE',  // 넘패드 . (DELETE)
};

class KeyboardService {
  constructor() {
    this.listener = new GlobalKeyboardListener();
    this.overlayWindow = null;
    this.keys = loadKeys();
    this.currentMode = '4key';
    this.validKeySet = new Set();
    this.updateValidKeySet();
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
    // const timestamp = Date.now();
    let key = e.name || e.vKey.toString();
    const state = e.state;
    const location = KeyboardUtils.getKeyLocation(e);
    const scanCode = e.scanCode;

    // console.log(`Key Pressed: ${key}, Location: ${location}, Scan Code: ${scanCode}, vKey: ${e.vKey}`);
    // 넘패드 구분
    if (location === 'numpad' && NUMPAD_SCAN_CODE_MAPPING[scanCode]) {
      key = NUMPAD_SCAN_CODE_MAPPING[scanCode];
    }

    // 유효 키 체크
    if (!this.validKeySet.has(key)) {
      return;
    }

    this.sendKeyStateToOverlay(key, state);
  }

  updateValidKeySet() {
    const currentKeys = this.keys[this.currentMode] || [];
    this.validKeySet = new Set();

    currentKeys.forEach(key => {
      this.validKeySet.add(key);
    });
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
        mode: this.currentMode,
        // timestamp,
      });
    }
  }
}

module.exports = new KeyboardService();