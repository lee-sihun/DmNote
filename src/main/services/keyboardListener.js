const { GlobalKeyboardListener } = require('node-global-key-listener')
const { loadKeys, saveKeys } = require('./keyMappings')

// name: e.name,           // 키 이름
// state: e.state,         // 상태 (UP/DOWN)
// rawKey: e.rawKey,       // raw 키코드
// vKey: e.vKey,          // 가상 키코드
// scanCode: e.scanCode,   // 스캔 코드
// modifiers: e.modifiers  // 수정자 키

// 넘패드 키 매핑 테이블 (같은 물리적 키)
const NUMPAD_KEY_GROUPS = {
  'NUMPAD 0': ['NUMPAD 0', 'INS'],
  'NUMPAD 1': ['NUMPAD 1', 'END'],
  'NUMPAD 2': ['NUMPAD 2', 'DOWN ARROW'],
  'NUMPAD 3': ['NUMPAD 3', 'PAGE DOWN'],
  'NUMPAD 4': ['NUMPAD 4', 'LEFT ARROW'],
  'NUMPAD 5': ['NUMPAD 5', 'NUMPAD CLEAR'],
  'NUMPAD 6': ['NUMPAD 6', 'RIGHT ARROW'],
  'NUMPAD 7': ['NUMPAD 7', 'HOME'],
  'NUMPAD 8': ['NUMPAD 8', 'UP ARROW'],
  'NUMPAD 9': ['NUMPAD 9', 'PAGE UP'],
};

// 키 -> 대표키 매핑 테이블 
const KEY_TO_REPRESENTATIVE = {};
Object.entries(NUMPAD_KEY_GROUPS).forEach(([representative, keys]) => {
  keys.forEach(key => {
    KEY_TO_REPRESENTATIVE[key] = representative;
  });
});

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

    // 넘패드 키 통합 처리
    const representativeKey = KEY_TO_REPRESENTATIVE[key];
    if (representativeKey) {
      key = representativeKey;
    }

    // 배열 순차 탐색에서 해시 테이블 기반 조회로 개선 
    if (!this.validKeySet.has(key)) {
      return;
    }

    this.sendKeyStateToOverlay(key, state);
  }

  updateValidKeySet() {
    const currentKeys = this.keys[this.currentMode] || [];
    this.validKeySet = new Set();

    currentKeys.forEach(key => {
      // 설정된 키 추가
      this.validKeySet.add(key);

      // 넘패드 키 그룹 추가
      const keyGroup = NUMPAD_KEY_GROUPS[key];
      if (keyGroup) {
        keyGroup.forEach(variantKey => {
          this.validKeySet.add(variantKey);
        });
      }
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
        mode: this.currentMode
      });
    }
  }
}

module.exports = new KeyboardService();