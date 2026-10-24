import { contextBridge, ipcRenderer } from 'electron'

const IPC = {
  PIPELINE_TOGGLE: 'pipeline:toggle-recording',
  PIPELINE_SPEECH_START: 'pipeline:speech-start',
  PIPELINE_AUDIO_CHUNK: 'pipeline:audio-chunk',
  PIPELINE_SPEECH_END: 'pipeline:speech-end',
  PIPELINE_WEB_SPEECH_TEXT: 'pipeline:web-speech-text',
  PIPELINE_STATE_CHANGED: 'pipeline:state-changed',
  PIPELINE_PARTIAL_RESULT: 'pipeline:partial-result',
  PIPELINE_SEGMENT_FINAL: 'pipeline:segment-final',
  PIPELINE_RESULT: 'pipeline:result',
  PIPELINE_ERROR: 'pipeline:error',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ALL: 'settings:get-all',
  AUDIO_GET_DEVICES: 'audio:get-devices',
  DIALOG_OPEN_DIRECTORY: 'dialog:open-directory',
  SHORTCUT_CREATE_DESKTOP: 'shortcut:create-desktop',
  STT_TEST_OFFLINE: 'stt:test-offline',
} as const

contextBridge.exposeInMainWorld('electronAPI', {
  // Pipeline
  onToggleRecording: (callback: (enabled: boolean) => void) => {
    ipcRenderer.on(IPC.PIPELINE_TOGGLE, (_event, enabled: boolean) => {
      callback(enabled)
    })
  },
  sendSpeechStart: () => {
    ipcRenderer.send(IPC.PIPELINE_SPEECH_START)
  },
  sendAudioChunk: (audioData: ArrayBuffer) => {
    ipcRenderer.send(IPC.PIPELINE_AUDIO_CHUNK, audioData)
  },
  sendSpeechEnd: (audioData: ArrayBuffer) => {
    ipcRenderer.send(IPC.PIPELINE_SPEECH_END, audioData)
  },
  sendWebSpeechText: (text: string) => {
    ipcRenderer.send(IPC.PIPELINE_WEB_SPEECH_TEXT, text)
  },
  onPipelineStateChanged: (callback: (state: string) => void) => {
    ipcRenderer.on(IPC.PIPELINE_STATE_CHANGED, (_event, state: string) => {
      callback(state)
    })
  },
  onPipelineResult: (callback: (result: { raw: string; cleaned: string }) => void) => {
    ipcRenderer.on(IPC.PIPELINE_RESULT, (_event, result) => {
      callback(result)
    })
  },
  onPipelinePartialResult: (callback: (text: string) => void) => {
    ipcRenderer.on(IPC.PIPELINE_PARTIAL_RESULT, (_event, text: string) => {
      callback(text)
    })
  },
  onPipelineSegmentFinal: (callback: (text: string) => void) => {
    ipcRenderer.on(IPC.PIPELINE_SEGMENT_FINAL, (_event, text: string) => {
      callback(text)
    })
  },
  onPipelineError: (callback: (error: { stage: string; message: string }) => void) => {
    ipcRenderer.on(IPC.PIPELINE_ERROR, (_event, error) => {
      callback(error)
    })
  },

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET_ALL),
  getSetting: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),

  // Audio
  getAudioDevices: () => ipcRenderer.invoke(IPC.AUDIO_GET_DEVICES),

  // Dialog
  openDirectoryDialog: (defaultPath?: string) =>
    ipcRenderer.invoke(IPC.DIALOG_OPEN_DIRECTORY, defaultPath),

  // Shortcut
  createDesktopShortcut: () => ipcRenderer.invoke(IPC.SHORTCUT_CREATE_DESKTOP),

  // STT offline test
  testOfflineModel: (modelPath: string) =>
    ipcRenderer.invoke(IPC.STT_TEST_OFFLINE, modelPath),

  // Floating bubble
  onBubbleStateChanged: (callback: (recording: boolean) => void) => {
    ipcRenderer.on('bubble:state-changed', (_event, recording: boolean) => {
      callback(recording)
    })
  },
  bubbleToggleRecording: () => {
    ipcRenderer.send('bubble:toggle-recording')
  },
  onBubblePipelineState: (callback: (state: string) => void) => {
    ipcRenderer.on('bubble:pipeline-state', (_event, state: string) => {
      callback(state)
    })
  },
  onBubblePartialText: (callback: (text: string) => void) => {
    ipcRenderer.on('bubble:partial-text', (_event, text: string) => {
      callback(text)
    })
  },
  onBubbleSegmentFinal: (callback: (text: string) => void) => {
    ipcRenderer.on('bubble:segment-final', (_event, text: string) => {
      callback(text)
    })
  },
  onBubbleFinalResult: (callback: (result: { raw: string; cleaned: string }) => void) => {
    ipcRenderer.on('bubble:final-result', (_event, result: { raw: string; cleaned: string }) => {
      callback(result)
    })
  },
  onBubbleSessionEnd: (callback: () => void) => {
    ipcRenderer.on('bubble:session-end', () => {
      callback()
    })
  },
  bubbleResize: (height: number) => {
    ipcRenderer.send('bubble:resize', height)
  },

  // Report renderer errors to main process for notification
  reportError: (title: string, message: string) => {
    ipcRenderer.send('renderer:error', { title, message })
  },

  // VAD asset server URL
  getVadAssetUrl: (): Promise<string> => ipcRenderer.invoke('vad:get-asset-url'),
})
