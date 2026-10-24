import type { AppSettings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/constants'

interface SettingsAPI {
  getSettings: () => Promise<AppSettings>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<void>
  openDirectoryDialog: (defaultPath?: string) => Promise<string | null>
  createDesktopShortcut: () => Promise<{ success: boolean; error?: string }>
  testOfflineModel: (modelPath: string) => Promise<{ success: boolean; error?: string; info?: string }>
}

const api = (window as unknown as { electronAPI: SettingsAPI }).electronAPI

let currentSettings: AppSettings = DEFAULT_SETTINGS

// Tab switching
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'))
    document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'))
    tab.classList.add('active')
    const tabId = (tab as HTMLElement).dataset.tab!
    document.getElementById(`section-${tabId}`)!.classList.add('active')
  })
})

// Load settings
async function loadSettings(): Promise<void> {
  try {
    currentSettings = await api.getSettings()
    populateForm(currentSettings)
  } catch (err) {
    console.error('加载设置失败:', err)
  }
}

function populateForm(settings: AppSettings): void {
  // STT
  setVal('stt-mode', settings.stt.mode)
  setVal('stt-cloudBaseUrl', settings.stt.cloudBaseUrl)
  setVal('stt-cloudApiKey', settings.stt.cloudApiKey)
  setVal('stt-cloudModel', settings.stt.cloudModel)
  setVal('stt-language', settings.stt.language)
  setVal('stt-voskModelPath', settings.stt.voskModelPath)
  toggleSTTFields(settings.stt.mode)

  // LLM
  setVal('llm-baseUrl', settings.llm.baseUrl)
  setVal('llm-apiKey', settings.llm.apiKey)
  setVal('llm-model', settings.llm.model)
  setVal('llm-temperature', String(settings.llm.temperature))
  setVal('llm-systemPrompt', settings.llm.systemPrompt)
  setVal('llm-outputMode', settings.llm.outputMode ?? 'clean')
  document.getElementById('llm-temperature-value')!.textContent = String(settings.llm.temperature)

  // Audio
  setVal('audio-vadSensitivity', String(settings.audio.vadSensitivity))
  setVal('audio-silenceDuration', String(settings.audio.silenceDuration))
  setVal('audio-autoStopEnabled', String(settings.audio.autoStopEnabled ?? true))
  setVal('audio-autoStopSilenceSec', String(settings.audio.autoStopSilenceSec ?? 8))
  document.getElementById('audio-vadSensitivity-value')!.textContent = String(settings.audio.vadSensitivity)

  // General
  setVal('hotkey-toggleRecording', settings.hotkey.toggleRecording)
  setVal('output-method', settings.output.method)
  setVal('general-launchAtStartup', String(settings.general.launchAtStartup))
  setVal('general-debug', String(settings.general.debug ?? false))

  // Highlight matching LLM preset
  highlightPreset(settings.llm.baseUrl)
}

function setVal(id: string, value: string): void {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  if (el) el.value = value
}

function getVal(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
  return el?.value || ''
}

// Toggle cloud/offline fields visibility
function toggleSTTFields(mode: string): void {
  const cloudFields = document.getElementById('cloud-stt-fields')!
  const offlineFields = document.getElementById('offline-stt-fields')!
  cloudFields.style.display = mode === 'cloud' ? 'block' : 'none'
  offlineFields.style.display = mode === 'offline' ? 'block' : 'none'
}

document.getElementById('stt-mode')!.addEventListener('change', (e) => {
  toggleSTTFields((e.target as HTMLSelectElement).value)
})

// Range sliders live update
document.getElementById('llm-temperature')!.addEventListener('input', (e) => {
  document.getElementById('llm-temperature-value')!.textContent = (e.target as HTMLInputElement).value
})
document.getElementById('audio-vadSensitivity')!.addEventListener('input', (e) => {
  document.getElementById('audio-vadSensitivity-value')!.textContent = (e.target as HTMLInputElement).value
})

