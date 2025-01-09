const Store = require('electron-store');
const store = new Store();

const DEFAULT_KEYS = ['Z', 'X', 'DOT', 'FORWARD SLASH', 'LEFT SHIFT', 'RIGHT SHIFT'];

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

function saveKeys(keysArray) {
  try {
    store.set('keys', keysArray);
    // console.log('Keys saved:', keysArray); // 디버깅용
  } catch (error) {
    console.error('Failed to save keys:', error);
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