// IPC Channel names
export const IPC = {
  PIPELINE_TOGGLE: 'pipeline:toggle-recording',
  PIPELINE_SPEECH_START: 'pipeline:speech-start',
  PIPELINE_AUDIO_CHUNK: 'pipeline:audio-chunk',
  PIPELINE_SPEECH_END: 'pipeline:speech-end',
  PIPELINE_STATE_CHANGED: 'pipeline:state-changed',
  PIPELINE_PARTIAL_RESULT: 'pipeline:partial-result',
  PIPELINE_RESULT: 'pipeline:result',
  PIPELINE_ERROR: 'pipeline:error',
  PIPELINE_WEB_SPEECH_TEXT: 'pipeline:web-speech-text',  // Pre-recognized text from Web Speech API
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',
  AUDIO_GET_DEVICES: 'audio:get-devices',
  DIALOG_OPEN_DIRECTORY: 'dialog:open-directory',
  SHORTCUT_CREATE_DESKTOP: 'shortcut:create-desktop',
  STT_TEST_OFFLINE: 'stt:test-offline',
} as const

// Pipeline states
export enum PipelineState {
  IDLE = 'IDLE',
  LISTENING = 'LISTENING',
  STT_PROCESSING = 'STT_PROCESSING',
  LLM_PROCESSING = 'LLM_PROCESSING',
  TYPING = 'TYPING',
}

// STT mode
export type STTMode = 'offline' | 'cloud'

// Output method
export type OutputMethod = 'clipboard-paste' | 'direct-type'

// Settings schema type
export interface AppSettings {
  stt: {
    mode: STTMode
    voskModelPath: string
    cloudBaseUrl: string
    cloudApiKey: string
    cloudModel: string
    language: string
  }
  llm: {
    baseUrl: string
    apiKey: string
    model: string
    systemPrompt: string
    temperature: number
  }
  hotkey: {
    toggleRecording: string
  }
  output: {
    method: OutputMethod
    restoreClipboardDelay: number
  }
  audio: {
    vadSensitivity: number
    silenceDuration: number
    inputDeviceId: string
  }
  general: {
    launchAtStartup: boolean
    showFloatingBubble: boolean
    language: 'zh' | 'en'
  }
}

// Pipeline result payload
export interface PipelineResult {
  raw: string
  cleaned: string
}

// Pipeline error payload
export interface PipelineError {
  stage: string
  message: string
}
