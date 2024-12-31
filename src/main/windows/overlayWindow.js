const { BrowserWindow, screen } = require('electron/main')
const path = require('node:path')
const windowConfig = require('../config/windowConfig')

class OverlayWindow {
  constructor() {
    this.window = null
  }

  create() {
    this.window = new BrowserWindow(windowConfig.overlay)
    this.setPosition()
    this.loadContent()
    
    return this.window
  }

  setPosition() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    this.window.setPosition(width - 400, height - 100)
  }

  loadContent() {
    const isDev = process.env.NODE_ENV === 'development'
    if (isDev) {
      this.window.loadURL('http://localhost:3000/overlay.html')
    } else {
      this.window.loadFile(path.join(__dirname, '..', '..', '..', 'dist', 'renderer', 'overlay.html'))
    }
  }
}

module.exports = OverlayWindow