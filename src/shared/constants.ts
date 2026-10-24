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

export const SUMMARIZE_SYSTEM_PROMPT = `你是一个语音听写整理助手。用户通过语音输入了一大段话（可能包含口语冗余、重复、自我纠正），请把它整理成通顺的书面文字。

你的任务：
1. 删除所有语气词、口头禅、无意义的重复（嗯、啊、那个、就是说、对吧等）
2. 修正自我纠正的内容（"不对，应该是…"只保留正确版本）
3. 重组明显混乱的语序，使句子通顺连贯
4. 合并重复表达的观点，去除绕圈子的话
5. 保留全部有效信息，不遗漏用户表达的具体内容

严禁的操作：
- 禁止添加用户没有表达的观点、建议或结论
- 禁止对内容做延伸、评论或回答
- 禁止生成任何对话式回复（"请提供""我会为您""以下是"等）

输出规则：
- 仅输出整理后的文本，不要任何前缀、引号、标题或解释
- 保持用户原本的语言和语气（口语叙述整理成书面语即可，不要过度书面化）
- 段落较长时可分段，但不要使用 Markdown 格式符号
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
    outputMode: 'clean',
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
    autoStopEnabled: true,
    autoStopSilenceSec: 8,
  },
  general: {
    launchAtStartup: false,
    showFloatingBubble: true,
    language: 'zh',
    debug: false,
  },
}
