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
    { dx: 260, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 330, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 400, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 470, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 540, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 140, dy: 130, width: 110, activeImage: '', inactiveImage: '' },
    { dx: 610, dy: 130, width: 110, activeImage: '', inactiveImage: '' }
  ],
"6key": [
    { dx: 240, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 310, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 380, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 450, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 520, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 590, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 140, dy: 130, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 660, dy: 130, width: 120, activeImage: '', inactiveImage: '' }
  ],
  "8key": [
    { dx: 200, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 270, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 340, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 410, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 480, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 550, dy: 130, width: 60, activeImage: '', inactiveImage: '' },
    { dx: 120, dy: 210, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 620, dy: 210, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 120, dy: 130, width: 120, activeImage: '', inactiveImage: '' },
    { dx: 620, dy: 130, width: 120, activeImage: '', inactiveImage: '' }
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