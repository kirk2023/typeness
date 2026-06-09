import Store from 'electron-store'
import { AppSettings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/constants'

const store = new Store<{ settings: AppSettings }>({
  name: 'typeness-config',
  defaults: {
    settings: DEFAULT_SETTINGS,
  },
})

// Migrate: if user has the old default system prompt, update to new one
const OLD_PROMPT_PREFIX = '你是一个语音转文本后处理器'
const currentPrompt = store.get('settings.llm.systemPrompt', '')
if (currentPrompt.startsWith(OLD_PROMPT_PREFIX)) {
  store.set('settings.llm.systemPrompt', DEFAULT_SETTINGS.llm.systemPrompt)
  store.set('settings.llm.temperature', DEFAULT_SETTINGS.llm.temperature)
}


export function getSettings(): AppSettings {
  return store.get('settings', DEFAULT_SETTINGS)
}

export function getSetting<K extends keyof AppSettings>(
  key: K
): AppSettings[K] {
  const settings = getSettings()
  return settings[key]
}

export function setSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): void {
  const settings = getSettings()
  settings[key] = value
  store.set('settings', settings)
}

export function updateSetting<
  K extends keyof AppSettings,
  SK extends keyof AppSettings[K]
>(key: K, subKey: SK, value: AppSettings[K][SK]): void {
  const settings = getSettings()
  ;(settings[key] as Record<string, unknown>)[subKey as string] = value
  store.set('settings', settings)
}

export function resetSettings(): void {
  store.set('settings', DEFAULT_SETTINGS)
}
