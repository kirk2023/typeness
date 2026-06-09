// Bubble UI logic
// Uses ipcRenderer via the shared preload script

export {}

const bubbleBtn = document.getElementById('bubble-btn')!
const textPanel = document.getElementById('text-panel')!
const streamingText = document.getElementById('streaming-text')!

let isRecording = false
let hideTimer: ReturnType<typeof setTimeout> | null = null

// Extend the electronAPI type for bubble
interface BubbleAPI {
  onBubbleStateChanged: (callback: (recording: boolean) => void) => void
  bubbleToggleRecording: () => void
  onBubblePipelineState: (callback: (state: string) => void) => void
  onBubbleStreamingText: (callback: (text: string) => void) => void
}
const api = (window as any).electronAPI as BubbleAPI

// Listen for state changes from main process
api.onBubbleStateChanged((recording: boolean) => {
  isRecording = recording
  updateUI()
})

// Listen to pipeline state for color updates
api.onBubblePipelineState((state: string) => {
  bubbleBtn.classList.remove('recording', 'processing', 'typing')

  switch (state) {
    case 'LISTENING':
      bubbleBtn.classList.add('recording')
      break
    case 'STT_PROCESSING':
    case 'LLM_PROCESSING':
      bubbleBtn.classList.add('processing')
      break
    case 'TYPING':
      bubbleBtn.classList.add('typing')
      break
    default:
      break
  }

  // Mark text as final when back to listening
  if (state === 'LISTENING' && streamingText.textContent) {
    streamingText.classList.add('final')
  }
})

// Listen for streaming text
api.onBubbleStreamingText((text: string) => {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  streamingText.textContent = text
  streamingText.classList.remove('final', 'error')
  textPanel.classList.add('visible')

  // Auto-hide after 5s of no updates
  hideTimer = setTimeout(() => {
    textPanel.classList.remove('visible')
  }, 5000)
})

// Click to toggle
bubbleBtn.addEventListener('click', () => {
  api.bubbleToggleRecording()
})

function updateUI(): void {
  if (isRecording) {
    bubbleBtn.classList.add('recording')
  } else {
    bubbleBtn.classList.remove('recording', 'processing', 'typing')
    // Hide text panel when recording stops (after showing final result briefly)
    setTimeout(() => {
      textPanel.classList.remove('visible')
    }, 3000)
  }
}
