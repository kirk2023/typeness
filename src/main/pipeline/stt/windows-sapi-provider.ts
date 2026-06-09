import { spawn, ChildProcess } from 'child_process'
import { app } from 'electron'
import * as path from 'path'
import { StringDecoder } from 'string_decoder'

/**
 * Windows SAPI Speech Recognition Provider
 * Uses PowerShell + System.Speech.Recognition for offline Chinese speech recognition.
 * Communicates with the PowerShell script via JSON lines over stdin/stdout.
 */
export class WindowsSAPIProvider {
  name = 'windows-sapi'
  private psProcess: ChildProcess | null = null
  private isReady = false
  private isRecognizing = false
  private initFailed = false
  private partialCallback: ((text: string) => void) | null = null
  private finalCallback: ((text: string) => void) | null = null
  private stderrBuf = ''
  private stdoutDecoder = new StringDecoder('utf-8')
  private lineBuffer = ''  // Buffer for incomplete lines

  /**
   * Pre-warm: start PowerShell process early so it's ready when needed.
   * Non-blocking, silently fails if the process can't start.
   */
  prewarm(): void {
    if (this.psProcess || this.isReady || this.initFailed) return
    console.log('[SAPI] 预热 PowerShell 进程...')
    try {
      this.spawnProcess()
    } catch (err) {
      console.warn('[SAPI] 预热失败:', err)
      this.initFailed = true
    }
  }

  async initialize(): Promise<void> {
    // If already pre-warmed and ready, return immediately
    if (this.isReady) return
    // If already failed, reject
    if (this.initFailed) throw new Error('SAPI 引擎初始化失败')

    const scriptPath = this.getScriptPath()
    console.log(`[SAPI] 初始化, 脚本: ${scriptPath}`)

    // Start process if not already spawned (prewarm didn't happen)
    if (!this.psProcess) {
      this.spawnProcess()
    }

    // Wait for ready signal with timeout
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.initFailed = true
        reject(new Error('SAPI 引擎启动超时'))
      }, 10000)

      const checkReady = setInterval(() => {
        if (this.isReady) {
          clearInterval(checkReady)
          clearTimeout(timeout)
          console.log('[SAPI] 引擎就绪 ✅')
          resolve()
        }
        if (this.initFailed || !this.psProcess) {
          clearInterval(checkReady)
          clearTimeout(timeout)
          this.initFailed = true
          reject(new Error('SAPI 进程意外退出'))
        }
      }, 200)
    })
  }

  private spawnProcess(): void {
    const scriptPath = this.getScriptPath()
    this.psProcess = spawn('powershell.exe', [
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.psProcess.stdout!.on('data', (data: Buffer) => {
      // Use StringDecoder to handle multi-byte UTF-8 split across chunks
      this.lineBuffer += this.stdoutDecoder.write(data)
      // Process all complete lines (delimited by \n)
      const lines = this.lineBuffer.split('\n')
      // Last element may be incomplete - keep it in buffer
      this.lineBuffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) this.handleJsonLine(line)
      }
    })

    this.psProcess.stderr!.on('data', (data: Buffer) => {
      this.stderrBuf += data.toString('utf-8')
      console.warn('[SAPI stderr]', data.toString('utf-8').trim())
    })

    this.psProcess.on('exit', (code, signal) => {
      console.log(`[SAPI] PowerShell 进程退出, code=${code}, signal=${signal}`)
      this.psProcess = null
      this.isReady = false
      this.isRecognizing = false
    })

    this.psProcess.on('error', (err) => {
      console.error('[SAPI] PowerShell 进程错误:', err)
      this.initFailed = true
    })
  }

  /**
   * Start continuous recognition
   */
  startRecognition(
    onPartial: (text: string) => void,
    onFinal: (text: string) => void
  ): void {
    if (!this.psProcess || !this.isReady) {
      console.warn('[SAPI] 引擎未就绪，无法开始识别')
      return
    }
    if (this.isRecognizing) {
      console.warn('[SAPI] 已在识别中')
      return
    }

    this.partialCallback = onPartial
    this.finalCallback = onFinal
    this.sendCommand({ cmd: 'start' })
    this.isRecognizing = true
    console.log('[SAPI] 开始识别')
  }

  /**
   * Stop recognition
   */
  stopRecognition(): void {
    if (!this.psProcess || !this.isRecognizing) return
    this.sendCommand({ cmd: 'stop' })
    this.isRecognizing = false
    this.partialCallback = null
    this.finalCallback = null
    console.log('[SAPI] 停止识别')
  }

  async dispose(): Promise<void> {
    this.stopRecognition()
    if (this.psProcess) {
      this.psProcess.kill()
      this.psProcess = null
    }
    this.isReady = false
    console.log('[SAPI] 已释放')
  }

  // --- Private methods ---

  private sendCommand(obj: Record<string, unknown>): void {
    if (this.psProcess?.stdin?.writable) {
      const json = JSON.stringify(obj) + '\n'
      this.psProcess.stdin.write(json)
    }
  }

  private handleJsonLine(line: string): void {
    try {
      const msg = JSON.parse(line)
      switch (msg.type) {
        case 'ready':
          this.isReady = true
          break
        case 'started':
          console.log('[SAPI] 识别已启动')
          break
        case 'stopped':
          console.log('[SAPI] 识别已停止')
          break
        case 'partial':
          if (this.partialCallback) {
            this.partialCallback(msg.text)
          }
          break
        case 'final':
          if (this.finalCallback) {
            this.finalCallback(msg.text)
          }
          break
        case 'error':
          console.error('[SAPI] 识别错误:', msg.error)
          break
      }
    } catch {
      console.warn('[SAPI] 无法解析JSON:', line)
    }
  }

  private getScriptPath(): string {
    // In dev mode: project root/scripts/
    // In packaged mode: resources/scripts/
    const isPackaged = app.isPackaged
    if (isPackaged) {
      return path.join(process.resourcesPath, 'scripts', 'sapi-recognize.ps1')
    } else {
      return path.join(app.getAppPath(), 'scripts', 'sapi-recognize.ps1')
    }
  }
}
