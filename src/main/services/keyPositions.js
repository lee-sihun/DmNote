const Store = require('electron-store');
const store = new Store();

const DEFAULT_POSITIONS = {
  "4key": [
    { dx: 280, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 360, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 440, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 520, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 140, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 600, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
  ],
  "5key": [
    { dx: 240, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 320, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 400, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 480, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 560, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 100, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 640, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 }
  ],
"6key": [
    { dx: 200, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 280, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 360, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 440, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 520, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 600, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 60, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 680, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 }
  ],
  "8key": [
    { dx: 200, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 280, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 360, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 440, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 520, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 600, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 60, dy: 90, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 680, dy: 90, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 250, dy: 170, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 490, dy: 170, width: 120, activeImage: '', inactiveImage: '', count: 0 }
  ]
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