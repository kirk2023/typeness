export class AudioCapture {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null

  async init(deviceId?: string): Promise<void> {
    const constraints: MediaStreamConstraints = {
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    }

    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    this.audioContext = new AudioContext({ sampleRate: 16000 })

    console.log(
      `[AudioCapture] 麦克风已连接, 采样率: ${this.audioContext.sampleRate}Hz`
    )
  }

  getStream(): MediaStream {
    if (!this.stream) {
      throw new Error('AudioCapture not initialized')
    }
    return this.stream
  }

  getAudioContext(): AudioContext {
    if (!this.audioContext) {
      throw new Error('AudioCapture not initialized')
    }
    return this.audioContext
  }

  destroy(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    this.audioContext?.close()
    this.stream = null
    this.audioContext = null
    console.log('[AudioCapture] 已释放')
  }
}
