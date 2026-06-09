import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, NativeImage, dialog, shell, Notification } from 'electron'
import path from 'path'
import fs from 'fs'
import http from 'http'
import { getSettings, getSetting, setSetting } from './settings'
import { IPC, PipelineState } from '../shared/types'
import { PipelineController } from './pipeline/controller'
import { openSettingsWindow } from './settings-window'
import { createFloatingBubble, updateBubbleState, updateBubblePipelineState, updateBubbleStreamingText } from './floating-bubble'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isRecording = false
let isToggling = false  // Prevent double-click during toggle
const pipeline = new PipelineController()

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// ============ File Logging ============
const logDir = path.join(app.getPath('userData'), 'logs')
const logFile = path.join(logDir, `typeness-${new Date().toISOString().slice(0, 10)}.log`)
let fileLogStream: fs.WriteStream | null = null
try {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  fileLogStream = fs.createWriteStream(logFile, { flags: 'a' })
  const _origLog = console.log
  const _origWarn = console.warn
  const _origError = console.error
  console.log = function patchedLog(...args: any[]) {
    _origLog.apply(console, args)
    _writeFileLog('INFO', args)
  }
  console.warn = function patchedWarn(...args: any[]) {
    _origWarn.apply(console, args)
    _writeFileLog('WARN', args)
  }
  console.error = function patchedError(...args: any[]) {
    _origError.apply(console, args)
    _writeFileLog('ERROR', args)
  }
  function _writeFileLog(level: string, args: any[]) {
    if (!fileLogStream) return
    const ts = new Date().toISOString()
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    fileLogStream.write(`[${ts}] [${level}] ${msg}\n`)
  }
  console.log(`[Log] 日志文件: ${logFile}`)
} catch (e) {
  fileLogStream = null
}

// ============ Single Instance Lock ============
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our window instead
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

// ============ VAD Asset HTTP Server ============
// Serves ONNX model, worklet, and WASM files via local HTTP so that
// onnxruntime-web's import() calls work correctly.
let vadAssetBaseUrl = ''

function startVadAssetServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    let baseDir: string
    if (VITE_DEV_SERVER_URL) {
      // In dev, we serve from two dirs depending on file type
      baseDir = '' // handled per-request
    } else {
      baseDir = path.join(process.resourcesPath || path.dirname(process.execPath), 'resources', 'vad')
    }

    const server = http.createServer((req, res) => {
      const filename = decodeURIComponent(req.url?.replace(/^\//, '') || '')
      let filePath: string

      if (VITE_DEV_SERVER_URL) {
        if (filename.startsWith('ort-')) {
          filePath = path.join(__dirname, '../../node_modules/onnxruntime-web/dist', filename)
        } else {
          filePath = path.join(__dirname, '../../node_modules/@ricky0123/vad-web/dist', filename)
        }
      } else {
        filePath = path.join(baseDir, filename)
      }

      // CORS headers for cross-origin access from file:// context
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET')

      const ext = path.extname(filename).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.onnx': 'application/octet-stream',
        '.wasm': 'application/wasm',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
      }
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')

      fs.readFile(filePath, (err, data) => {
        if (err) {
          console.error(`[VAD Server] 404: ${filename} → ${filePath}`)
          res.writeHead(404)
          res.end('Not found')
        } else {
          console.log(`[VAD Server] 200: ${filename}`)
          res.writeHead(200)
          res.end(data)
        }
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr !== 'string') {
        const url = `http://127.0.0.1:${addr.port}/`
        console.log(`[VAD Server] Listening at ${url}`)
        resolve(url)
      } else {
        reject(new Error('Failed to start VAD asset server'))
      }
    })

    server.on('error', reject)
  })
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, '../renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Allow file:// renderer to import() from local http:// VAD server
      webSecurity: false,
    },
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  }

  return win
}

function createTray(): Tray {
  const trayIcon = createTrayIcon(PipelineState.IDLE)
  const t = new Tray(trayIcon)

  updateTrayMenu(t, false)

  t.setToolTip('Typeness - 语音输入法')

  t.on('click', () => {
    toggleRecording()
  })

  return t
}