// ========== LLM Presets ==========

interface LLMPreset {
  baseUrl: string
  model: string
  hint: string
  modelHint: string
}

const LLM_PRESETS: Record<string, LLMPreset> = {
  agnes: {
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-2.0-flash',
    hint: 'Agnes AI - Sapiens 出品，免费高速模型',
    modelHint: '可选: agnes-2.0-flash, agnes-2.0-preview',
  },
  longcat: {
    baseUrl: 'https://api.longcat.chat/openai/v1',
    model: 'LongCat-Flash-Chat',
    hint: 'LongCat API - 龙猫大模型，支持 OpenAI 兼容格式',
    modelHint: '可选: LongCat-Flash-Chat, LongCat-Flash-Thinking, LongCat-Flash-Lite',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: 'OpenAI 官方 API',
    modelHint: '可选: gpt-4o, gpt-4o-mini, gpt-3.5-turbo 等',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'DeepSeek API - 深度求索',
    modelHint: '可选: deepseek-chat, deepseek-reasoner',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    hint: 'Ollama 本地部署 - 无需 API Key',
    modelHint: '根据你部署的模型填写，如: qwen2.5:7b, llama3, mistral 等',
  },
}

function highlightPreset(baseUrl: string): void {
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    const preset = (btn as HTMLElement).dataset.preset!
    btn.classList.toggle('active', LLM_PRESETS[preset]?.baseUrl === baseUrl)
  })
}

document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const presetName = (btn as HTMLElement).dataset.preset!
    const preset = LLM_PRESETS[presetName]
    if (!preset) return

    setVal('llm-baseUrl', preset.baseUrl)
    setVal('llm-model', preset.model)
    document.getElementById('llm-baseUrl-hint')!.textContent = preset.hint
    document.getElementById('llm-model-hint')!.textContent = preset.modelHint

    // Highlight active preset
    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'))
    btn.classList.add('active')
  })
})

// ========== Browse Vosk Model ==========

document.getElementById('btn-browse-model')!.addEventListener('click', async () => {
  try {
    const currentPath = getVal('stt-voskModelPath')
    const selected = await api.openDirectoryDialog(currentPath || undefined)
    if (selected) {
      setVal('stt-voskModelPath', selected)
      // Auto-test the selected model
      await testOfflineModel(selected)
    }
  } catch (err) {
    showStatus('stt-status', `选择文件夹失败: ${err}`, 'error')
  }
})

// ========== Test Offline Model ==========

async function testOfflineModel(modelPath: string): Promise<void> {
  const statusField = document.getElementById('model-status-field')!
  const statusEl = document.getElementById('model-status')!
  statusField.style.display = 'block'
  statusEl.textContent = '正在验证模型...'
  statusEl.className = 'status-msg success'

  try {
    const result = await api.testOfflineModel(modelPath)
    if (result.success) {
      statusEl.textContent = result.info || '模型验证通过'
      statusEl.className = 'status-msg success'
    } else {
      statusEl.textContent = result.error || '模型验证失败'
      statusEl.className = 'status-msg error'
    }
  } catch (err) {
    statusEl.textContent = `验证失败: ${err}`
    statusEl.className = 'status-msg error'
  }
}

// ========== Collect Settings ==========

