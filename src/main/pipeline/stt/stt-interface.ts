export interface STTProvider {
  name: string
  initialize(): Promise<void>
  transcribe(audioBuffer: Buffer, sampleRate: number): Promise<string>
  dispose(): Promise<void>

  // Streaming API (optional, implemented by streaming providers)
  isStreaming?: boolean
  startStream?(): Promise<void>
  feedChunk?(audioBuffer: Buffer, sampleRate: number): string | null  // returns partial text or null
  endStream?(audioBuffer?: Buffer): Promise<string>  // returns final text; audioBuffer for offline re-transcribe
}
