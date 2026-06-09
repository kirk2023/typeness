import { MicVAD } from '@ricky0123/vad-web'

export interface VADEngineOptions {
  onSpeechStart: () => void
  onSpeechChunk: (audioData: Float32Array) => void
  onSpeechEnd: (audioData: Float32Array) => void
  positiveSpeechThreshold?: number
  negativeSpeechThreshold?: number
  minSpeechMs?: number
  redemptionMs?: number
  preSpeechPadMs?: number
}

export class VADEngine {
  private vad: MicVAD | null = null
  private options: VADEngineOptions
  // Buffer audio chunks during speech for streaming
  private speechChunks: Float32Array[] = []

  constructor(options: VADEngineOptions) {
    this.options = options
  }

  async init(stream: MediaStream): Promise<void> {
    const api = (window as unknown as { electronAPI: { getVadAssetUrl: () => Promise<string> } }).electronAPI
    const assetUrl = await api.getVadAssetUrl()
    console.log('[VAD] Using asset URL:', assetUrl)

    this.vad = await MicVAD.new({
      getStream: async () => stream,
      positiveSpeechThreshold: this.options.positiveSpeechThreshold ?? 0.5,
      negativeSpeechThreshold: this.options.negativeSpeechThreshold ?? 0.35,
      minSpeechMs: this.options.minSpeechMs ?? 150,
      redemptionMs: this.options.redemptionMs ?? 1200,
      preSpeechPadMs: this.options.preSpeechPadMs ?? 300,
      onSpeechStart: () => {
        console.log('[VAD] 检测到语音开始')
        this.speechChunks = []
        this.options.onSpeechStart()
      },
      onSpeechEnd: (audio: Float32Array) => {
        console.log('[VAD] 语音结束, 总采样数:', audio.length)
        this.options.onSpeechEnd(audio)
      },
      onVADMisfire: () => {
        console.log('[VAD] 误触发，忽略')
      },
      // Frame-level callback: fires every ~30ms with audio frame
      onFrameProcessed: (probs: {
        isSpeech: number
        notSpeech: number
      }) => {
        // Not used for chunk streaming - we use speech start/end events
      },
      baseAssetPath: assetUrl,
      onnxWASMBasePath: assetUrl,
      processorType: 'ScriptProcessor',
    })

    this.vad.start()
    console.log('[VAD] Silero VAD 已启动')
  }

  destroy(): void {
    this.vad?.destroy()
    this.vad = null
    this.speechChunks = []
    console.log('[VAD] 已停止')
  }
}