function collectSettings(): AppSettings {
  return {
    stt: {
      mode: getVal('stt-mode') as 'cloud' | 'offline',
      cloudBaseUrl: getVal('stt-cloudBaseUrl'),
      cloudApiKey: getVal('stt-cloudApiKey'),
      cloudModel: getVal('stt-cloudModel'),
      language: getVal('stt-language'),
      voskModelPath: getVal('stt-voskModelPath'),
    },
    llm: {
      baseUrl: getVal('llm-baseUrl'),
      apiKey: getVal('llm-apiKey'),
      model: getVal('llm-model'),
      temperature: parseFloat(getVal('llm-temperature')),
      systemPrompt: getVal('llm-systemPrompt'),
      outputMode: getVal('llm-outputMode') === 'summarize' ? 'summarize' : 'clean',
    },
    hotkey: {
      toggleRecording: getVal('hotkey-toggleRecording'),
    },
    output: {
      method: getVal('output-method') as 'clipboard-paste' | 'direct-type',
      restoreClipboardDelay: currentSettings.output.restoreClipboardDelay,
    },
    audio: {
      vadSensitivity: parseFloat(getVal('audio-vadSensitivity')),
      silenceDuration: parseInt(getVal('audio-silenceDuration'), 10),
      inputDeviceId: currentSettings.audio.inputDeviceId,
      autoStopEnabled: getVal('audio-autoStopEnabled') !== 'false',
      autoStopSilenceSec: parseInt(getVal('audio-autoStopSilenceSec'), 10) || 8,
    },
    general: {
      launchAtStartup: getVal('general-launchAtStartup') === 'true',
      showFloatingBubble: currentSettings.general.showFloatingBubble,
      language: currentSettings.general.language,
      debug: getVal('general-debug') === 'true',
    },
  }
}

// ========== Save ==========

document.getElementById('btn-save')!.addEventListener('click', async () => {
  const settings = collectSettings()
  try {
    for (const key of Object.keys(settings) as (keyof AppSettings)[]) {
      await api.setSetting(key, settings[key])
    }
    currentSettings = settings
    showStatus('save-status', '设置已保存', 'success')
  } catch (err) {
    showStatus('save-status', `保存失败: ${err}`, 'error')
  }
})

// ========== Reset ==========

document.getElementById('btn-reset')!.addEventListener('click', async () => {
  try {
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      await api.setSetting(key, DEFAULT_SETTINGS[key])
    }
    currentSettings = { ...DEFAULT_SETTINGS }
    populateForm(currentSettings)
    showStatus('save-status', '已恢复默认设置', 'success')
  } catch (err) {
    showStatus('save-status', `重置失败: ${err}`, 'error')
  }
})

// ========== Test STT Connection ==========

document.getElementById('btn-test-stt')!.addEventListener('click', async () => {
  const mode = getVal('stt-mode')
  if (mode === 'cloud') {
    const baseUrl = getVal('stt-cloudBaseUrl')
    const apiKey = getVal('stt-cloudApiKey')
    if (!apiKey) {
      showStatus('stt-status', '请先填写 API Key', 'error')
      return
    }
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.ok) {
        showStatus('stt-status', '连接成功!', 'success')
      } else {
        showStatus('stt-status', `连接失败: HTTP ${resp.status}`, 'error')
      }
    } catch (err) {
      showStatus('stt-status', `连接失败: ${err}`, 'error')
    }
  } else {
    // Offline mode: test the model path
    const modelPath = getVal('stt-voskModelPath')
    if (!modelPath) {
      showStatus('stt-status', '将使用内置 SenseVoice 模型，无需配置', 'success')
      return
    }
    await testOfflineModel(modelPath)
  }
})

// ========== Test LLM Connection ==========

document.getElementById('btn-test-llm')!.addEventListener('click', async () => {
  const baseUrl = getVal('llm-baseUrl')
  const apiKey = getVal('llm-apiKey')
  const model = getVal('llm-model')

  // Ollama doesn't require API key
  const isOllama = baseUrl.includes('localhost:11434')
  if (!apiKey && !isOllama) {
    showStatus('llm-status', '请先填写 API Key', 'error')
    return
  }
  if (!baseUrl) {
    showStatus('llm-status', '请先填写 API Base URL', 'error')
    return
  }
  if (!model) {
    showStatus('llm-status', '请先填写模型名称', 'error')
    return
  }

  showStatus('llm-status', '正在测试连接...', 'success')

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (resp.ok) {
      showStatus('llm-status', `连接成功! 模型 "${model}" 可用`, 'success')
    } else {
      const text = await resp.text()
      let errMsg = `HTTP ${resp.status}`
      try {
        const json = JSON.parse(text)
        errMsg += ` - ${json.error?.message || text.slice(0, 100)}`
      } catch {
        errMsg += ` - ${text.slice(0, 100)}`
      }
      showStatus('llm-status', `连接失败: ${errMsg}`, 'error')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('timeout') || msg.includes('aborted')) {
      showStatus('llm-status', '连接超时，请检查 URL 是否正确', 'error')
    } else {
      showStatus('llm-status', `连接失败: ${msg}`, 'error')
    }
  }
})