function updateTrayMenu(t: Tray, recording: boolean): void {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: recording ? '停止录音' : '开始录音',
      click: () => toggleRecording(),
    },
    { type: 'separator' },
    {
      label: '设置...',
      click: () => {
        openSettingsWindow()
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => app.quit(),
    },
  ])
  t.setContextMenu(contextMenu)
}

function createTrayIcon(state: PipelineState): NativeImage {
  const size = 16
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8" cy="8" r="7" fill="${getIconColor(state)}" stroke="#555" stroke-width="1"/>
  </svg>`
  return nativeImage.createFromBuffer(Buffer.from(svg))
}

function getIconColor(state: PipelineState): string {
  switch (state) {
    case PipelineState.IDLE:
      return '#888'
    case PipelineState.LISTENING:
      return '#4CAF50'
    case PipelineState.STT_PROCESSING:
    case PipelineState.LLM_PROCESSING:
      return '#2196F3'
    case PipelineState.TYPING:
      return '#FF9800'
    default:
      return '#888'
  }
}

function updateTrayIcon(state: PipelineState): void {
  if (tray) {
    tray.setImage(createTrayIcon(state))
    const stateLabels: Record<PipelineState, string> = {
      [PipelineState.IDLE]: '空闲',
      [PipelineState.LISTENING]: '监听中...',
      [PipelineState.STT_PROCESSING]: '语音识别中...',
      [PipelineState.LLM_PROCESSING]: '文本处理中...',
      [PipelineState.TYPING]: '输入中...',
    }
    tray.setToolTip(`Typeness - ${stateLabels[state]}`)
  }
}

async function toggleRecording(): Promise<void> {
  if (isToggling) {
    console.log('[Typeness] 正在切换中，忽略重复点击')
    return
  }
  isToggling = true

  try {
    isRecording = !isRecording

    if (isRecording) {
      try {
        await pipeline.startListening()
        mainWindow?.webContents.send(IPC.PIPELINE_TOGGLE, true)
        console.log('[Typeness] 开始录音')
      } catch (err) {
        isRecording = false
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[Typeness] 启动录音失败:', msg)
        mainWindow?.webContents.send(IPC.PIPELINE_ERROR, {
          stage: 'init',
          message: msg,
        })
        // Show system notification so user can see the error
        new Notification({
          title: 'Typeness - 启动失败',
          body: msg,
          silent: false,
        }).show()
        return
      }
    } else {
      pipeline.stopListening()
      mainWindow?.webContents.send(IPC.PIPELINE_TOGGLE, false)
      console.log('[Typeness] 停止录音')
    }

    if (tray) {
      updateTrayMenu(tray, isRecording)
    }
    // Sync bubble state
    updateBubbleState(isRecording)
  } finally {
    isToggling = false
  }
}

function registerGlobalShortcut(): void {
  // Unregister all existing shortcuts first
  globalShortcut.unregisterAll()

  const settings = getSettings()
  const hotkey = settings.hotkey.toggleRecording

  if (!hotkey) {
    console.warn('[Typeness] 快捷键未配置')
    return
  }

  try {
    const success = globalShortcut.register(hotkey, () => {
      toggleRecording()
    })
    if (success) {
      console.log(`[Typeness] 全局快捷键已注册: ${hotkey}`)
    } else {
      console.error(`[Typeness] 全局快捷键注册失败 (返回false): ${hotkey}`)
      new Notification({
        title: 'Typeness - 快捷键注册失败',
        body: `快捷键 ${hotkey} 可能被其他程序占用`,
        silent: false,
      }).show()
    }
  } catch (err) {
    console.error(`[Typeness] 全局快捷键注册异常: ${hotkey}`, err)
  }
}

function registerIpcHandlers(): void {
  // VAD asset server URL
  ipcMain.handle('vad:get-asset-url', () => vadAssetBaseUrl)

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET_ALL, () => getSettings())
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    return getSetting(key as keyof ReturnType<typeof getSettings>)
  })
  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: unknown) => {
    setSetting(key as keyof ReturnType<typeof getSettings>, value as never)
    // Re-register global shortcut when hotkey changes
    if (key === 'hotkey') {
      registerGlobalShortcut()
    }
  })

  // Pipeline events from renderer (VAD)
  ipcMain.on(IPC.PIPELINE_SPEECH_START, () => {
    console.log('[Typeness] 检测到语音开始')
    pipeline.handleSpeechStart()
  })

  ipcMain.on(IPC.PIPELINE_AUDIO_CHUNK, (_event, data: ArrayBuffer) => {
    if (data && isRecording) {
      const buffer = Buffer.from(data)
      pipeline.handleAudioChunk(buffer)
    }
  })

  ipcMain.on(IPC.PIPELINE_SPEECH_END, (_event, data: ArrayBuffer) => {
    console.log('[Typeness] 语音段结束, 数据大小:', data?.byteLength)
    if (data && isRecording) {
      const buffer = Buffer.from(data)
      pipeline.handleSpeechEnd(buffer)
    } else if (isRecording) {
      pipeline.handleSpeechEnd()
    }
  })

  // Web Speech API: pre-recognized text from renderer (bypass STT, go straight to LLM)
  ipcMain.on(IPC.PIPELINE_WEB_SPEECH_TEXT, (_event, text: string) => {
    console.log('[Typeness] Web Speech 识别文本:', text)
    if (text && isRecording) {
      pipeline.handleRecognizedText(text)
    }
  })

  // Renderer error reporting (for errors that happen in the renderer process)
  ipcMain.on('renderer:error', (_event, payload: { title: string; message: string }) => {
    console.error(`[Typeness] 渲染进程错误 - ${payload.title}:`, payload.message)
    new Notification({
      title: `Typeness - ${payload.title}`,
      body: payload.message.slice(0, 200),
      silent: false,
    }).show()
  })

  // Audio devices
  ipcMain.handle(IPC.AUDIO_GET_DEVICES, async () => {
    const devices = await mainWindow?.webContents.executeJavaScript(
      `navigator.mediaDevices.enumerateDevices().then(d => d.filter(x => x.kind === 'audioinput').map(x => ({ deviceId: x.deviceId, label: x.label })))`
    )
    return devices || []
  })

  // Floating bubble toggle (from bubble window)
  ipcMain.on('bubble:toggle-recording', () => {
    toggleRecording()
  })

  // Dialog: open directory
  ipcMain.handle(IPC.DIALOG_OPEN_DIRECTORY, async (_event, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory'],
      title: '选择文件夹',
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  // Create desktop shortcut
  ipcMain.handle(IPC.SHORTCUT_CREATE_DESKTOP, () => {
    try {
      const desktopPath = app.getPath('desktop')
      const isDev = !!VITE_DEV_SERVER_URL
      if (isDev) {
        return { success: false, error: '开发模式下无法创建快捷方式，请打包后使用' }
      }
      // For portable EXE, use the portable file path; otherwise use process.execPath
      const targetExe = process.env.PORTABLE_EXECUTABLE_FILE_PATH || process.execPath
      const shortcutPath = path.join(desktopPath, 'Typeness.lnk')

      // Resolve icon path from app resources
      const iconPath = path.join(process.resourcesPath || path.dirname(targetExe), 'resources', 'icon.ico')

      const success = shell.writeShortcutLink(shortcutPath, {
        target: targetExe,
        args: '',
        cwd: path.dirname(targetExe),
        icon: fs.existsSync(iconPath) ? iconPath : targetExe,
        iconIndex: 0,
        description: 'Typeness 语音输入法',
      })
      if (success) {
        return { success: true }
      } else {
        return { success: false, error: '创建快捷方式失败' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Test offline Vosk model
  ipcMain.handle(IPC.STT_TEST_OFFLINE, (_event, modelPath: string) => {
    try {
      if (!modelPath) {
        return { success: false, error: '请先选择模型文件夹路径' }
      }
      if (!fs.existsSync(modelPath)) {
        return { success: false, error: `路径不存在: ${modelPath}` }
      }
      const stat = fs.statSync(modelPath)
      if (!stat.isDirectory()) {
        return { success: false, error: '所选路径不是文件夹' }
      }
      // Check for required Sherpa-ONNX model files
      const missing: string[] = []
      if (!fs.existsSync(path.join(modelPath, 'tokens.txt'))) {
        missing.push('tokens.txt')
      }
      // Check if any .onnx model file exists (supports both offline and streaming models)
      try {
        const files = fs.readdirSync(modelPath)
        const onnxFiles = files.filter(f => f.endsWith('.onnx'))
        if (onnxFiles.length === 0) {
          missing.push('*.onnx (模型文件)')
        }
      } catch {
        missing.push('*.onnx (无法读取目录)')
      }
      if (missing.length > 0) {
        return {
          success: false,
          error: `模型文件夹缺少必要文件: ${missing.join(', ')}。请确认选择了正确的 Sherpa-ONNX 模型文件夹`,
        }
      }
      // Detect model type and show info
      let modelInfo = 'Sherpa-ONNX 模型验证通过'
      const readmePath = path.join(modelPath, 'README.md')
      if (fs.existsSync(readmePath)) {
        const firstLine = fs.readFileSync(readmePath, 'utf-8').split('\n').find(l => l.trim()) || ''
        modelInfo = firstLine.replace(/^#+\s*/, '').slice(0, 80) || modelInfo
      }
      // Check model type for display
      const allFiles = fs.readdirSync(modelPath)
      const hasEncoder = allFiles.some(f => f.includes('encoder') && f.endsWith('.onnx'))
      const hasSenseVoice = allFiles.some(f => f === 'model.int8.onnx' || f === 'model.onnx')
      if (hasEncoder) {
        modelInfo = `流式模型 (transducer) - ${modelInfo}`
      } else if (hasSenseVoice) {
        modelInfo = `离线模型 (SenseVoice) - ${modelInfo}`
      }
      return {
        success: true,
        info: modelInfo ? `模型验证通过: ${modelInfo}` : '模型文件夹验证通过',
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

function setupPipelineEvents(): void {
  // Update tray icon when pipeline state changes
  pipeline.on('state-changed', (state: PipelineState) => {
    updateTrayIcon(state)
    // Also notify renderer for UI updates
    mainWindow?.webContents.send(IPC.PIPELINE_STATE_CHANGED, state)
    // Forward to floating bubble
    updateBubblePipelineState(state)
  })

  // Forward partial results (streaming) to renderer and bubble
  pipeline.on('partial-result', (text: string) => {
    mainWindow?.webContents.send(IPC.PIPELINE_PARTIAL_RESULT, text)
    // Also show in bubble tooltip
    updateBubbleStreamingText(text)
  })

  // Forward results to renderer and bubble
  pipeline.on('result', (result: { raw: string; cleaned: string }) => {
    console.log(`[Typeness] 结果 → 原始: "${result.raw}" | 整理: "${result.cleaned}"`)
    mainWindow?.webContents.send(IPC.PIPELINE_RESULT, result)
    // Show final result in bubble tooltip (no popup notification)
    updateBubbleStreamingText(result.cleaned)
  })

  // Forward errors to renderer (no popup for minor errors)
  pipeline.on('error', (error: { stage: string; message: string }) => {
    console.error(`[Typeness] 错误 [${error.stage}]:`, error.message)
    mainWindow?.webContents.send(IPC.PIPELINE_ERROR, error)
  })
}

// App lifecycle
app.whenReady().then(async () => {
  // Start VAD asset HTTP server (supports import() unlike custom protocols)
  try {
    vadAssetBaseUrl = await startVadAssetServer()
  } catch (err) {
    console.error('[Typeness] VAD 资源服务器启动失败:', err)
  }

  registerIpcHandlers()
  setupPipelineEvents()
  mainWindow = createMainWindow()
  tray = createTray()
  registerGlobalShortcut()

  // Create floating bubble if enabled in settings
  const generalSettings = getSetting('general')
  if (generalSettings.showFloatingBubble) {
    createFloatingBubble()
  }

  console.log('[Typeness] 应用已启动')
  console.log(`[Typeness] 按 ${getSettings().hotkey.toggleRecording} 开始/停止录音`)
  console.log('[Typeness] 也可点击悬浮气泡或托盘图标切换录音状态')
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  pipeline.dispose()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep app running in tray
  }
})
