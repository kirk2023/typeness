// Bubble UI: 滚动字幕面板 + 录音按钮
// Uses ipcRenderer via the shared preload script

export {}

const bubbleBtn = document.getElementById('bubble-btn')!
const panel = document.getElementById('transcript-panel')!
const transcriptEl = document.getElementById('transcript')!
const partialEl = document.getElementById('partial-line')!
const resultEl = document.getElementById('result-line')!
const statusEl = document.getElementById('status-line')!
const containerEl = document.getElementById('container')!

let isRecording = false
let llmPhase = false            // 会话结束后 LLM 整理阶段，partial 显示到 result 行
let collapseTimer: ReturnType<typeof setTimeout> | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null

interface BubbleAPI {
  onBubbleStateChanged: (callback: (recording: boolean) => void) => void
  bubbleToggleRecording: () => void
  onBubblePipelineState: (callback: (state: string) => void) => void
  onBubblePartialText: (callback: (text: string) => void) => void
  onBubbleSegmentFinal: (callback: (text: string) => void) => void
  onBubbleFinalResult: (callback: (result: { raw: string; cleaned: string }) => void) => void
  onBubbleSessionEnd: (callback: () => void) => void
  onBubbleNotice: (callback: (message: string) => void) => void
  bubbleResize: (height: number) => void
}
const api = (window as any).electronAPI as BubbleAPI

// ===== 窗口高度随内容自适应（底边不动，向上生长） =====
function requestResize(): void {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    api.bubbleResize(containerEl.offsetHeight)
  }, 80)
}

function scrollTranscriptToBottom(): void {
  transcriptEl.scrollTop = transcriptEl.scrollHeight
}

function showPanel(): void {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
  panel.classList.add('visible')
  requestResize()
}

/** 新会话开始：清空面板 */
function resetPanel(): void {
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
  transcriptEl.innerHTML = ''
  transcriptEl.classList.remove('dimmed')
  partialEl.textContent = ''
  resultEl.textContent = ''
  resultEl.classList.remove('final')
  statusEl.textContent = ''
  statusEl.classList.remove('warn')
  llmPhase = false
  panel.classList.add('visible')
  requestResize()
}

/** 会话结果展示完毕（或无内容）：延迟收起 */
function scheduleCollapse(delayMs: number): void {
  if (collapseTimer) clearTimeout(collapseTimer)
  collapseTimer = setTimeout(() => {
    panel.classList.remove('visible')
    requestResize()
  }, delayMs)
}

// ===== 事件 =====

api.onBubbleStateChanged((recording: boolean) => {
  isRecording = recording
  if (recording) {
    resetPanel()
    bubbleBtn.classList.add('recording')
  } else {
    bubbleBtn.classList.remove('recording', 'processing', 'typing')
  }
  requestResize()
})

api.onBubblePipelineState((state: string) => {
  bubbleBtn.classList.remove('processing', 'typing')

  switch (state) {
    case 'LISTENING':
      bubbleBtn.classList.add('recording')
      if (llmPhase) {
        // 新会话回到监听（罕见：上一会话结果未收起）
        resetPanel()
      }
      break
    case 'STT_PROCESSING':
      bubbleBtn.classList.add('recording')
      break
    case 'LLM_PROCESSING':
      bubbleBtn.classList.add('processing')
      llmPhase = true
      partialEl.textContent = ''
      transcriptEl.classList.add('dimmed')
      statusEl.textContent = '正在整理…'
      showPanel()
      break
    case 'TYPING':
      bubbleBtn.classList.add('typing')
      statusEl.textContent = '正在输入…'
      break
    default:
      break
  }
  requestResize()
})

// 实时字幕 / LLM 流式结果
api.onBubblePartialText((text: string) => {
  showPanel()
  if (llmPhase) {
    resultEl.textContent = text
  } else {
    partialEl.textContent = text
  }
  scrollTranscriptToBottom()
  requestResize()
})

// 一段话定稿 → 追加为一行字幕
api.onBubbleSegmentFinal((text: string) => {
  showPanel()
  const seg = document.createElement('div')
  seg.className = 'seg'
  seg.textContent = text
  transcriptEl.appendChild(seg)
  partialEl.textContent = ''
  scrollTranscriptToBottom()
  requestResize()
})

// 会话最终结果（已粘贴到目标应用）
api.onBubbleFinalResult((result: { raw: string; cleaned: string }) => {
  showPanel()
  resultEl.textContent = result.cleaned
  resultEl.classList.add('final')
  statusEl.textContent = '✓ 已输入'
  requestResize()
  scheduleCollapse(6000)
})

// 会话结束但无有效内容
api.onBubbleSessionEnd(() => {
  scheduleCollapse(1500)
})

// 状态提示（如 AI 整理降级警示）
api.onBubbleNotice((message: string) => {
  showPanel()
  statusEl.textContent = message
  statusEl.classList.add('warn')
  requestResize()
})

// Click to toggle
bubbleBtn.addEventListener('click', () => {
  api.bubbleToggleRecording()
})
