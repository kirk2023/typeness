import { STTProvider } from './stt-interface'
import { getSetting } from '../../settings'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export class VoskSTTProvider implements STTProvider {
  name = 'sherpa-onnx-hybrid'
  isStreaming = true

  // Streaming recognizer (zipformer - for real-time partial results)
  private onlineRecognizer: any = null
  private stream: any = null
  private onlineModelDir: string = ''
  private lastText: string = ''
  private accumulatedText: string = ''

  // Offline recognizer (SenseVoice - for accurate final results)
  private offlineRecognizer: any = null
  private offlineModelDir: string = ''

  async initialize(): Promise<void> {
    let sherpaOnnx: any
    try {
      sherpaOnnx = require('sherpa-onnx-node')
      console.log(`[SherpaSTT] sherpa-onnx-node 加载成功`)
    } catch (err) {
      throw new Error(
        `sherpa-onnx-node 模块加载失败: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    const appDir = app.isPackaged
      ? (process.resourcesPath || path.dirname(process.execPath))
      : path.join(__dirname, '../../..')

    // === 1. Initialize streaming zipformer model ===
    this.initStreamingModel(sherpaOnnx, appDir)

    // === 2. Initialize offline SenseVoice model ===
    this.initOfflineModel(sherpaOnnx, appDir)

    if (!this.onlineRecognizer && !this.offlineRecognizer) {
      throw new Error('未找到任何可用的语音识别模型')
    }

    if (this.onlineRecognizer && this.offlineRecognizer) {
      console.log('[SherpaSTT] 混合模式初始化完成: zipformer(流式) + SenseVoice(离线)')
    } else if (this.onlineRecognizer) {
      console.log('[SherpaSTT] 仅流式模式 (无离线模型)')
    } else {
      console.log('[SherpaSTT] 仅离线模式 (无流式模型)')
    }
  }

  private initStreamingModel(sherpaOnnx: any, appDir: string): void {
    const config = getSetting('stt')
    this.onlineModelDir = config.voskModelPath || ''

    // Ignore old vosk / sense-voice paths
    if (this.onlineModelDir && (this.onlineModelDir.includes('vosk-model') || this.onlineModelDir.includes('sense-voice'))) {
      this.onlineModelDir = ''
    }

    if (!this.onlineModelDir) {
      this.onlineModelDir = path.join(appDir, 'models', 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20')
    }

    const encoder = this.findFileIn(this.onlineModelDir, 'encoder-epoch-99-avg-1.int8.onnx', 'encoder*.int8.onnx', 'encoder*.onnx')
    const decoder = this.findFileIn(this.onlineModelDir, 'decoder-epoch-99-avg-1.int8.onnx', 'decoder*.int8.onnx', 'decoder*.onnx')
    const joiner = this.findFileIn(this.onlineModelDir, 'joiner-epoch-99-avg-1.int8.onnx', 'joiner*.int8.onnx', 'joiner*.onnx')
    const tokens = path.join(this.onlineModelDir, 'tokens.txt')

    if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) {
      console.warn('[SherpaSTT] 流式 zipformer 模型文件不完整，跳过流式模型加载')
      return
    }

    try {
      const recognizerConfig = {
        modelConfig: {
          transducer: { encoder, decoder, joiner },
          tokens,
          numThreads: 2,
          debug: false,
          provider: 'cpu',
        },
        enableEndpoint: 1,
        rule1MinTrailingSilence: 2.4,
        rule2MinTrailingSilence: 1.2,
        rule3MinUtteranceLength: 20,
      }

      this.onlineRecognizer = new sherpaOnnx.OnlineRecognizer(recognizerConfig)
      console.log(`[SherpaSTT] 流式模型加载成功: ${this.onlineModelDir}`)
    } catch (err) {
      console.warn('[SherpaSTT] 流式模型加载失败:', err)
      this.onlineRecognizer = null
    }
  }

  private initOfflineModel(sherpaOnnx: any, appDir: string): void {
    this.offlineModelDir = path.join(appDir, 'models', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue')

    const modelFile = fs.existsSync(path.join(this.offlineModelDir, 'model.int8.onnx'))
      ? path.join(this.offlineModelDir, 'model.int8.onnx')
      : fs.existsSync(path.join(this.offlineModelDir, 'model.onnx'))
        ? path.join(this.offlineModelDir, 'model.onnx')
        : null
    const tokens = path.join(this.offlineModelDir, 'tokens.txt')

    if (!modelFile || !fs.existsSync(tokens)) {
      console.warn('[SherpaSTT] SenseVoice 离线模型文件不完整，跳过离线模型加载')
      return
    }

    try {
      const offlineConfig = {
        modelConfig: {
          senseVoice: {
            model: modelFile,
            language: '',  // 空字符串 = 自动检测语言
            useInverseTextNormalization: 1,  // 必须是数字，不能是布尔值
          },
          tokens,
          numThreads: 2,
          debug: false,
          provider: 'cpu',
        },
      }

      this.offlineRecognizer = new sherpaOnnx.OfflineRecognizer(offlineConfig)
      console.log(`[SherpaSTT] 离线模型加载成功: ${this.offlineModelDir}`)
    } catch (err) {
      console.warn('[SherpaSTT] 离线模型加载失败:', err)
      this.offlineRecognizer = null
    }
  }

  private findFileIn(dir: string, ...patterns: string[]): string | null {
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        try {
          const files = fs.readdirSync(dir)
          const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
          const match = files.find(f => regex.test(f))
          if (match) return path.join(dir, match)
        } catch { /* dir doesn't exist */ }
      } else {
        const filePath = path.join(dir, pattern)
        if (fs.existsSync(filePath)) return filePath
      }
    }
    return null
  }

  // === Streaming API (uses zipformer for real-time partial results) ===

  async startStream(): Promise<void> {
    if (!this.onlineRecognizer) {
      console.log('[SherpaSTT] 无流式模型，跳过 startStream')
      return
    }
    this.stream = this.onlineRecognizer.createStream()
    this.lastText = ''
    this.accumulatedText = ''
    console.log('[SherpaSTT] 开始新流')
  }

  feedChunk(audioBuffer: Buffer, sampleRate: number): string | null {
    if (!this.stream || !this.onlineRecognizer) return null

    // Convert Int16 PCM to Float32
    const int16 = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0
    }

    this.stream.acceptWaveform({ samples: float32, sampleRate })

    while (this.onlineRecognizer.isReady(this.stream)) {
      this.onlineRecognizer.decode(this.stream)
    }

    const isEndpoint = this.onlineRecognizer.isEndpoint(this.stream)
    const result = this.onlineRecognizer.getResult(this.stream)
    const text = (result.text || '').trim()

    if (isEndpoint) {
      // 段内端点：把这段文本并入内部累积，随后 VAD 断句会走 SenseVoice 定稿（segment-final），
      // 这里不再返回累积文本，避免与气泡上已定稿的段落重复显示
      if (text.length > 0) {
        this.accumulatedText += text
        console.log(`[SherpaSTT] 端点检测, 段: "${text}", 累积: "${this.accumulatedText}"`)
      }
      this.onlineRecognizer.reset(this.stream)
      this.lastText = ''
      return null
    }

    if (text && text !== this.lastText) {
      this.lastText = text
      return text  // 仅当前段的实时 partial
    }
    return null
  }

  /**
   * End stream: if audioBuffer is provided and SenseVoice is available,
   * use SenseVoice for accurate final result. Otherwise use zipformer accumulated text.
   */
  async endStream(audioBuffer?: Buffer): Promise<string> {
    // Try SenseVoice offline model first (much more accurate)
    if (audioBuffer && this.offlineRecognizer) {
      const durationSec = (audioBuffer.length / 2) / 16000  // Int16 samples / sampleRate
      console.log(`[SherpaSTT] SenseVoice 离线识别开始, 音频大小: ${audioBuffer.length} bytes, 时长: ${durationSec.toFixed(2)}s`)
      try {
        const senseVoiceResult = await this.transcribeOffline(audioBuffer)
        if (senseVoiceResult && senseVoiceResult.length >= 2) {
          console.log(`[SherpaSTT] SenseVoice 最终识别 (${senseVoiceResult.length}字): "${senseVoiceResult}"`)
          this.stream = null
          return senseVoiceResult
        } else {
          console.warn(`[SherpaSTT] SenseVoice 结果过短或为空: "${senseVoiceResult}", 回退到 zipformer`)
        }
      } catch (err) {
        console.warn('[SherpaSTT] SenseVoice 离线识别失败，回退到 zipformer:', err)
      }
    } else {
      console.log(`[SherpaSTT] 跳过 SenseVoice (audioBuffer=${!!audioBuffer}, offlineRecognizer=${!!this.offlineRecognizer})`)
    }

    // Fallback: use zipformer accumulated text
    if (!this.stream || !this.onlineRecognizer) {
      const result = this.accumulatedText || this.lastText || ''
      console.log(`[SherpaSTT] 流结束(无流), 最终: "${result}"`)
      return result
    }

    this.stream.inputFinished()
    while (this.onlineRecognizer.isReady(this.stream)) {
      this.onlineRecognizer.decode(this.stream)
    }

    const result = this.onlineRecognizer.getResult(this.stream)
    const remainingText = (result.text || '').trim()

    let finalText = this.accumulatedText
    if (remainingText && !this.accumulatedText.endsWith(remainingText)) {
      finalText += remainingText
    }
    finalText = finalText.trim()

    console.log(`[SherpaSTT] zipformer 最终: "${finalText}"`)
    this.stream = null
    return finalText || this.lastText || ''
  }

  // === Offline transcribe (SenseVoice) ===

  private transcribeOffline(audioBuffer: Buffer): string {
    if (!this.offlineRecognizer) {
      throw new Error('SenseVoice 离线识别器未初始化')
    }

    const int16 = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0
    }

    // === DEBUG: 保存音频到 WAV 文件供检查（仅 debug 模式） ===
    try {
      if (getSetting('general').debug) {
        const wavPath = path.join(app.getPath('temp'), 'typeness-sensevoice-debug.wav')
        this.saveWav(wavPath, float32, 16000)
        console.log(`[SherpaSTT] 调试音频已保存: ${wavPath}`)
      }
    } catch (err) {
      console.warn('[SherpaSTT] 保存调试音频失败:', err)
    }

    const stream = this.offlineRecognizer.createStream()
    stream.acceptWaveform({ samples: float32, sampleRate: 16000 })

    // OfflineRecognizer 没有 isReady，直接 decode
    this.offlineRecognizer.decode(stream)

    const result = this.offlineRecognizer.getResult(stream)
    return (result.text || '').trim()
  }

  /** 保存 Float32 音频为 WAV 文件 (调试用) */
  private saveWav(filePath: string, samples: Float32Array, sampleRate: number): void {
    const numSamples = samples.length
    const buffer = Buffer.alloc(44 + numSamples * 2)  // WAV header + Int16 data
    let offset = 0

    // RIFF header
    buffer.write('RIFF', offset); offset += 4
    buffer.writeUInt32LE(36 + numSamples * 2, offset); offset += 4  // file size - 8
    buffer.write('WAVE', offset); offset += 4

    // fmt chunk
    buffer.write('fmt ', offset); offset += 4
    buffer.writeUInt32LE(16, offset); offset += 4  // chunk size
    buffer.writeUInt16LE(1, offset); offset += 2   // PCM format
    buffer.writeUInt16LE(1, offset); offset += 2   // mono
    buffer.writeUInt32LE(sampleRate, offset); offset += 4
    buffer.writeUInt32LE(sampleRate * 2, offset); offset += 4  // byte rate
    buffer.writeUInt16LE(2, offset); offset += 2   // block align
    buffer.writeUInt16LE(16, offset); offset += 2  // bits per sample

    // data chunk
    buffer.write('data', offset); offset += 4
    buffer.writeUInt32LE(numSamples * 2, offset); offset += 4

    // Write Int16 samples
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]))
      buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, offset)
      offset += 2
    }

    fs.writeFileSync(filePath, buffer)
  }

  // === Public transcribe API (uses SenseVoice if available, else zipformer) ===

  async transcribe(audioBuffer: Buffer, sampleRate: number): Promise<string> {
    if (this.offlineRecognizer) {
      return this.transcribeOffline(audioBuffer)
    }

    // Fallback to zipformer batch mode
    if (!this.onlineRecognizer) {
      throw new Error('无可用识别器')
    }

    const int16 = new Int16Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.length / 2)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768.0
    }

    const stream = this.onlineRecognizer.createStream()
    stream.acceptWaveform({ samples: float32, sampleRate })
    stream.inputFinished()

    while (this.onlineRecognizer.isReady(stream)) {
      this.onlineRecognizer.decode(stream)
    }

    const result = this.onlineRecognizer.getResult(stream)
    return (result.text || '').trim()
  }

  async dispose(): Promise<void> {
    this.stream = null
    this.onlineRecognizer = null
    this.offlineRecognizer = null
    console.log('[SherpaSTT] 已释放')
  }
}