// ========== Desktop Shortcut ==========

document.getElementById('btn-create-shortcut')!.addEventListener('click', async () => {
  try {
    showStatus('shortcut-status', '正在创建桌面快捷方式...', 'success')
    const result = await api.createDesktopShortcut()
    if (result.success) {
      showStatus('shortcut-status', '桌面快捷方式创建成功!', 'success')
    } else {
      showStatus('shortcut-status', result.error || '创建失败', 'error')
    }
  } catch (err) {
    showStatus('shortcut-status', `创建失败: ${err}`, 'error')
  }
})

// ========== Hotkey Recorder ==========

const hotkeyInput = document.getElementById('hotkey-toggleRecording') as HTMLInputElement
let hotkeyRecording = false

// Modifier key name mapping for Electron accelerator format
const MODIFIER_MAP: Record<string, string> = {
  Control: 'Ctrl',
  Shift: 'Shift',
  Alt: 'Alt',
  Meta: 'CmdOrCtrl',
}

// Special key name mapping
const KEY_MAP: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Enter: 'Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
}

hotkeyInput.addEventListener('focus', () => {
  hotkeyRecording = true
  hotkeyInput.classList.add('recording')
  hotkeyInput.style.borderColor = '#f38ba8'
  hotkeyInput.style.background = '#3a1e2e'
})

hotkeyInput.addEventListener('blur', () => {
  hotkeyRecording = false
  hotkeyInput.classList.remove('recording')
  hotkeyInput.style.borderColor = ''
  hotkeyInput.style.background = ''
})

hotkeyInput.addEventListener('keydown', (e: KeyboardEvent) => {
  e.preventDefault()
  e.stopPropagation()

  if (!hotkeyRecording) return

  const parts: string[] = []

  // Build modifier keys
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  if (e.metaKey) parts.push('CmdOrCtrl')

  // Get the main key
  const key = e.key
  if (MODIFIER_MAP[key]) {
    // Only modifiers pressed, show them but don't save yet
    hotkeyInput.value = parts.join('+') + '+'
    return
  }

  // Map the key name
  let mainKey: string
  if (KEY_MAP[key]) {
    mainKey = KEY_MAP[key]
  } else if (key.length === 1) {
    // Single character - uppercase for letters
    mainKey = key.toUpperCase()
  } else {
    // Unknown key, use as-is
    mainKey = key
  }

  parts.push(mainKey)
  const accelerator = parts.join('+')

  // Validate: need at least one modifier + one key
  const hasModifier = e.ctrlKey || e.altKey || e.metaKey
  if (!hasModifier) {
    hotkeyInput.value = '需要按 Ctrl/Alt 等修饰键'
    setTimeout(() => { hotkeyInput.value = currentSettings.hotkey.toggleRecording }, 1500)
    return
  }

  hotkeyInput.value = accelerator
  hotkeyInput.blur()
})

// Prevent text cursor in readonly input
hotkeyInput.addEventListener('mousedown', (e) => {
  if (!hotkeyRecording) {
    hotkeyInput.focus()
    e.preventDefault()
  }
})

// ========== Helpers ==========

function showStatus(id: string, message: string, type: 'success' | 'error'): void {
  const el = document.getElementById(id)!
  el.textContent = message
  el.className = `status-msg ${type}`
  setTimeout(() => {
    el.className = 'status-msg'
  }, 5000)
}

// Initialize
loadSettings()
