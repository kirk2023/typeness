import type { AppSettings } from './types'

export const DEFAULT_SYSTEM_PROMPT = `你是一个语音转文本清理器。你的唯一任务是去除口语中的冗余成分，严禁改写、补充或重新组织内容。

允许的操作（仅限以下）：
1. 删除语气词：嗯、啊、那个、这个、就是说、对吧、其实啊、咋说呢
2. 删除明显的重复（同一个词连续说两次）
3. 删除自我纠正（“我说的是…不对，应该是…”只保留后半句）
4. 修正明显的错别字（仅限同音字替换）

严禁的操作：
- 禁止添加原文没有的内容或观点
- 禁止改写句式或重新组织表达
- 禁止合并、拆分或重新排序句子
- 禁止对模糊内容做猜测性补充
- 禁止生成任何对话式回复（“请提供”“我会为您”“以下是”等）

输出规则：
- 仅输出清理后的文本，不要任何前缀、引号或解释
- 如果不确定某个词是否有误，保持原样
- 如果输入文本无法理解，原样输出`

export const DEFAULT_SETTINGS: AppSettings = {
  stt: {
    mode: 'cloud',
    voskModelPath: '',
    cloudBaseUrl: 'https://api.openai.com/v1',
    cloudApiKey: '',
    cloudModel: 'whisper-1',
    language: 'zh',
  },
  llm: {
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    apiKey: '',
    model: 'agnes-2.0-flash',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: 0.1,
  },
  hotkey: {
    toggleRecording: 'Ctrl+Shift+Space',
  },
  output: {
    method: 'clipboard-paste',
    restoreClipboardDelay: 200,
  },
  audio: {
    vadSensitivity: 0.5,
    silenceDuration: 800,
    inputDeviceId: '',
  },
  general: {
    launchAtStartup: false,
    showFloatingBubble: true,
    language: 'zh',
  },
}
