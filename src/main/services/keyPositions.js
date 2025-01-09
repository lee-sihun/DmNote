const Store = require('electron-store');
const store = new Store();

const DEFAULT_POSITIONS = {
  "4key": [
    { dx: 280, dy: 130, width: 60 },
    { dx: 360, dy: 130, width: 60 },
    { dx: 440, dy: 130, width: 60 },
    { dx: 520, dy: 130, width: 60 },
    { dx: 140, dy: 130, width: 120 },
    { dx: 600, dy: 130, width: 120 },
  ],
}

function loadKeyPositions() {
  try {
    const positions = store.get('keyPositions');
    if (!positions) {
      store.set('keyPositions', DEFAULT_POSITIONS);
      return DEFAULT_POSITIONS;
    }
    return positions;
  } catch (error) {
    console.error('Failed to load key positions:', error);
    return DEFAULT_POSITIONS;
  }
}

function saveKeyPositions(positions) {
  try {
    store.set('keyPositions', positions);
  } catch (error) {
    console.error('Failed to save key positions:', error);
  }
}

function resetKeyPositions() {
  try {
    store.set('keyPositions', DEFAULT_POSITIONS);
    return DEFAULT_POSITIONS;
  } catch (error) {
    console.error('Failed to reset key positions:', error);
    return DEFAULT_POSITIONS;
  }
}

module.exports = {
  saveKeyPositions,
  loadKeyPositions,
  resetKeyPositions
};