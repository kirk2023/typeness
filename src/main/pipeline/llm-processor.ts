import { getSetting } from '../settings'

// 常见 LLM 幻觉/对话式回复，需要被过滤掉
const HALLUCINATION_PATTERNS = [
  /^请提供/,
  /^请问您需要/,
  /^请告诉我/,
  /^请问有什么/,
  /^好的[，,]/,
  /^当然[，,]/,
  /^没问题[，,]/,
  /^非常抱歉/,
  /^作为(一个|AI)/,
  /^我是/,
  /^我会按照规则/,
  /我会为您/,
  /^以下是整理后的/,
  /^整理后的文本/,
  /^以下是/,
  /^希望以上/,
  /^如有其他/,
  /^如果您还有/,
  /^请注意/,
  /^由于没有提供/,
  /^根据您提供的/,
]

export class LLMProcessor {
  async initialize(): Promise<void> {
    const config = getSetting('llm')
    if (!config.apiKey) {
      throw new Error('LLM 处理需要配置 API Key，请在设置中填写')
    }
    console.log(`[LLM] 初始化完成: ${config.baseUrl} / ${config.model}`)
  }

  /**
   * Streaming LLM processing - calls onPartial for each chunk, returns full text.
   */
  async processStream(
    rawText: string,
    onPartial: (partialText: string) => void
  ): Promise<string> {
    const config = getSetting('llm')
    const url = `${config.baseUrl}/chat/completions`

    const body = {
      model: config.model,
      stream: true,
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: rawText },
      ],
      temperature: config.temperature,
      max_tokens: 2000,
    }

    console.log(`[LLM] 流式处理 (${rawText.length}字): "${rawText.slice(0, 80)}..."`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API 错误 (${response.status}): ${errorText}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Parse SSE chunks
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''  // Keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') break

        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            fullText += delta
            onPartial(fullText)
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    const cleanedText = fullText.trim() || rawText

    // Filter hallucinations
    if (this.isHallucination(cleanedText)) {
      console.warn(`[LLM] 检测到幻觉，回退原始文本`)
      return rawText
    }

    console.log(`[LLM] 流式结果: "${cleanedText.slice(0, 80)}"`)
    return cleanedText
  }

  /**
   * Non-streaming LLM processing (fallback).
   */
  async process(rawText: string): Promise<string> {
    const config = getSetting('llm')
    const url = `${config.baseUrl}/chat/completions`

    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: rawText },
      ],
      temperature: config.temperature,
      max_tokens: 2000,
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LLM API 错误 (${response.status}): ${errorText}`)
    }

    const result = await response.json()
    let cleanedText = result.choices?.[0]?.message?.content?.trim() || rawText

    if (this.isHallucination(cleanedText)) {
      console.warn(`[LLM] 检测到幻觉，回退原始文本`)
      cleanedText = rawText
    }

    console.log(`[LLM] 整理结果: "${cleanedText.slice(0, 80)}"`)
    return cleanedText
  }

  private isHallucination(text: string): boolean {
    for (const pattern of HALLUCINATION_PATTERNS) {
      if (pattern.test(text)) return true
    }
    return false
  }
}
