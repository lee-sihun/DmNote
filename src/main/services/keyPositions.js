const Store = require('electron-store');
const store = new Store();

const DEFAULT_POSITIONS = {
  "4key": [
    { dx: 290, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 360, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 430, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 500, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 160, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 570, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
  ],
  "5key": [
    { dx: 230, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 300, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 370, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 440, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 510, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 580, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 100, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 650, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 }
  ],
  "6key": [
    { dx: 230, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 300, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 370, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 440, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 510, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 580, dy: 130, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 100, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 650, dy: 130, width: 120, activeImage: '', inactiveImage: '', count: 0 }
  ],
  "8key": [
    { dx: 230, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 300, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 370, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 440, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 510, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 580, dy: 90, width: 60, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 100, dy: 90, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 650, dy: 90, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 270, dy: 160, width: 120, activeImage: '', inactiveImage: '', count: 0 },
    { dx: 480, dy: 160, width: 120, activeImage: '', inactiveImage: '', count: 0 }
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