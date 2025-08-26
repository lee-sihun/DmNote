const Store = require('electron-store');
const store = new Store();

const DEFAULT_POSITIONS = {
  "4key": [
    { dx: 180, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 565, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 305, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 370, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 435, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 500, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
  ],
  "5key": [
    { dx: 115, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 630, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 240, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 305, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 370, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 435, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 500, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 565, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
  ],
  "6key": [
    { dx: 115, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 630, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 240, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 305, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 370, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 435, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 500, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 565, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
  ],
  "8key": [
    { dx: 240, dy: 215, width: 190, height: 40, activeImage: '', inactiveImage: '', count: 0, noteColor: '#ED005C', noteOpacity: 80 },
    { dx: 435, dy: 215, width: 190, height: 40, activeImage: '', inactiveImage: '', count: 0, noteColor: '#ED005C', noteOpacity: 80 },
    { dx: 115, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 630, dy: 150, width: 120, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#24BBB4', noteOpacity: 80 },
    { dx: 240, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 305, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 370, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 435, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 500, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
    { dx: 565, dy: 150, width: 60, height: 60, activeImage: '', inactiveImage: '', count: 0, noteColor: '#FFFFFF', noteOpacity: 80 },
  ]
}

function loadKeyPositions() {
  try {
    const positions = store.get('keyPositions');
    if (!positions) {
      store.set('keyPositions', DEFAULT_POSITIONS);
      return DEFAULT_POSITIONS;
    }

    // 기존 사용자를 위한 호환성 처리 - noteColor와 noteOpacity가 없는 경우 기본값 추가
    const updatedPositions = {};
    let hasUpdates = false;

    Object.keys(positions).forEach(keyMode => {
      updatedPositions[keyMode] = positions[keyMode].map(key => {
        const updatedKey = { ...key };

        // noteColor가 없으면 기본값 추가
        if (!updatedKey.hasOwnProperty('noteColor')) {
          updatedKey.noteColor = '#FFFFFF';
          hasUpdates = true;
        }

        // noteOpacity가 없으면 기본값 추가
        if (!updatedKey.hasOwnProperty('noteOpacity')) {
          updatedKey.noteOpacity = 80;
          hasUpdates = true;
        }

        // classNameActive / classNameInactive 호환성 처리
        if (!updatedKey.hasOwnProperty('classNameActive')) {
          updatedKey.classNameActive = '';
          hasUpdates = true;
        }

        if (!updatedKey.hasOwnProperty('classNameInactive')) {
          updatedKey.classNameInactive = '';
          hasUpdates = true;
        }

        return updatedKey;
      });
    });

    // 업데이트가 있었다면 저장
    if (hasUpdates) {
      store.set('keyPositions', updatedPositions);
    }

    return updatedPositions;
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