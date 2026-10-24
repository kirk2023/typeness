import { EventEmitter } from 'events'
import { PipelineState } from '../../shared/types'
import { getSetting } from '../settings'
import { STTProvider } from './stt/stt-interface'
import { VoskSTTProvider } from './stt/vosk-provider'
import { WindowsSAPIProvider } from './stt/windows-sapi-provider'
import { LLMProcessor } from './llm-processor'
import { TextOutput } from './text-output'
import { recordForegroundWindow, restoreForegroundIfChanged, ForegroundWindow } from './focus-guard'

/**
 * 会话式听写模型：
 * - 开始录音后持续采集，VAD 每断一句就用 SenseVoice 转写为"已定段落"（只累积，不输出）
 * - 结束录音时：补齐未完成的尾段 → 拼接全文 → LLM 一次性整理 → 一次性粘贴输出
 */
export class PipelineController extends EventEmitter {
  private state: PipelineState = PipelineState.IDLE
  private sttProvider: STTProvider | null = null
  private sapiProvider: WindowsSAPIProvider | null = null
  private useSAPI: boolean = false
  private sherpaReady: boolean = false
  private llmProcessor: LLMProcessor = new LLMProcessor()
  private llmEnabled: boolean = false
  private textOutput: TextOutput = new TextOutput()

  // === 会话状态 ===
  private sessionActive = false
  private sessionSegments: string[] = []  // 已定稿的段落文本（按说话顺序）

  // === 当前语音段状态 ===
  private audioChunks: Buffer[] = []      // 当前段累计的音频块（flush 尾段用）
  private isTranscribing = false          // 段落 STT 进行中
  private pendingAudio: Buffer[] = []     // STT 忙时到达的音频段队列
  private stopRequested = false           // STT 未排空时用户按了停止

  // === 自动停止（静音超时）===
  private autoStopTimer: ReturnType<typeof setInterval> | null = null
  private lastActivityAt = 0             // 最近一次语音活动（说话开始/音频块/段落定稿）
  private autoStopEmitted = false

  // 会话开始时的前台窗口（输出前若焦点被抢走，恢复到这个窗口再粘贴）
  private sessionFocus: ForegroundWindow | null = null

  constructor() {
    super()
    // Pre-warm SAPI eagerly so it's ready when needed
    this.sapiProvider = new WindowsSAPIProvider()
    this.sapiProvider.prewarm()
  }

  getState(): PipelineState {
    return this.state
  }

  private setState(newState: PipelineState): void {
    const oldState = this.state
    this.state = newState
    console.log(`[Pipeline] ${oldState} → ${newState}`)
    this.emit('state-changed', newState)
  }

  private get isStreaming(): boolean {
    return !this.useSAPI && !!(this.sttProvider?.isStreaming && this.sttProvider?.startStream)
  }

  /**
   * 预热：提前加载 sherpa-onnx 模型。应用启动时后台调用，
   * 让第一次按快捷键几乎瞬时响应。
   */
  async prewarm(): Promise<void> {
    if (this.sherpaReady || this.useSAPI) return
    try {
      if (!this.sttProvider) {
        this.sttProvider = new VoskSTTProvider()
      }
      await this.sttProvider.initialize()
      this.sherpaReady = true
      this.useSAPI = false
      console.log('[Pipeline] ✅ sherpa-onnx 预热完成，按快捷键即可立即开始')
    } catch (err) {
      console.warn('[Pipeline] sherpa-onnx 预热失败，录音时将回退 SAPI:', err)
      this.sttProvider = null
    }
  }

  async startListening(): Promise<void> {
    // === 1. Try sherpa-onnx (SenseVoice) first — much more accurate than SAPI ===
    if (!this.sherpaReady) {
      await this.prewarm()
    }

    // === 2. Fall back to Windows SAPI if sherpa-onnx unavailable ===
    if (!this.sherpaReady && !this.useSAPI && this.sapiProvider) {
      try {
        console.log('[Pipeline] 等待 Windows SAPI 就绪...')
        await this.sapiProvider.initialize()
        this.useSAPI = true
        console.log('[Pipeline] ✅ Windows SAPI 就绪，将使用系统语音引擎')
      } catch (err) {
        console.warn('[Pipeline] SAPI 初始化失败:', err)
        this.sapiProvider = null
      }
    }

    if (!this.sherpaReady && !this.useSAPI) {
      throw new Error('语音识别引擎不可用。sherpa-onnx 和 Windows SAPI 均初始化失败')
    }

    // === 3. Initialize LLM (optional; session can fall back to local cleanup) ===
    this.llmEnabled = false
    try {
      await this.llmProcessor.initialize()
      this.llmEnabled = true
    } catch (err) {
      console.warn('[Pipeline] LLM 不可用，结束时将使用本地规则清理:', err)
    }

    // === 4. Reset session state ===
    this.sessionActive = true
    this.sessionSegments = []
    this.pendingAudio = []
    this.audioChunks = []
    this.stopRequested = false
    this.lastActivityAt = Date.now()
    this.autoStopEmitted = false

    // === 5. SAPI continuous recognition (sherpa mode is driven by VAD events) ===
    if (this.useSAPI) {
      this.sapiProvider!.startRecognition(
        (partialText: string) => {
          // 只显示当前未定稿的部分，定稿内容通过 segment-final 单独下发
          this.touchActivity()
          this.emit('partial-result', partialText)
        },
        (finalText: string) => {
          console.log(`[Pipeline] SAPI 定稿: "${finalText}"`)
          const text = finalText.trim()
          if (text.length >= 2) {
            this.sessionSegments.push(text)
            this.emit('segment-final', text)
            this.touchActivity()
          }
          this.emit('partial-result', '')  // 清空气泡上的临时行
        }
      )
    }

    this.setState(PipelineState.LISTENING)
    this.startAutoStopWatchdog()

    // 后台记录当前前台窗口（约 0.5s），供输出前恢复焦点用
    this.sessionFocus = null
    void recordForegroundWindow().then((w) => {
      if (w && this.sessionActive) this.sessionFocus = w
    })
  }

