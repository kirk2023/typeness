import { clipboard } from 'electron'
import { getSetting } from '../settings'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const robot = require('robotjs')

export class TextOutput {
  /**
   * Output text at the current cursor position using clipboard-paste strategy.
   * This works reliably for CJK (Chinese/Japanese/Korean) characters.
   */
  async output(text: string): Promise<void> {
    const config = getSetting('output')

    if (config.method === 'clipboard-paste') {
      await this.clipboardPaste(text, config.restoreClipboardDelay)
    } else {
      await this.directType(text)
    }
  }

  /**
   * Strategy A: Save clipboard → Write text → Ctrl+V → Restore clipboard
   * Best for CJK text
   */
  private async clipboardPaste(
    text: string,
    restoreDelay: number
  ): Promise<void> {
    // Save current clipboard content
    const savedText = clipboard.readText()

    try {
      // Write our text to clipboard
      clipboard.writeText(text)

      // Small delay to ensure clipboard is written
      await sleep(50)

      // Simulate Ctrl+V
      robot.keyTap('v', 'control')

      console.log(`[TextOutput] 已粘贴 ${text.length} 个字符`)

      // Wait before restoring clipboard
      await sleep(restoreDelay)

      // Restore original clipboard content
      clipboard.writeText(savedText)
    } catch (err) {
      // If something goes wrong, still try to restore clipboard
      clipboard.writeText(savedText)
      throw err
    }
  }

  /**
   * Strategy B: Type text character by character
   * Fallback for ASCII-only text, has issues with CJK
   */
  private async directType(text: string): Promise<void> {
    robot.typeString(text)
    console.log(`[TextOutput] 已输入 ${text.length} 个字符`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
