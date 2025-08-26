const Store = require('electron-store');
const store = new Store();

const DEFAULT_KEYS = {
  '4key': ['LEFT SHIFT', 'RIGHT SHIFT', 'Z', 'X', 'DOT', 'FORWARD SLASH'],
  '5key': ['LEFT SHIFT', 'RIGHT SHIFT', 'Z', 'X', 'C', 'COMMA', 'DOT', 'FORWARD SLASH'],
  '6key': ['LEFT SHIFT', 'RIGHT SHIFT', 'Z', 'X', 'C', 'COMMA', 'DOT', 'FORWARD SLASH'],
  '8key': ['LEFT SHIFT', 'RIGHT SHIFT', 'LEFT CTRL', '25', 'Z', 'X', 'C', 'COMMA', 'DOT', 'FORWARD SLASH'],
};

function loadKeys() {
  try {
    const keys = store.get('keys');
    if (!keys) {
      store.set('keys', DEFAULT_KEYS);
      return DEFAULT_KEYS;
    }
    return keys;
  } catch (error) {
    console.error('Failed to load keys:', error);
    return DEFAULT_KEYS;
  }
}

function saveKeys(keysObject) {
  try {
    store.set('keys', keysObject);
    return true;
  } catch (error) {
    console.error('Failed to save keys:', error);
    return false;
  }
}

function resetKeys() {
  try {
    store.set('keys', DEFAULT_KEYS);
    // console.log('Keys reset to default:', DEFAULT_KEYS); // 디버깅용
    return DEFAULT_KEYS;
  } catch (error) {
    console.error('Failed to reset keys:', error);
    return DEFAULT_KEYS;
  }
}

module.exports = {
  loadKeys,
  saveKeys,
  resetKeys
};