  /**
   * 自动停止看门狗：会话中已有有效内容、且持续静音超过设定秒数时，
   * 发出 auto-stop 事件（由主进程走正常的停止流程收尾输出）。
   */
  private startAutoStopWatchdog(): void {
    this.stopAutoStopWatchdog()
    const audioCfg = getSetting('audio')
    if (audioCfg.autoStopEnabled === false) return  // 未配置视为开启
    const timeoutMs = Math.max(3, audioCfg.autoStopSilenceSec || 8) * 1000

    this.autoStopTimer = setInterval(() => {
      if (!this.sessionActive || this.isTranscribing || this.pendingAudio.length > 0) return
      // 还没有任何有效内容时不自动停止（等用户真正开始说）
      if (this.sessionSegments.length === 0) return
      if (Date.now() - this.lastActivityAt < timeoutMs) return
      if (this.autoStopEmitted) return
      this.autoStopEmitted = true
      console.log(`[Pipeline] 静音超过 ${timeoutMs / 1000}s，自动结束会话`)
      this.emit('auto-stop')
    }, 1000)
  }

  private stopAutoStopWatchdog(): void {
    if (this.autoStopTimer) {
      clearInterval(this.autoStopTimer)
      this.autoStopTimer = null
    }
  }

  private touchActivity(): void {
    this.lastActivityAt = Date.now()
  }

  /**
   * 结束录音：补齐尾段 → 全文 LLM 整理 → 一次性输出。
   * 段落转写仍在进行时，延迟到队列排空后再收尾。
   */
  stopListening(): void {
    this.stopAutoStopWatchdog()
    if (!this.sessionActive) {
      this.setState(PipelineState.IDLE)
      return
    }
    this.sessionActive = false

    if (this.useSAPI) {
      this.sapiProvider?.stopRecognition()
      void this.finalizeSession()
      return
    }

    // sherpa 模式：把说到一半的尾段（audioChunks）也补进来
    const tail = this.audioChunks.length > 0 ? Buffer.concat(this.audioChunks) : null
    this.audioChunks = []

    if (this.isTranscribing) {
      if (tail) this.pendingAudio.push(tail)
      this.stopRequested = true  // 队列排空后由 handleSpeechEnd 触发 finalize
      console.log('[Pipeline] 段落转写中，停止请求已排队')
      return
    }

    void (async () => {
      try {
        if (tail) {
          await this.runSegmentQueue(tail)
        }
        await this.finalizeSession()
      } catch (err) {
        console.error('[Pipeline] 停止收尾失败:', err)
        this.setState(PipelineState.IDLE)
      }
    })()
  }

  /**
   * VAD 检测到语音开始（每段触发一次）。
   * 会话外的语音事件直接丢弃（渲染端引擎已在停止中，或为残留事件）。
   */
  async handleSpeechStart(): Promise<void> {
    if (!this.sessionActive) return
    this.touchActivity()
    this.audioChunks = []
    if (this.isStreaming && this.sttProvider?.startStream) {
      try {
        await this.sttProvider.startStream()
      } catch (err) {
        console.error('[Pipeline] 启动流失败:', err)
      }
    }
  }

  /**
   * 说话期间持续到达的音频块：喂给流式模型出实时字幕，同时留作尾段备份。
   * 会话外到达的块直接丢弃，避免把停止后的残留音频喂进识别器产生乱码。
   */
  handleAudioChunk(audioBuffer: Buffer): void {
    if (!this.sessionActive) return

    this.touchActivity()
    this.audioChunks.push(audioBuffer)

    if (!this.isStreaming || !this.sttProvider?.feedChunk) return

    try {
      const partialText = this.sttProvider.feedChunk(audioBuffer, 16000)
      if (partialText) {
        this.emit('partial-result', partialText)
      }
    } catch (err) {
      console.error('[Pipeline] 处理音频块失败:', err)
    }
  }

