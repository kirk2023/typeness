import { BrowserWindow, screen } from 'electron'
import path from 'path'

let bubbleWindow: BrowserWindow | null = null

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

export function createFloatingBubble(): BrowserWindow | null {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.focus()
    return bubbleWindow
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

  bubbleWindow = new BrowserWindow({
    width: 380,
    height: 80,
    x: screenW - 420,
    y: screenH - 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Allow dragging via -webkit-app-region: drag on the bubble element
  // but keep the center button clickable with -webkit-app-region: no-drag
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  bubbleWindow.setAlwaysOnTop(true, 'floating', 1)

  if (VITE_DEV_SERVER_URL) {
    bubbleWindow.loadURL(`${VITE_DEV_SERVER_URL}/src/bubble-ui/index.html`)
  } else {
    bubbleWindow.loadFile(path.join(__dirname, '../src/bubble-ui/index.html'))
  }

  bubbleWindow.on('closed', () => {
    bubbleWindow = null
  })

  return bubbleWindow
}

export function updateBubbleState(recording: boolean): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:state-changed', recording)
  }
}

export function updateBubblePipelineState(state: string): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:pipeline-state', state)
  }
}

export function updateBubbleStreamingText(text: string): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:streaming-text', text)
  }
}

export function getBubbleWindow(): BrowserWindow | null {
  return bubbleWindow
}
