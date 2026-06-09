import { STTProvider } from './stt-interface'
import { getSetting } from '../../settings'

export class CloudSTTProvider implements STTProvider {
  name = 'cloud'

  async initialize(): Promise<void> {
    const config = getSetting('stt')
    if (!config.cloudApiKey) {
      throw new Error('云端 STT 需要配置 API Key，请在设置中填写')
    }
    console.log(`[CloudSTT] 初始化完成: ${config.cloudBaseUrl} / ${config.cloudModel}`)
  }

  async transcribe(audioBuffer: Buffer, sampleRate: number): Promise<string> {
    const config = getSetting('stt')
    const wavBuffer = pcmToWav(audioBuffer, sampleRate)

    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(wavBuffer)], { type: 'audio/wav' }), 'audio.wav')
    formData.append('model', config.cloudModel)
    formData.append('language', config.language)

    const url = `${config.cloudBaseUrl}/audio/transcriptions`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.cloudApiKey}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`STT API 错误 (${response.status}): ${errorText}`)
    }

    const result = await response.json()
    const text = result.text?.trim() || ''

    console.log(`[CloudSTT] 转录结果: ${text}`)
    return text
  }

  async dispose(): Promise<void> {
    console.log('[CloudSTT] 已释放')
  }
}

/**
 * Convert raw PCM Int16 buffer to WAV format with proper RIFF header
 */
function pcmToWav(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcmBuffer.length
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const header = Buffer.alloc(headerSize)

  // RIFF chunk
  header.write('RIFF', 0)
  header.writeUInt32LE(totalSize - 8, 4)
  header.write('WAVE', 8)

  // fmt chunk
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // chunk size
  header.writeUInt16LE(1, 20) // PCM format
  header.writeUInt16LE(numChannels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)

  // data chunk
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmBuffer])
}
