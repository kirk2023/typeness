import { EventEmitter } from 'events'
import { PipelineState } from '../../shared/types'
import { getSetting, updateSetting } from '../settings'
import { STTProvider } from './stt/stt-interface'
import { CloudSTTProvider } from './stt/cloud-provider'
import { VoskSTTProvider } from './stt/vosk-provider'
import { WindowsSAPIProvider } from './stt/windows-sapi-provider'
import { LLMProcessor } from './llm-processor'
import { TextOutput } from './text-output'

export class PipelineController extends EventEmitter {
  private state: PipelineState = PipelineState.IDLE
  private sttProvider: STTProvider | null = null
  private sapiProvider: WindowsSAPIProvider | null = null
  private useSAPI: boolean = false
  private sherpaReady: boolean = false
  private llmProcessor: LLMProcessor = new LLMProcessor()
  private textOutput: TextOutput = new TextOutput()
  private isProcessing: boolean = false
  private isStreaming: boolean = false
  private audioChunks: Buffer[] = []  // Collect chunks for offline re-transcribe
  private sapiFinalBuffer: string = ''  // Accumulate SAPI final results before processing
  private pendingAudio: Buffer[] = []  // Queue audio segments that arrive during processing

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

  async startListening(): Promise<void> {
    // === 1. Try sherpa-onnx (SenseVoice) first — much more accurate than SAPI ===
    if (!this.sherpaReady) {
      try {
        if (!this.sttProvider) {
          this.sttProvider = new VoskSTTProvider()
        }
        await this.sttProvider.initialize()
        this.sherpaReady = true
        this.useSAPI = false
        console.log(`[Pipeline] ✅ sherpa-onnx 初始化成功，使用 SenseVoice 引擎`)
      } catch (err) {
        console.warn('[Pipeline] sherpa-onnx 初始化失败，将回退到 SAPI:', err)
        this.sttProvider = null
      }
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

    // === 3. Initialize LLM ===
    try {
      await this.llmProcessor.initialize()
    } catch (err) {
      console.warn('[Pipeline] LLM 初始化失败，将跳过文本整理:', err)
    }

    // === 4. Start recognition ===
    if (this.useSAPI) {
      // SAPI mode: start continuous recognition
      this.sapiFinalBuffer = ''
      this.sapiProvider!.startRecognition(
        (partialText: string) => {
          const displayText = this.sapiFinalBuffer + partialText
          this.emit('partial-result', displayText)
        },
        (finalText: string) => {
          console.log(`[Pipeline] SAPI 最终结果: "${finalText}"`)
          this.sapiFinalBuffer += finalText + '，'
          this.scheduleSAPIProcessing()
        }
      )
    }

    this.isStreaming = !this.useSAPI && !!(this.sttProvider?.isStreaming && this.sttProvider?.startStream)
    this.setState(PipelineState.LISTENING)
  }

  stopListening(): void {
    if (this.useSAPI && this.sapiProvider) {
      this.sapiProvider.stopRecognition()
      // Process any remaining accumulated text
      if (this.sapiFinalBuffer.trim()) {
        this.processSAPIText()
      }
    }
    this.setState(PipelineState.IDLE)
  }

  private sapiProcessTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Schedule processing of accumulated SAPI text after a brief pause
   */
  private scheduleSAPIProcessing(): void {
    if (this.sapiProcessTimer) {
      clearTimeout(this.sapiProcessTimer)
    }
    this.sapiProcessTimer = setTimeout(() => {
      this.processSAPIText()
    }, 500)  // Wait 0.5s for more results to accumulate
  }

  private async processSAPIText(): Promise<void> {
    if (this.sapiProcessTimer) {
      clearTimeout(this.sapiProcessTimer)
      this.sapiProcessTimer = null
    }
    const text = this.sapiFinalBuffer.trim().replace(/，$/, '')
    this.sapiFinalBuffer = ''
    if (text && text.length >= 2) {
      await this.handleRecognizedText(text)
    }
  }

  /**
   * Streaming: called when VAD detects speech start
   */
  async handleSpeechStart(): Promise<void> {
    this.audioChunks = []  // Reset chunk collection
    if (this.isStreaming && this.sttProvider?.startStream) {
      try {
        await this.sttProvider.startStream()
        this.setState(PipelineState.STT_PROCESSING)
      } catch (err) {
        console.error('[Pipeline] 启动流失败:', err)
      }
    }
  }

  /**
   * Streaming: called periodically with audio chunks during speech
   */
  handleAudioChunk(audioBuffer: Buffer): void {
    // Always collect chunks for offline re-transcribe
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
   * Handle speech end - for streaming, finalize; for batch, process entire segment
   */
  async handleSpeechEnd(audioBuffer?: Buffer): Promise<void> {
    // In SAPI mode, speech processing is handled by SAPI callbacks
    if (this.useSAPI) return

    // If currently processing, queue this audio segment instead of dropping it
    if (this.isProcessing) {
      if (audioBuffer) {
        this.pendingAudio.push(audioBuffer)
        console.log(`[Pipeline] 正在处理中，音频已入队 (${audioBuffer.length} bytes)`)
      } else if (this.audioChunks.length > 0) {
        this.pendingAudio.push(Buffer.concat(this.audioChunks))
        console.log(`[Pipeline] 正在处理中，音频块已入队 (${this.audioChunks.length} chunks)`)
        this.audioChunks = []
      }
      return
    }

    this.isProcessing = true

    try {
      this.setState(PipelineState.STT_PROCESSING)

      let rawText: string

      // Use VAD's complete audio buffer for SenseVoice (it's the accurate, full speech segment)
      // Fall back to ScriptProcessor chunks only if VAD buffer is unavailable
      const finalAudio = audioBuffer || (this.audioChunks.length > 0
        ? Buffer.concat(this.audioChunks)
        : undefined)

      if (this.isStreaming && this.sttProvider?.endStream) {
        // Streaming: pass VAD's complete audio for SenseVoice offline re-transcribe
        rawText = await this.sttProvider.endStream(finalAudio)
      } else if (finalAudio) {
        // Batch: transcribe the entire buffer
        rawText = await this.transcribe(finalAudio)
      } else {
        rawText = ''
      }

      if (!rawText || rawText.length < 2) {
        console.log('[Pipeline] 转录文本过短，跳过')
        this.setState(PipelineState.LISTENING)
        return
      }

      // LLM Processing
      this.setState(PipelineState.LLM_PROCESSING)
      const cleanedText = await this.processText(rawText)

      // Output
      this.setState(PipelineState.TYPING)
      await this.outputText(cleanedText)

      this.emit('result', { raw: rawText, cleaned: cleanedText })

      // Back to listening
      this.setState(PipelineState.LISTENING)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[Pipeline] 处理失败:', errorMsg)
      this.emit('error', { stage: this.state, message: errorMsg })
      if (this.state !== PipelineState.IDLE) {
        this.setState(PipelineState.LISTENING)
      }
    } finally {
      this.isProcessing = false
      // Process any queued audio segments that arrived during processing
      if (this.pendingAudio.length > 0) {
        const queued = Buffer.concat(this.pendingAudio)
        this.pendingAudio = []
        console.log(`[Pipeline] 处理排队音频, 大小: ${queued.length} bytes`)
        this.handleSpeechEnd(queued)
      }
    }
  }

  /**
   * Handle pre-recognized text from SAPI/Web Speech (skip STT, go to LLM directly)
   */
  async handleRecognizedText(rawText: string): Promise<void> {
    if (this.isProcessing) {
      console.log('[Pipeline] 正在处理中，跳过')
      return
    }
    if (!rawText || rawText.length < 2) {
      console.log('[Pipeline] 文本过短，跳过')
      return
    }

    this.isProcessing = true
    try {
      console.log(`[Pipeline] 识别文本: "${rawText}"`)

      // Try streaming LLM polish
      this.setState(PipelineState.LLM_PROCESSING)
      let finalText: string

      try {
        finalText = await this.llmProcessor.processStream(
          rawText,
          (partialCleaned: string) => {
            // Stream the polished text to UI as it arrives
            this.emit('partial-result', partialCleaned)
          }
        )
      } catch (llmErr) {
        console.warn('[Pipeline] LLM 流式处理失败，回退原始文本:', llmErr)
        finalText = rawText
        this.emit('partial-result', finalText)
      }

      // Output final text to target app
      this.setState(PipelineState.TYPING)
      await this.outputText(finalText)

      this.emit('result', { raw: rawText, cleaned: finalText })

      // Back to listening
      this.setState(PipelineState.LISTENING)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error('[Pipeline] 处理失败:', errorMsg)
      this.emit('error', { stage: this.state, message: errorMsg })
      if (this.state !== PipelineState.IDLE) {
        this.setState(PipelineState.LISTENING)
      }
    } finally {
      this.isProcessing = false
    }
  }

  /**
   * Legacy: handle a complete speech segment (batch mode)
   */
  async handleSpeechSegment(audioBuffer: Buffer): Promise<void> {
    return this.handleSpeechEnd(audioBuffer)
  }

  private async initSTTProvider(): Promise<void> {
    const config = getSetting('stt')

    if (config.mode === 'cloud') {
      this.sttProvider = new CloudSTTProvider()
    } else {
      this.sttProvider = new VoskSTTProvider()
    }

    await this.sttProvider.initialize()
    console.log(`[Pipeline] STT 提供者: ${this.sttProvider.name} (流式: ${!!this.sttProvider.isStreaming})`)
  }

  private async transcribe(audioBuffer: Buffer): Promise<string> {
    if (!this.sttProvider) {
      throw new Error('STT 提供者未初始化')
    }
    return this.sttProvider.transcribe(audioBuffer, 16000)
  }

  private async processText(rawText: string): Promise<string> {
    try {
      return await this.llmProcessor.process(rawText)
    } catch (err) {
      console.warn('[Pipeline] LLM 处理失败，返回原始文本:', err)
      return rawText
    }
  }

  private async outputText(text: string): Promise<void> {
    await this.textOutput.output(text)
  }

  async switchSTTMode(mode: 'cloud' | 'offline'): Promise<void> {
    if (this.sttProvider) {
      await this.sttProvider.dispose()
      this.sttProvider = null
    }
    updateSetting('stt', 'mode', mode)
    await this.initSTTProvider()
  }

  async dispose(): Promise<void> {
    if (this.sttProvider) {
      await this.sttProvider.dispose()
    }
    this.setState(PipelineState.IDLE)
  }
}