  /**
   * VAD 判定一段话结束：转写为已定段落（不触发 LLM / 输出）
   */
  async handleSpeechEnd(audioBuffer?: Buffer): Promise<void> {
    if (!this.sessionActive || this.useSAPI) return

    // VAD 的完整段音频（含预缓冲）优先；缺失时回退到本段累计的块
    const segmentAudio = audioBuffer ?? (this.audioChunks.length > 0 ? Buffer.concat(this.audioChunks) : null)
    this.audioChunks = []
    if (!segmentAudio) return

    await this.runSegmentQueue(segmentAudio)

    // stopListening 在转写期间到达：队列已排空，现在收尾
    if (this.stopRequested && !this.isTranscribing) {
      await this.finalizeSession()
    }
  }

  /**
   * 串行转写音频段队列，保证段落顺序
   */
  private async runSegmentQueue(firstAudio: Buffer): Promise<void> {
    if (this.isTranscribing) {
      this.pendingAudio.push(firstAudio)
      console.log(`[Pipeline] 转写中，音频段入队 (${firstAudio.length} bytes)`)
      return
    }
    this.isTranscribing = true
    try {
      let audio: Buffer | null = firstAudio
      while (audio) {
        await this.transcribeSegment(audio)
        audio = this.pendingAudio.shift() ?? null
      }
    } finally {
      this.isTranscribing = false
    }
  }

  private async transcribeSegment(audio: Buffer): Promise<void> {
    try {
      this.setState(PipelineState.STT_PROCESSING)

      let text = ''
      if (this.isStreaming && this.sttProvider?.endStream) {
        text = await this.sttProvider.endStream(audio)
      } else {
        text = await this.transcribe(audio)
      }
      text = (text || '').trim()

      if (text.length >= 2) {
        this.sessionSegments.push(text)
        this.emit('segment-final', text)
        this.touchActivity()
        console.log(`[Pipeline] 段落定稿 (第${this.sessionSegments.length}段): "${text}"`)
      } else {
        console.log('[Pipeline] 段落转写过短，丢弃')
      }

      if (this.sessionActive) this.setState(PipelineState.LISTENING)
    } catch (err) {
      console.error('[Pipeline] 段落转写失败:', err)
      this.emit('error', { stage: 'stt', message: err instanceof Error ? err.message : String(err) })
      if (this.sessionActive) this.setState(PipelineState.LISTENING)
    }
  }

  /**
   * 会话收尾：全文一次 LLM 整理 → 一次粘贴输出
   */
  private async finalizeSession(): Promise<void> {
    this.stopRequested = false
    const rawText = this.sessionSegments.join(' ').trim()
    this.sessionSegments = []

    if (!rawText) {
      console.log('[Pipeline] 会话无有效内容，跳过输出')
      this.emit('session-empty')
      this.setState(PipelineState.IDLE)
      return
    }

    console.log(`[Pipeline] 会话结束，共 ${rawText.length} 字，开始 LLM 整理`)

    try {
      this.setState(PipelineState.LLM_PROCESSING)

      let finalText: string
      if (this.llmEnabled) {
        try {
          finalText = await this.llmProcessor.processStream(
            rawText,
            (partialCleaned: string) => {
              this.emit('partial-result', partialCleaned)  // 整理结果流式显示在气泡
            }
          )
        } catch (llmErr) {
          const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr)
          console.warn(`[Pipeline] LLM 处理失败，使用本地规则清理兜底: ${errMsg}`)
          this.emit('notice', '⚠ AI 整理服务超时/失败，本次已用本地清理输出')
          finalText = this.llmProcessor.localClean(rawText)
          this.emit('partial-result', finalText)
        }
      } else {
        this.emit('notice', '⚠ 未配置 AI（设置中填写 API Key 后可自动整理），本次为本地清理')
        finalText = this.llmProcessor.localClean(rawText)
        this.emit('partial-result', finalText)
      }

      // 输出最终文本：若焦点被弹窗等抢走，先恢复到会话开始时的窗口
      this.setState(PipelineState.TYPING)
      if (this.sessionFocus) {
        await restoreForegroundIfChanged(this.sessionFocus)
      }
      await this.textOutput.output(finalText)

      this.emit('result', { raw: rawText, cleaned: finalText })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[Pipeline] 会话输出失败:', errorMsg)
      this.emit('error', { stage: this.state, message: errorMsg })
    } finally {
      this.setState(PipelineState.IDLE)
    }
  }

  /**
   * 预识别文本（Web Speech 等来源）：作为一段定稿加入会话
   */
  handleRecognizedText(rawText: string): void {
    if (!this.sessionActive) return
    const text = (rawText || '').trim()
    if (text.length < 2) return
    this.sessionSegments.push(text)
    this.emit('segment-final', text)
    this.touchActivity()
  }

  private async transcribe(audioBuffer: Buffer): Promise<string> {
    if (!this.sttProvider) {
      throw new Error('STT 提供者未初始化')
    }
    return this.sttProvider.transcribe(audioBuffer, 16000)
  }

  async dispose(): Promise<void> {
    this.stopAutoStopWatchdog()
    if (this.sttProvider) {
      await this.sttProvider.dispose()
    }
    this.setState(PipelineState.IDLE)
  }
}
