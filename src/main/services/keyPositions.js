const Store = require('electron-store');
const store = new Store();

const DEFAULT_POSITIONS = {
  "4key": [
    { dx: 280, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 360, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 440, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 520, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 140, dy: 130, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 600, dy: 130, width: 120, activeImage: '', inactiveImage: '' },
  ],
  "5key": [
    { dx: 240, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 320, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 400, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 480, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 560, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 100, dy: 130, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 640, dy: 130, width: 120, activeImage: '', inactiveImage: '' }
  ],
"6key": [
    { dx: 200, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 280, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 360, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 440, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 520, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 600, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 60, dy: 130, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 680, dy: 130, width: 120, activeImage: '', inactiveImage: '' }
  ],
  "8key": [
    { dx: 200, dy: 90, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 280, dy: 90, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 360, dy: 90, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 440, dy: 90, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 520, dy: 90, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 600, dy: 90, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 60, dy: 90, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 680, dy: 90, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 250, dy: 170, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 490, dy: 170, width: 120, activeImage: '', inactiveImage: '' }
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