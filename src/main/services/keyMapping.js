let store; 
const DEFAULT_KEYS = ['Z', 'X', 'DOT', 'FORWARD SLASH'];

(async () => {
  const { default: Store } = await import('electron-store');
  store = new Store();
})();

function loadKeys() {
  if (!store) return DEFAULT_KEYS;
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
  if (!store) return;
  try {
    store.set('keys', keysArray);
  } catch (error) {
    console.error('Failed to save keys:', error);
  }
}

module.exports = {
  loadKeys,
  saveKeys,
  DEFAULT_KEYS
};