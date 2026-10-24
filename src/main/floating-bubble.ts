import { BrowserWindow, ipcMain, screen } from 'electron'
import path from 'path'

let bubbleWindow: BrowserWindow | null = null
let bubbleResizeHooked = false
let bubbleAnchorBottom = 0  // 窗口底边位置（内容增高时保持底边不动、向上生长）

const BUBBLE_WIDTH = 520
const BUBBLE_MIN_HEIGHT = 80

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

export function createFloatingBubble(): BrowserWindow | null {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.focus()
    return bubbleWindow
  }

  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize

  const x = screenW - BUBBLE_WIDTH - 16
  const y = screenH - BUBBLE_MIN_HEIGHT - 16

  bubbleWindow = new BrowserWindow({
    width: BUBBLE_WIDTH,
    height: BUBBLE_MIN_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
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

  bubbleAnchorBottom = y + BUBBLE_MIN_HEIGHT

  // Remove any title that Windows might render
  bubbleWindow.setTitle('')

  // Allow dragging via -webkit-app-region: drag on the bubble element
  // but keep the center button clickable with -webkit-app-region: no-drag
  bubbleWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  bubbleWindow.setAlwaysOnTop(true, 'floating', 1)

  if (VITE_DEV_SERVER_URL) {
    bubbleWindow.loadURL(`${VITE_DEV_SERVER_URL}/src/bubble-ui/index.html`)
  } else {
    bubbleWindow.loadFile(path.join(__dirname, '../src/bubble-ui/index.html'))
  }

  // Clear title again after load (page <title> might set it)
  bubbleWindow.webContents.on('did-finish-load', () => {
    bubbleWindow?.setTitle('')
  })

  // 用户拖动气泡后，更新底边锚点
  bubbleWindow.on('moved', () => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return
    const bounds = bubbleWindow.getBounds()
    bubbleAnchorBottom = bounds.y + bounds.height
  })

  bubbleWindow.on('closed', () => {
    bubbleWindow = null
  })

  hookBubbleResize()

  return bubbleWindow
}

/**
 * 气泡渲染进程按内容高度请求调整窗口：底边保持不动，向上生长
 */
function hookBubbleResize(): void {
  if (bubbleResizeHooked) return
  bubbleResizeHooked = true

  ipcMain.on('bubble:resize', (_event, height: number) => {
    if (!bubbleWindow || bubbleWindow.isDestroyed()) return

    const workArea = screen.getPrimaryDisplay().workAreaSize
    const maxH = Math.floor(workArea.height * 0.6)
    const newHeight = Math.max(BUBBLE_MIN_HEIGHT, Math.min(Math.ceil(height), maxH))
    const current = bubbleWindow.getBounds()
    if (Math.abs(current.height - newHeight) < 8) return

    const newY = Math.max(0, bubbleAnchorBottom - newHeight)
    bubbleWindow.setBounds({ x: current.x, y: newY, width: BUBBLE_WIDTH, height: newHeight })
  })
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

/** 实时 partial：会话中=当前段字幕；结束后=LLM 流式整理结果 */
export function updateBubblePartialText(text: string): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:partial-text', text)
  }
}

/** 一段话定稿，追加为字幕面板中的一行 */
export function updateBubbleSegmentFinal(text: string): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:segment-final', text)
  }
}

/** 会话最终结果（已粘贴输出） */
export function updateBubbleFinalResult(result: { raw: string; cleaned: string }): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:final-result', result)
  }
}

/** 会话结束但无有效内容 */
export function updateBubbleSessionEnd(): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:session-end')
  }
}

/** 状态提示（如 AI 整理降级为本地清理的警示） */
export function updateBubbleNotice(message: string): void {
  if (bubbleWindow && !bubbleWindow.isDestroyed()) {
    bubbleWindow.webContents.send('bubble:notice', message)
  }
}

export function getBubbleWindow(): BrowserWindow | null {
  return bubbleWindow
}
