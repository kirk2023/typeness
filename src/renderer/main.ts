import { AudioCapture } from './audio/capture'
import { VADEngine } from './audio/vad'

declare global {
  interface Window {
    electronAPI: {
      onToggleRecording: (callback: (enabled: boolean) => void) => void
      sendSpeechStart: () => void
      sendAudioChunk: (audioData: ArrayBuffer) => void
      sendSpeechEnd: (audioData: ArrayBuffer) => void
      sendWebSpeechText: (text: string) => void
      onPipelineStateChanged: (callback: (state: string) => void) => void
      onPipelineResult: (callback: (result: { raw: string; cleaned: string }) => void) => void
      onPipelinePartialResult: (callback: (text: string) => void) => void
      onPipelineError: (callback: (error: { stage: string; message: string }) => void) => void
      getSettings: () => Promise<unknown>
      getSetting: (key: string) => Promise<unknown>
      setSetting: (key: string, value: unknown) => Promise<void>
      getAudioDevices: () => Promise<Array<{ deviceId: string; label: string }>>
      // Floating bubble APIs
      onBubbleStateChanged: (callback: (recording: boolean) => void) => void
      bubbleToggleRecording: () => void
      onBubblePipelineState: (callback: (state: string) => void) => void
      // Error reporting
      reportError: (title: string, message: string) => void
      // VAD asset URL
      getVadAssetUrl: () => Promise<string>
    }
  }
}

const statusEl = document.getElementById('status')!
const transcriptEl = document.getElementById('transcript')!

let audioCapture: AudioCapture | null = null
let vadEngine: VADEngine | null = null
let isRecording = false
let isSpeaking = false  // Only send chunks when VAD detects speech
let chunkProcessor: ScriptProcessorNode | null = null
let audioContextForChunk: AudioContext | null = null
// 音频引擎操作串行链：开始/停止绝不并发执行，杜绝多套引擎同时采集
let engineOp: Promise<void> = Promise.resolve()

/** 彻底销毁当前所有音频资源（VAD、采集器、块处理器） */
function teardownAudio(): void {
  isSpeaking = false
  cleanupChunkProcessor()
  vadEngine?.destroy()
  audioCapture?.destroy()
  vadEngine = null
  audioCapture = null
}

async function startEngine(): Promise<void> {
  if (audioCapture && vadEngine) return  // 已在运行，不重复创建
  teardownAudio()  // 防御：先清掉可能存在的残留资源

  try {
    console.log('[Renderer] Step 1: 正在初始化音频捕获...')
    // 读取音频设置（灵敏度/静音时长/麦克风设备）
    const audioSettings = (await window.electronAPI.getSetting('audio')) as {
      vadSensitivity: number
      silenceDuration: number
      inputDeviceId: string
    }

    const capture = new AudioCapture()
    await capture.init(audioSettings.inputDeviceId || undefined)
    console.log('[Renderer] Step 1 ✅ 音频捕获初始化成功')

    const stream = capture.getStream()
    audioCapture = capture

    // Set up audio chunk streaming
    setupChunkProcessor(stream)

    console.log('[Renderer] Step 2: 正在初始化 VAD 引擎...')
    const sensitivity = audioSettings.vadSensitivity > 0 ? audioSettings.vadSensitivity : 0.5
    const vad = new VADEngine({
      positiveSpeechThreshold: sensitivity,
      negativeSpeechThreshold: Math.max(0.1, sensitivity - 0.15),
      redemptionMs: audioSettings.silenceDuration > 0 ? audioSettings.silenceDuration : 800,
      onSpeechStart: () => {
        console.log('[Renderer] ✅ 语音开始')
        isSpeaking = true
        window.electronAPI.sendSpeechStart()
      },
      onSpeechChunk: () => {
        // Not used - chunks sent via ScriptProcessor gated by isSpeaking
      },
      onSpeechEnd: (audioData: Float32Array) => {
        console.log('[Renderer] ✅ 语音结束')
        isSpeaking = false
        const pcmBuffer = float32ToInt16(audioData)
        window.electronAPI.sendSpeechEnd(pcmBuffer)
      },
    })

    console.log(`[Renderer] VAD 参数: 灵敏度=${sensitivity}, 静音判定=${audioSettings.silenceDuration}ms`)
    await vad.init(stream)
    vadEngine = vad
    console.log('[Renderer] Step 2 ✅ VAD 引擎初始化成功，正在监听麦克风...')
  } catch (err) {
    // 启动失败：清干净，别留半初始化的资源
    teardownAudio()
    const msg = err instanceof Error ? `${err.message}\n${err.stack || ''}` : String(err)
    console.error('[Renderer] ❌ 音频引擎启动失败:', msg)
    window.electronAPI.reportError('音频引擎启动失败', msg.split('\n')[0])
  }
}

function setupChunkProcessor(stream: MediaStream): void {
  audioContextForChunk = new AudioContext({ sampleRate: 16000 })
  const source = audioContextForChunk.createMediaStreamSource(stream)
  chunkProcessor = audioContextForChunk.createScriptProcessor(4096, 1, 1) // ~256ms at 16kHz

  chunkProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
    // Only send chunks when recording AND speaking (VAD detected speech)
    if (!isRecording || !isSpeaking) return
    const inputData = e.inputBuffer.getChannelData(0)
    const pcmBuffer = float32ToInt16(inputData)
    window.electronAPI.sendAudioChunk(pcmBuffer)
  }

  source.connect(chunkProcessor)
  chunkProcessor.connect(audioContextForChunk.destination)
  console.log('[Renderer] 音频块处理器已启动 (仅在说话时发送)')
}

function cleanupChunkProcessor(): void {
  chunkProcessor?.disconnect()
  chunkProcessor = null
  audioContextForChunk?.close()
  audioContextForChunk = null
}

function stopEngine(): void {
  teardownAudio()
  console.log('[Renderer] 音频引擎已停止')
}

function float32ToInt16(float32Array: Float32Array): ArrayBuffer {
  const int16Array = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16Array.buffer
}

// Listen for toggle events from main process.
// 所有开始/停止操作排入串行链执行：即使事件成串到达（比如主进程卡顿后积压），
// 也只会有至多一套音频引擎存活，不会叠加产生重复音频。
window.electronAPI.onToggleRecording((enabled: boolean) => {
  isRecording = enabled
  statusEl.textContent = `状态: ${enabled ? '监听中...' : '空闲'}`

  engineOp = engineOp.then(() => {
    if (enabled) {
      return startEngine()
    }
    stopEngine()
    return undefined
  })
})

// Listen for partial results (streaming) - log only, bubble shows them
window.electronAPI.onPipelinePartialResult((text: string) => {
  console.log('[Renderer] 流式部分结果:', text)
  statusEl.textContent = `识别中: ${text}`
})

// Listen for final results
window.electronAPI.onPipelineResult((result) => {
  console.log('[Renderer] 最终结果:', result)
  statusEl.textContent = `结果: ${result.cleaned}`
  const div = document.createElement('div')
  div.innerHTML = `<p><strong>原始:</strong> ${result.raw}</p><p><strong>整理:</strong> ${result.cleaned}</p>`
  transcriptEl.prepend(div)
})

window.electronAPI.onPipelineError((error) => {
  console.error(`[Renderer] 流水线错误 [${error.stage}]:`, error.message)
  statusEl.textContent = `错误: ${error.message}`
})

console.log('[Renderer] Typeness 渲染进程已加载')
