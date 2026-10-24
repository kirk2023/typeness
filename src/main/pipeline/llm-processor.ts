import { getSetting } from '../settings'
import { SUMMARIZE_SYSTEM_PROMPT } from '../../shared/constants'

// 对话式回复的开头特征 —— 清理结果绝不该以这些形式出现
const CONVERSATIONAL_PATTERNS = [
  /^请提供/,
  /^请问您需要/,
  /^请告诉我/,
  /^请问有什么/,
  /^作为(一个)?(AI|人工智能|助手)/,
  /^我会按照规则/,
  /我会为您/,
  /^以下是/,
  /^整理后的文本/,
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
    console.log(`[LLM] 初始化完成: ${config.baseUrl} / ${config.model} (模式: ${config.outputMode})`)
  }

  private getSystemPrompt(): string {
    const config = getSetting('llm')
    if (config.outputMode === 'summarize') {
      return SUMMARIZE_SYSTEM_PROMPT
    }
    return config.systemPrompt
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
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: rawText },
      ],
      temperature: config.temperature,
      max_tokens: 4000,
    }

    console.log(`[LLM] 流式处理 (${rawText.length}字): "${rawText.slice(0, 80)}..."`)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
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
    if (this.isHallucination(cleanedText, rawText, config.outputMode)) {
      console.warn(`[LLM] 检测到幻觉/跑题输出，回退原始文本`)
      return rawText
    }

    console.log(`[LLM] 流式结果: "${cleanedText.slice(0, 80)}"`)
    return cleanedText
  }

  /**
   * 幻觉判定：
   * - 任何模式下，出现对话式回复特征都视为幻觉
   * - 清理模式下额外检查输出与原文的贴合度（总结模式允许大幅改写，不做贴合度检查）
   */
  private isHallucination(text: string, rawText: string, mode: 'clean' | 'summarize'): boolean {
    for (const pattern of CONVERSATIONAL_PATTERNS) {
      if (pattern.test(text)) return true
    }

    if (mode === 'clean') {
      const overlap = this.charOverlapRatio(rawText, text)
      const lengthRatio = text.length / Math.max(rawText.length, 1)
      // 清理只删不改：输出明显变长、或与原文几乎没有共同字符，都说明模型跑题了
      if (lengthRatio > 1.8 || overlap < 0.4) {
        console.warn(`[LLM] 输出偏离原文 (贴合度 ${overlap.toFixed(2)}, 长度比 ${lengthRatio.toFixed(2)})`)
        return true
      }
    }
    return false
  }

  /** 输出字符中也在原文出现过的比例（近似贴合度） */
  private charOverlapRatio(raw: string, output: string): number {
    if (!output) return 1
    const rawSet = new Set(raw)
    let hit = 0
    for (const ch of output) {
      if (rawSet.has(ch)) hit++
    }
    return hit / output.length
  }

  /**
   * 本地规则清理：LLM 不可用/失败时的离线兜底，只做最保守的口水话剔除
   */
  localClean(text: string): string {
    let t = text
    // 连续的语气助词（嗯嗯、啊啊、呃…）
    t = t.replace(/[嗯呃]{1,}/g, '')
    // 口头禅（仅出现在停顿边界时删除，避免误伤"这个很重要"这类正常用法）
    t = t.replace(/(^|[，。！？,!?；;\s])(就是说|怎么说呢|这么说吧|那个啥|等一下|让我想想|怎么说呢)(?=[，。！？,!?；;\s]|$)/g, '$1')
    // 句尾的"对吧""是吧""你知道吗"
    t = t.replace(/[，,]?(对吧|是不是|是吧|你知道吗|对不对)(?=[。！？!?；;\s]|$)/g, '')
    // 同一个字连续重复 3 次以上（哈哈哈→哈）
    t = t.replace(/(.)\1{2,}/g, '$1')
    // 重复的标点
    t = t.replace(/([，。！？、；：,!?;:])\s*\1+/g, '$1')
    t = t.replace(/\s{2,}/g, ' ')
    return t.trim()
  }
}
