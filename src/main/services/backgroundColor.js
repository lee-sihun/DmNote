const Store = require('electron-store');
const store = new Store();

const BACKGROUND_COLOR_KEY = 'backgroundColor';
const DEFAULT_COLOR = 'transparent';

function saveBackgroundColor(color) {
  store.set(BACKGROUND_COLOR_KEY, color);
  return color;
}

function loadBackgroundColor() {
  return store.get(BACKGROUND_COLOR_KEY, DEFAULT_COLOR);
}

function resetBackgroundColor() {
  store.set(BACKGROUND_COLOR_KEY, DEFAULT_COLOR);
  return DEFAULT_COLOR;
}

module.exports = {
  saveBackgroundColor,
  loadBackgroundColor,
  resetBackgroundColor
};