const Store = require('electron-store');
const store = new Store();

const DEFAULT_KEYS = ['Z', 'X', 'DOT', 'FORWARD SLASH'];

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
    console.log('Keys saved:', keysArray); // 디버깅용
  } catch (error) {
    console.error('Failed to save keys:', error);
  }
}

module.exports = {
  loadKeys,
  saveKeys,
  DEFAULT_KEYS
};